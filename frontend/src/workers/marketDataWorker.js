import {
  aggregateBars,
  copyBars,
  frameOpenTime,
  mergeHistoryBars,
  normalizeTimeframe,
  normalizeStoredBar,
  parseTickMultiplier,
  round6,
} from "../market/aggregate";
import {
  appendBar,
  appendDepthSnapshot,
  appendDepthEvents,
  appendTrades,
  loadCacheSnapshot,
  replaceBars,
} from "../market/cache";
import { DEFAULT_STUDY_CONFIG } from "../market/studyConfig";

const LIVE_WS_URL = "wss://stream.bybit.com/v5/public/linear";
const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_ROW_SIZE = 0.1;
const MAX_HISTORY_BARS = 5000;
const MAX_DEPTH_HISTORY = 4000;
const MAX_REPLAY_TRADES = 80_000;
const MAX_DEPTH_EVENTS = 30_000;
const MAX_SEEN_TRADE_IDS = 200_000;
const SEEN_TRADE_ID_TRIM_BATCH = 1024;
const HEARTBEAT_MS = 20_000;
const RECONNECT_MS = 2_000;
const BROADCAST_MS = 250;
const BOOK_LEVELS = 40;
const ORDERBOOK_TOPIC_DEPTH = 200;
const REPLAY_WINDOW_MS = 30 * 60_000;
const REPLAY_MIN_EVENTS = 50;
const TRADE_PERSIST_BATCH = 128;
const TRADE_PERSIST_DEBOUNCE_MS = 1_000;
const DEPTH_EVENT_PERSIST_BATCH = 64;
const DEPTH_EVENT_PERSIST_DEBOUNCE_MS = 1_000;
const DEPTH_EVENT_SNAPSHOT_INTERVAL_MS = 5_000;

const engine = createEngine();

self.onmessage = async (event) => {
  const { type, payload } = event.data || {};

  if (type === "init") {
    await engine.init(payload || {});
    return;
  }

  if (type === "settings") {
    engine.updateSettings(payload || {});
    return;
  }

  if (type === "replay-start") {
    engine.startReplay();
    return;
  }

  if (type === "replay-stop") {
    engine.stopReplay();
    return;
  }

  if (type === "replay-step") {
    engine.stepReplay(Number(payload?.delta) || 0);
    return;
  }

  if (type === "shutdown") {
    engine.shutdown();
  }
};

function createEngine() {
  const state = {
    symbol: DEFAULT_SYMBOL,
    proxyBase: "/api",
    instrument: {
      symbol: DEFAULT_SYMBOL,
      tickSize: DEFAULT_ROW_SIZE,
      defaultTicks: [1, 5, 10, 25, 50, 100],
    },
    baseRowSize: DEFAULT_ROW_SIZE,
    timeframe: "1m",
    tickMultiplier: 1,
    studyConfig: DEFAULT_STUDY_CONFIG,
    status: "disconnected",
    ws: null,
    heartbeatId: null,
    reconnectId: null,
    broadcastId: null,
    shuttingDown: false,
    completedBars: [],
    aggregatedHistory: [],
    depthHistory: [],
    depthEvents: [],
    tradeHistory: [],
    pendingTradePersist: [],
    pendingDepthEventPersist: [],
    tradePersistTimeoutId: null,
    depthEventPersistTimeoutId: null,
    currentCandle: null,
    cvd: 0,
    currentOI: 0,
    prevBarOI: 0,
    bestBid: 0,
    bestBidSize: 0,
    bestAsk: 0,
    bestAskSize: 0,
    bids: new Map(),
    asks: new Map(),
    lastDepthSnapshotPersistTs: 0,
    lastTradeSeq: 0,
    lastDepthSeq: 0,
    seenTradeIds: [],
    seenTradeSet: new Set(),
    lastBroadcastLiveOpenTime: null,
    replay: createReplayState(),
  };

  async function init(payload) {
    shutdown();
    state.shuttingDown = false;
    state.symbol = payload.symbol || DEFAULT_SYMBOL;
    state.proxyBase = normalizeProxyBase(payload.proxyBase);
    state.instrument = {
      symbol: state.symbol,
      tickSize: DEFAULT_ROW_SIZE,
      defaultTicks: [1, 5, 10, 25, 50, 100],
    };
    state.baseRowSize = DEFAULT_ROW_SIZE;
    state.timeframe = normalizeTimeframe(payload.timeframe || "1m");
    state.tickMultiplier = parseTickMultiplier(payload.tickSize);
    state.completedBars = [];
    state.aggregatedHistory = [];
    state.depthHistory = [];
    state.depthEvents = [];
    state.tradeHistory = [];
    state.pendingTradePersist = [];
    state.pendingDepthEventPersist = [];
    state.currentCandle = null;
    state.cvd = 0;
    state.currentOI = 0;
    state.prevBarOI = 0;
    state.bestBid = 0;
    state.bestBidSize = 0;
    state.bestAsk = 0;
    state.bestAskSize = 0;
    state.bids = new Map();
    state.asks = new Map();
    state.lastDepthSnapshotPersistTs = 0;
    state.lastTradeSeq = 0;
    state.lastDepthSeq = 0;
    state.seenTradeIds = [];
    state.seenTradeSet = new Set();
    state.lastBroadcastLiveOpenTime = null;
    state.replay = createReplayState();
    state.status = "loading";
    emitStatus();
    emitInstrument();

    try {
      const cached = await loadCacheSnapshot(state.symbol);
      state.completedBars = mergeHistoryBars([], cached.bars).slice(-MAX_HISTORY_BARS);
      state.depthHistory = normalizeDepthSnapshots(cached.depth).slice(-MAX_DEPTH_HISTORY);
      state.tradeHistory = normalizeReplayTrades(cached.trades).slice(-MAX_REPLAY_TRADES);
      state.depthEvents = normalizeDepthEvents(cached.depthEvents).slice(-MAX_DEPTH_EVENTS);
      seedRuntimeFromHistory();
      recomputeAggregatedHistory();
      emitCaptureStats();
      emitFullSnapshot();
      emitReplayState();
    } catch {
      state.completedBars = [];
      state.depthHistory = [];
      state.tradeHistory = [];
      state.depthEvents = [];
      state.aggregatedHistory = [];
      emitCaptureStats();
      emitFullSnapshot();
      emitReplayState();
    }

    void hydrateInstrument();
    connect();
    startBroadcastLoop();
    void hydrateHistoryFromProxy();
  }

  function updateSettings(payload) {
    state.timeframe = normalizeTimeframe(payload.timeframe || state.timeframe);
    state.tickMultiplier = parseTickMultiplier(payload.tickSize);
    recomputeAggregatedHistory();

    if (state.replay.enabled && state.replay.startMinuteOpen) {
      restartReplay(state.replay.startMinuteOpen, state.replay.cursor);
      return;
    }

    emitFullSnapshot();
  }

  function shutdown() {
    state.shuttingDown = true;
    if (state.heartbeatId) {
      clearInterval(state.heartbeatId);
      state.heartbeatId = null;
    }
    if (state.reconnectId) {
      clearTimeout(state.reconnectId);
      state.reconnectId = null;
    }
    if (state.broadcastId) {
      clearInterval(state.broadcastId);
      state.broadcastId = null;
    }
    if (state.tradePersistTimeoutId) {
      clearTimeout(state.tradePersistTimeoutId);
      state.tradePersistTimeoutId = null;
    }
    if (state.depthEventPersistTimeoutId) {
      clearTimeout(state.depthEventPersistTimeoutId);
      state.depthEventPersistTimeoutId = null;
    }
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    if (state.pendingTradePersist.length > 0) {
      void flushPendingTrades();
    }
    if (state.pendingDepthEventPersist.length > 0) {
      void flushPendingDepthEvents();
    }
  }

  async function hydrateHistoryFromProxy() {
    try {
      const hadLiveRuntime = Boolean(state.currentCandle?.hasTick);
      const response = await fetch(`${state.proxyBase}/history?symbol=${encodeURIComponent(state.symbol)}&limit=${MAX_HISTORY_BARS}`);
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        return;
      }
      state.completedBars = mergeHistoryBars(state.completedBars, payload).slice(-MAX_HISTORY_BARS);
      if (!hadLiveRuntime) {
        seedRuntimeFromHistory();
      }
      recomputeAggregatedHistory();
      await replaceBars(state.completedBars, MAX_HISTORY_BARS, state.symbol);
      if (state.replay.enabled && state.replay.startMinuteOpen) {
        restartReplay(state.replay.startMinuteOpen, state.replay.cursor);
        return;
      }
      emitFullSnapshot();
    } catch {
      // Live data can proceed even if the proxy is unavailable.
    }
  }

  async function hydrateInstrument() {
    try {
      const response = await fetch(`${state.proxyBase}/instrument?symbol=${encodeURIComponent(state.symbol)}`);
      if (!response.ok) {
        emitInstrument();
        return;
      }
      const payload = await response.json();
      state.instrument = normalizeInstrument(payload, state.symbol);
      state.baseRowSize = state.instrument.tickSize;
      if (state.completedBars.length > 0) {
        state.completedBars = state.completedBars.map((bar) => ({
          ...bar,
          row_size: state.baseRowSize,
        }));
      }
      if (state.depthHistory.length > 0) {
        state.depthHistory = state.depthHistory.map((snapshot) => ({
          ...snapshot,
          row_size: state.baseRowSize,
        }));
      }
      recomputeAggregatedHistory();
      emitInstrument();
      emitFullSnapshot();
    } catch {
      emitInstrument();
    }
  }

  function seedRuntimeFromHistory() {
    const lastBar = state.completedBars.at(-1);
    if (!lastBar) {
      state.cvd = 0;
      state.currentOI = 0;
      state.prevBarOI = 0;
      return;
    }
    state.cvd = Number(lastBar.cvd) || 0;
    state.currentOI = Number(lastBar.oi) || 0;
    state.prevBarOI = Number(lastBar.oi) || 0;
    state.bestBid = Number(lastBar.best_bid) || 0;
    state.bestBidSize = Number(lastBar.best_bid_size) || 0;
    state.bestAsk = Number(lastBar.best_ask) || 0;
    state.bestAskSize = Number(lastBar.best_ask_size) || 0;
  }

  function buildOneMinuteBar(candle, oiDelta) {
    const clusters = [...candle.buckets.entries()]
      .map(([bucketIndex, bucket]) => ({
        price: round6(bucketIndex * state.baseRowSize),
        buyVol: round6(bucket.buyVol),
        sellVol: round6(bucket.sellVol),
        delta: round6(bucket.buyVol - bucket.sellVol),
        totalVol: round6(bucket.buyVol + bucket.sellVol),
        buyTrades: bucket.buyTrades,
        sellTrades: bucket.sellTrades,
        maxTradeBuy: round6(bucket.maxTradeBuy),
        maxTradeSell: round6(bucket.maxTradeSell),
      }))
      .sort((a, b) => a.price - b.price);

    const best = computeBestBidAsk();
    const bids = topLevels(state.bids, true, BOOK_LEVELS);
    const asks = topLevels(state.asks, false, BOOK_LEVELS);

    const rawBar = {
      candle_open_time: candle.openTime,
      open: round6(candle.open),
      high: round6(candle.high),
      low: round6(candle.low),
      close: round6(candle.close),
      row_size: state.baseRowSize,
      clusters,
      candle_delta: round6(candle.delta),
      cvd: round6(state.cvd),
      buy_trades: candle.buyTrades,
      sell_trades: candle.sellTrades,
      total_volume: round6(candle.buyVol + candle.sellVol),
      buy_volume: round6(candle.buyVol),
      sell_volume: round6(candle.sellVol),
      oi: round6(state.currentOI),
      oi_delta: round6(oiDelta),
      best_bid: best.bestBid,
      best_bid_size: best.bestBidSize,
      best_ask: best.bestAsk,
      best_ask_size: best.bestAskSize,
      bids,
      asks,
      unfinished_low: false,
      unfinished_high: false,
      absorption_low: false,
      absorption_high: false,
      exhaustion_low: false,
      exhaustion_high: false,
      sweep_buy: false,
      sweep_sell: false,
      delta_divergence_bull: false,
      delta_divergence_bear: false,
      alerts: [],
      orderflow_coverage: 1,
      data_source: "live_trade_footprint",
    };

    return normalizeStoredBar(
      aggregateBars([rawBar], "1m", 1, DEFAULT_STUDY_CONFIG)[0] || rawBar,
    );
  }

  function applyBookLevels(target, levels, resetOnly) {
    for (const level of levels) {
      const price = String(level?.[0] ?? "");
      const size = Number.parseFloat(level?.[1]);
      if (!price || !Number.isFinite(size)) continue;
      if (resetOnly || size > 0) {
        target.set(price, size);
      } else {
        target.delete(price);
      }
    }
  }

  function applyDepthEventLevelsToMap(target, levels) {
    for (const level of levels || []) {
      const price = String(level?.price ?? "");
      const size = Number(level?.size) || 0;
      if (!price) continue;
      if (size > 0) {
        target.set(price, size);
      } else {
        target.delete(price);
      }
    }
  }

  function topLevels(bookMap, descending, limit) {
    return [...bookMap.entries()]
      .map(([price, size]) => ({
        price: Number(price),
        size: Number(size) || 0,
      }))
      .filter((level) => Number.isFinite(level.price) && level.size > 0)
      .sort((a, b) => descending ? b.price - a.price : a.price - b.price)
      .slice(0, limit);
  }

  function computeBestBidAsk() {
    const bids = topLevels(state.bids, true, 1);
    const asks = topLevels(state.asks, false, 1);
    return {
      bestBid: bids[0]?.price || 0,
      bestBidSize: bids[0]?.size || 0,
      bestAsk: asks[0]?.price || 0,
      bestAskSize: asks[0]?.size || 0,
    };
  }

  function connect() {
    if (state.shuttingDown) return;

    setStatus("connecting");
    const ws = new WebSocket(LIVE_WS_URL);
    state.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        op: "subscribe",
        args: [
          `publicTrade.${state.symbol}`,
          `orderbook.${ORDERBOOK_TOPIC_DEPTH}.${state.symbol}`,
          `tickers.${state.symbol}`,
        ],
      }));

      if (state.heartbeatId) clearInterval(state.heartbeatId);
      state.heartbeatId = setInterval(() => {
        if (state.ws?.readyState === WebSocket.OPEN) {
          state.ws.send('{"op":"ping"}');
        }
      }, HEARTBEAT_MS);

      setStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        handleSocketPayload(JSON.parse(event.data));
      } catch {
        // Ignore malformed frames.
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      if (state.shuttingDown) return;
      setStatus("disconnected");
      if (state.heartbeatId) {
        clearInterval(state.heartbeatId);
        state.heartbeatId = null;
      }
      state.reconnectId = setTimeout(connect, RECONNECT_MS);
    };
  }

  function startBroadcastLoop() {
    state.broadcastId = setInterval(() => {
      const depthSnapshot = buildDepthSnapshot();
      if (depthSnapshot) {
        state.depthHistory.push(depthSnapshot);
        if (state.depthHistory.length > MAX_DEPTH_HISTORY) {
          state.depthHistory = state.depthHistory.slice(-MAX_DEPTH_HISTORY);
        }
        void appendDepthSnapshot(depthSnapshot, MAX_DEPTH_HISTORY, state.symbol);
        if (!state.replay.enabled) {
          postMessage({
            type: "depth",
            payload: depthSnapshot,
          });
        }
      }

      if (state.replay.enabled) {
        return;
      }

      const liveCandle = buildAggregatedLiveCandle();
      if (!liveCandle) {
        if (state.lastBroadcastLiveOpenTime !== null) {
          state.lastBroadcastLiveOpenTime = null;
          emitFullSnapshot();
        }
        return;
      }

      if (state.lastBroadcastLiveOpenTime !== liveCandle.candle_open_time) {
        state.lastBroadcastLiveOpenTime = liveCandle.candle_open_time;
        emitFullSnapshot();
        return;
      }

      postMessage({
        type: "live",
        payload: liveCandle,
      });
    }, BROADCAST_MS);
  }

  function handleSocketPayload(message) {
    const topic = typeof message?.topic === "string" ? message.topic : "";
    if (topic.startsWith("publicTrade.")) {
      handleTradeEnvelope(message);
      return;
    }
    if (topic.startsWith("orderbook.")) {
      handleOrderbookEnvelope(message);
      return;
    }
    if (topic.startsWith("tickers.")) {
      handleTickerEnvelope(message);
    }
  }

  function handleTradeEnvelope(message) {
    const trades = Array.isArray(message?.data) ? message.data : [];
    for (const trade of trades) {
      const price = Number.parseFloat(trade?.p);
      const volume = Number.parseFloat(trade?.v);
      const side = trade?.S;
      const timestamp = Number(trade?.T) || 0;
      const seq = Number(trade?.seq) || 0;
      const tradeId = typeof trade?.i === "string" ? trade.i : "";
      if (!Number.isFinite(price) || !Number.isFinite(volume) || price <= 0 || volume <= 0 || !timestamp) {
        continue;
      }
      processTrade({ price, volume, side, timestamp, seq, tradeId });
    }
  }

  function processTrade({ price, volume, side, timestamp, seq, tradeId }) {
    if (side !== "Buy" && side !== "Sell") return;

    if (tradeId) {
      if (state.seenTradeSet.has(tradeId)) return;
      state.seenTradeSet.add(tradeId);
      state.seenTradeIds.push(tradeId);
      if (state.seenTradeIds.length > MAX_SEEN_TRADE_IDS + SEEN_TRADE_ID_TRIM_BATCH) {
        const removed = state.seenTradeIds.splice(0, SEEN_TRADE_ID_TRIM_BATCH);
        removed.forEach((id) => state.seenTradeSet.delete(id));
      }
    }

    if (seq > state.lastTradeSeq) {
      state.lastTradeSeq = seq;
    }

    recordTradeEvent({
      event_id: buildReplayEventId({ timestamp, seq, tradeId, side, price, volume }),
      timestamp,
      price: round6(price),
      volume: round6(volume),
      side,
      seq,
      trade_id: tradeId,
      oi: round6(state.currentOI),
      best_bid: round6(state.bestBid),
      best_bid_size: round6(state.bestBidSize),
      best_ask: round6(state.bestAsk),
      best_ask_size: round6(state.bestAskSize),
    });

    const openTime = timestamp - (timestamp % 60_000);
    if (!state.currentCandle || openTime !== state.currentCandle.openTime) {
      rotateCurrentCandle(openTime);
    }

    addTradeToCurrentCandle(state.currentCandle, price, volume, side, seq, state.baseRowSize);
    state.cvd = round6(state.cvd + (side === "Buy" ? volume : -volume));
  }

  function rotateCurrentCandle(nextOpenTime) {
    if (state.currentCandle?.hasTick) {
      const closedBar = buildOneMinuteBar(state.currentCandle, state.currentOI - state.prevBarOI);
      state.prevBarOI = state.currentOI;
      state.completedBars.push(closedBar);
      if (state.completedBars.length > MAX_HISTORY_BARS) {
        state.completedBars = state.completedBars.slice(-MAX_HISTORY_BARS);
      }
      recomputeAggregatedHistory();
      void appendBar(closedBar, MAX_HISTORY_BARS, state.symbol);
    } else if (state.currentCandle) {
      state.prevBarOI = state.currentOI;
    }

    state.currentCandle = createLiveCandle(nextOpenTime);
  }

  function handleOrderbookEnvelope(message) {
    const book = message?.data || {};
    const bids = Array.isArray(book?.b) ? book.b : [];
    const asks = Array.isArray(book?.a) ? book.a : [];
    const timestamp = Number(message?.cts) || Number(message?.ts) || Date.now();
    const seq = Number(book?.seq) || 0;
    const updateId = Number(book?.u) || 0;
    const isSnapshot = message?.type === "snapshot" || Number(book?.u) === 1;

    if (isSnapshot) {
      state.bids = new Map();
      state.asks = new Map();
      applyBookLevels(state.bids, bids, true);
      applyBookLevels(state.asks, asks, true);
    } else {
      applyBookLevels(state.bids, bids, false);
      applyBookLevels(state.asks, asks, false);
    }

    const best = computeBestBidAsk();
    state.bestBid = best.bestBid;
    state.bestBidSize = best.bestBidSize;
    state.bestAsk = best.bestAsk;
    state.bestAskSize = best.bestAskSize;

    recordDepthEvent({
      event_id: buildDepthEventId({
        timestamp,
        seq,
        updateId,
        kind: isSnapshot ? "snapshot" : "delta",
      }),
      timestamp,
      seq,
      update_id: updateId,
      kind: isSnapshot ? "snapshot" : "delta",
      best_bid: round6(state.bestBid),
      best_bid_size: round6(state.bestBidSize),
      best_ask: round6(state.bestAsk),
      best_ask_size: round6(state.bestAskSize),
      bids: normalizeDepthEventLevels(bids),
      asks: normalizeDepthEventLevels(asks),
    });
  }

  function handleTickerEnvelope(message) {
    const payload = Array.isArray(message?.data) ? message.data[0] : message?.data;
    const oi = Number.parseFloat(payload?.openInterest);
    if (Number.isFinite(oi) && oi > 0) {
      state.currentOI = round6(oi);
    }
  }

  function recomputeAggregatedHistory() {
    state.aggregatedHistory = aggregateBars(
      state.completedBars,
      state.timeframe,
      state.tickMultiplier,
      state.studyConfig,
    ).slice(-MAX_HISTORY_BARS);
  }

  function buildAggregatedLiveCandle() {
    if (!state.currentCandle?.hasTick) return null;

    const liveRaw = buildOneMinuteBar(state.currentCandle, state.currentOI - state.prevBarOI);
    const liveFrameOpen = frameOpenTime(liveRaw.candle_open_time, state.timeframe);
    const trailingBars = [];
    for (let index = state.completedBars.length - 1; index >= 0; index -= 1) {
      const bar = state.completedBars[index];
      if (frameOpenTime(bar.candle_open_time, state.timeframe) !== liveFrameOpen) {
        break;
      }
      trailingBars.unshift(bar);
    }

    const aggregated = aggregateBars(
      [...trailingBars, liveRaw],
      state.timeframe,
      state.tickMultiplier,
      state.studyConfig,
    );
    return aggregated.at(-1) || null;
  }

  function buildDepthSnapshot() {
    const bids = topLevels(state.bids, true, BOOK_LEVELS);
    const asks = topLevels(state.asks, false, BOOK_LEVELS);
    if (!bids.length && !asks.length) {
      return null;
    }
    return {
      timestamp: Date.now(),
      row_size: state.baseRowSize,
      best_bid: state.bestBid,
      best_bid_size: state.bestBidSize,
      best_ask: state.bestAsk,
      best_ask_size: state.bestAskSize,
      bids,
      asks,
    };
  }

  function recordTradeEvent(event) {
    const normalized = normalizeReplayTrade(event);
    if (!normalized?.event_id || !normalized.timestamp) return;

    state.tradeHistory.push(normalized);
    if (state.tradeHistory.length > MAX_REPLAY_TRADES) {
      state.tradeHistory = state.tradeHistory.slice(-MAX_REPLAY_TRADES);
    }

    state.pendingTradePersist.push(normalized);
    if (state.pendingTradePersist.length >= TRADE_PERSIST_BATCH) {
      void flushPendingTrades();
    } else if (!state.tradePersistTimeoutId) {
      state.tradePersistTimeoutId = setTimeout(() => {
        state.tradePersistTimeoutId = null;
        void flushPendingTrades();
      }, TRADE_PERSIST_DEBOUNCE_MS);
    }

    if (!state.replay.enabled) {
      emitReplayState();
    }
    emitCaptureStats();
  }

  async function flushPendingTrades() {
    if (state.pendingTradePersist.length === 0) return;
    const batch = state.pendingTradePersist.splice(0, state.pendingTradePersist.length);
    if (state.tradePersistTimeoutId) {
      clearTimeout(state.tradePersistTimeoutId);
      state.tradePersistTimeoutId = null;
    }
    try {
      await appendTrades(batch, MAX_REPLAY_TRADES, state.symbol);
    } catch {
      // Cache failures should not interrupt the live engine.
    }
  }

  function recordDepthEvent(event) {
    const normalized = normalizeDepthEvent(event);
    if (!normalized?.event_id || !normalized.timestamp) return;

    state.depthEvents.push(normalized);
    if (state.depthEvents.length > MAX_DEPTH_EVENTS) {
      state.depthEvents = state.depthEvents.slice(-MAX_DEPTH_EVENTS);
    }
    state.lastDepthSeq = Math.max(state.lastDepthSeq, normalized.seq || 0);

    const persistBatch = [normalized];
    if (
      normalized.kind === "delta"
      && normalized.timestamp - state.lastDepthSnapshotPersistTs >= DEPTH_EVENT_SNAPSHOT_INTERVAL_MS
    ) {
      state.lastDepthSnapshotPersistTs = normalized.timestamp;
      const snapshotEvent = {
        ...normalized,
        kind: "snapshot",
        event_id: buildDepthEventId({
          timestamp: normalized.timestamp,
          seq: normalized.seq,
          updateId: normalized.update_id,
          kind: "snapshot",
        }),
        bids: topLevels(state.bids, true, BOOK_LEVELS),
        asks: topLevels(state.asks, false, BOOK_LEVELS),
        best_bid: round6(state.bestBid),
        best_bid_size: round6(state.bestBidSize),
        best_ask: round6(state.bestAsk),
        best_ask_size: round6(state.bestAskSize),
      };
      state.depthEvents.push(snapshotEvent);
      if (state.depthEvents.length > MAX_DEPTH_EVENTS) {
        state.depthEvents = state.depthEvents.slice(-MAX_DEPTH_EVENTS);
      }
      persistBatch.push(snapshotEvent);
    } else if (normalized.kind === "snapshot") {
      state.lastDepthSnapshotPersistTs = normalized.timestamp;
    }

    state.pendingDepthEventPersist.push(...persistBatch);
    if (state.pendingDepthEventPersist.length >= DEPTH_EVENT_PERSIST_BATCH) {
      void flushPendingDepthEvents();
    } else if (!state.depthEventPersistTimeoutId) {
      state.depthEventPersistTimeoutId = setTimeout(() => {
        state.depthEventPersistTimeoutId = null;
        void flushPendingDepthEvents();
      }, DEPTH_EVENT_PERSIST_DEBOUNCE_MS);
    }

    emitCaptureStats();
  }

  async function flushPendingDepthEvents() {
    if (state.pendingDepthEventPersist.length === 0) return;
    const batch = state.pendingDepthEventPersist.splice(0, state.pendingDepthEventPersist.length);
    if (state.depthEventPersistTimeoutId) {
      clearTimeout(state.depthEventPersistTimeoutId);
      state.depthEventPersistTimeoutId = null;
    }
    try {
      await appendDepthEvents(batch, MAX_DEPTH_EVENTS, state.symbol);
    } catch {
      // Cache failures should not interrupt the live engine.
    }
  }

  function startReplay() {
    if (state.tradeHistory.length < REPLAY_MIN_EVENTS) {
      emitReplayState();
      return;
    }

    const latestTradeTs = state.tradeHistory.at(-1)?.timestamp || 0;
    const earliestTradeTs = state.tradeHistory[0]?.timestamp || 0;
    const desiredStart = Math.max(earliestTradeTs, latestTradeTs - REPLAY_WINDOW_MS);
    const startMinuteOpen = frameOpenTime(desiredStart, "1m");

    restartReplay(startMinuteOpen, 1);
  }

  function stopReplay() {
    if (!state.replay.enabled) return;
    state.replay = createReplayState();
    emitReplayState();
    emitFullSnapshot();
  }

  function stepReplay(delta) {
    if (!state.replay.enabled || !delta) return;
    const target = clampInt(state.replay.cursor + delta, 0, state.replay.trades.length);
    if (target === state.replay.cursor) {
      emitReplayState();
      return;
    }

    if (target > state.replay.cursor) {
      advanceReplayToCursor(target);
    } else {
      rebuildReplayToCursor(target);
    }

    emitReplayState();
    emitFullSnapshot();
  }

  function restartReplay(startMinuteOpen, targetCursor) {
    prepareReplayWindow(startMinuteOpen);
    rebuildReplayToCursor(targetCursor);
    emitReplayState();
    emitFullSnapshot();
  }

  function prepareReplayWindow(startMinuteOpen) {
    const replayFrameStart = frameOpenTime(startMinuteOpen, state.timeframe);
    const baseMinuteBars = state.completedBars.filter((bar) => bar.candle_open_time < replayFrameStart);
    const seededBars = state.completedBars.filter((bar) => (
      bar.candle_open_time >= replayFrameStart && bar.candle_open_time < startMinuteOpen
    ));
    const trades = state.tradeHistory.filter((trade) => trade.timestamp >= startMinuteOpen);
    const depthSource = buildReplayDepthSource(replayFrameStart);

    state.replay = {
      enabled: trades.length >= REPLAY_MIN_EVENTS,
      startMinuteOpen,
      replayFrameStart,
      baseAggregatedBars: aggregateBars(
        baseMinuteBars,
        state.timeframe,
        state.tickMultiplier,
        state.studyConfig,
      ).slice(-MAX_HISTORY_BARS),
      seededBars: copyBars(seededBars),
      trades,
      depthSource,
      cursor: 0,
      currentTime: startMinuteOpen,
      completedBars: [],
      currentCandle: null,
      currentCvd: 0,
      currentOI: 0,
      prevBarOI: 0,
      bestBid: 0,
      bestBidSize: 0,
      bestAsk: 0,
      bestAskSize: 0,
      depthCursor: 0,
      depthHistory: [],
      currentDepth: null,
    };
  }

  function buildReplayDepthSource(startTimestamp) {
    const fallback = state.depthHistory
      .filter((snapshot) => snapshot.timestamp >= startTimestamp)
      .map(copyDepthSnapshot);

    if (!state.depthEvents.length) {
      return fallback;
    }

    let snapshotIndex = -1;
    for (let index = state.depthEvents.length - 1; index >= 0; index -= 1) {
      const event = state.depthEvents[index];
      if (event.timestamp <= startTimestamp && event.kind === "snapshot") {
        snapshotIndex = index;
        break;
      }
    }
    if (snapshotIndex < 0) {
      snapshotIndex = state.depthEvents.findIndex((event) => event.kind === "snapshot");
    }
    if (snapshotIndex < 0) {
      return fallback;
    }

    const bids = new Map();
    const asks = new Map();
    const source = [];

    for (let index = snapshotIndex; index < state.depthEvents.length; index += 1) {
      const event = state.depthEvents[index];
      if (event.kind === "snapshot") {
        bids.clear();
        asks.clear();
        applyDepthEventLevelsToMap(bids, event.bids);
        applyDepthEventLevelsToMap(asks, event.asks);
      } else {
        applyDepthEventLevelsToMap(bids, event.bids);
        applyDepthEventLevelsToMap(asks, event.asks);
      }

      if (event.timestamp < startTimestamp) {
        continue;
      }

      source.push({
        timestamp: event.timestamp,
        row_size: state.baseRowSize,
        best_bid: event.best_bid,
        best_bid_size: event.best_bid_size,
        best_ask: event.best_ask,
        best_ask_size: event.best_ask_size,
        bids: topLevels(bids, true, BOOK_LEVELS),
        asks: topLevels(asks, false, BOOK_LEVELS),
      });
    }

    return source.length ? source : fallback;
  }

  function rebuildReplayToCursor(targetCursor) {
    if (!state.replay.enabled) return;
    resetReplayRuntime();
    advanceReplayToCursor(targetCursor);
  }

  function resetReplayRuntime() {
    const replay = state.replay;
    replay.cursor = 0;
    replay.currentTime = replay.startMinuteOpen;
    replay.completedBars = copyBars(replay.seededBars);
    replay.currentCandle = null;
    replay.depthCursor = 0;
    replay.depthHistory = [];
    replay.currentDepth = null;

    const seedBar = replay.completedBars.at(-1)
      || replay.baseAggregatedBars.at(-1)
      || null;

    replay.currentCvd = Number(seedBar?.cvd) || 0;
    replay.currentOI = Number(seedBar?.oi) || 0;
    replay.prevBarOI = Number(seedBar?.oi) || 0;
    replay.bestBid = Number(seedBar?.best_bid) || 0;
    replay.bestBidSize = Number(seedBar?.best_bid_size) || 0;
    replay.bestAsk = Number(seedBar?.best_ask) || 0;
    replay.bestAskSize = Number(seedBar?.best_ask_size) || 0;

    syncReplayDepthThrough(replay.startMinuteOpen);
  }

  function advanceReplayToCursor(targetCursor) {
    const replay = state.replay;
    if (!replay.enabled) return;

    const safeTarget = clampInt(targetCursor, 0, replay.trades.length);
    for (let index = replay.cursor; index < safeTarget; index += 1) {
      applyReplayTrade(replay.trades[index]);
    }
    replay.cursor = safeTarget;
  }

  function applyReplayTrade(trade) {
    if (!trade) return;

    const replay = state.replay;
    syncReplayDepthThrough(trade.timestamp);

    const openTime = trade.timestamp - (trade.timestamp % 60_000);
    if (!replay.currentCandle || openTime !== replay.currentCandle.openTime) {
      rotateReplayCandle(openTime);
    }

    if (trade.oi > 0) {
      replay.currentOI = trade.oi;
    }
    if (trade.best_bid > 0) {
      replay.bestBid = trade.best_bid;
      replay.bestBidSize = trade.best_bid_size;
    }
    if (trade.best_ask > 0) {
      replay.bestAsk = trade.best_ask;
      replay.bestAskSize = trade.best_ask_size;
    }

    addTradeToCurrentCandle(replay.currentCandle, trade.price, trade.volume, trade.side, trade.seq, state.baseRowSize);
    replay.currentCvd = round6(replay.currentCvd + (trade.side === "Buy" ? trade.volume : -trade.volume));
    replay.currentTime = trade.timestamp;
  }

  function rotateReplayCandle(nextOpenTime) {
    const replay = state.replay;
    if (replay.currentCandle?.hasTick) {
      const closedBar = buildReplayOneMinuteBar(replay.currentCandle, replay.currentOI - replay.prevBarOI);
      replay.prevBarOI = replay.currentOI;
      replay.completedBars.push(closedBar);
      if (replay.completedBars.length > MAX_HISTORY_BARS) {
        replay.completedBars = replay.completedBars.slice(-MAX_HISTORY_BARS);
      }
    } else if (replay.currentCandle) {
      replay.prevBarOI = replay.currentOI;
    }

    replay.currentCandle = createLiveCandle(nextOpenTime);
  }

  function buildReplayOneMinuteBar(candle, oiDelta) {
    const replay = state.replay;
    const clusters = [...candle.buckets.entries()]
      .map(([bucketIndex, bucket]) => ({
        price: round6(bucketIndex * state.baseRowSize),
        buyVol: round6(bucket.buyVol),
        sellVol: round6(bucket.sellVol),
        delta: round6(bucket.buyVol - bucket.sellVol),
        totalVol: round6(bucket.buyVol + bucket.sellVol),
        buyTrades: bucket.buyTrades,
        sellTrades: bucket.sellTrades,
        maxTradeBuy: round6(bucket.maxTradeBuy),
        maxTradeSell: round6(bucket.maxTradeSell),
      }))
      .sort((a, b) => a.price - b.price);

    const depthSnapshot = replay.currentDepth;
    const rawBar = {
      candle_open_time: candle.openTime,
      open: round6(candle.open),
      high: round6(candle.high),
      low: round6(candle.low),
      close: round6(candle.close),
      row_size: state.baseRowSize,
      clusters,
      candle_delta: round6(candle.delta),
      cvd: round6(replay.currentCvd),
      buy_trades: candle.buyTrades,
      sell_trades: candle.sellTrades,
      total_volume: round6(candle.buyVol + candle.sellVol),
      buy_volume: round6(candle.buyVol),
      sell_volume: round6(candle.sellVol),
      oi: round6(replay.currentOI),
      oi_delta: round6(oiDelta),
      best_bid: round6(replay.bestBid),
      best_bid_size: round6(replay.bestBidSize),
      best_ask: round6(replay.bestAsk),
      best_ask_size: round6(replay.bestAskSize),
      bids: depthSnapshot?.bids ? copyBookLevels(depthSnapshot.bids) : [],
      asks: depthSnapshot?.asks ? copyBookLevels(depthSnapshot.asks) : [],
      unfinished_low: false,
      unfinished_high: false,
      absorption_low: false,
      absorption_high: false,
      exhaustion_low: false,
      exhaustion_high: false,
      sweep_buy: false,
      sweep_sell: false,
      delta_divergence_bull: false,
      delta_divergence_bear: false,
      alerts: [],
      orderflow_coverage: 1,
      data_source: "replay_trade_footprint",
    };

    return normalizeStoredBar(
      aggregateBars([rawBar], "1m", 1, DEFAULT_STUDY_CONFIG)[0] || rawBar,
    );
  }

  function syncReplayDepthThrough(timestamp) {
    const replay = state.replay;
    while (replay.depthCursor < replay.depthSource.length) {
      const snapshot = replay.depthSource[replay.depthCursor];
      if (snapshot.timestamp > timestamp) {
        break;
      }
      replay.currentDepth = copyDepthSnapshot(snapshot);
      replay.bestBid = snapshot.best_bid || replay.bestBid;
      replay.bestBidSize = snapshot.best_bid_size || replay.bestBidSize;
      replay.bestAsk = snapshot.best_ask || replay.bestAsk;
      replay.bestAskSize = snapshot.best_ask_size || replay.bestAskSize;
      replay.depthHistory.push(copyDepthSnapshot(snapshot));
      if (replay.depthHistory.length > MAX_DEPTH_HISTORY) {
        replay.depthHistory = replay.depthHistory.slice(-MAX_DEPTH_HISTORY);
      }
      replay.depthCursor += 1;
    }
  }

  function buildReplayAggregatedLiveCandle() {
    const replay = state.replay;
    if (!replay.currentCandle?.hasTick) return null;

    const liveRaw = buildReplayOneMinuteBar(replay.currentCandle, replay.currentOI - replay.prevBarOI);
    const liveFrameOpen = frameOpenTime(liveRaw.candle_open_time, state.timeframe);
    const trailingBars = [];
    for (let index = replay.completedBars.length - 1; index >= 0; index -= 1) {
      const bar = replay.completedBars[index];
      if (frameOpenTime(bar.candle_open_time, state.timeframe) !== liveFrameOpen) {
        break;
      }
      trailingBars.unshift(bar);
    }

    const aggregated = aggregateBars(
      [...trailingBars, liveRaw],
      state.timeframe,
      state.tickMultiplier,
      state.studyConfig,
    );
    return aggregated.at(-1) || null;
  }

  function emitStatus() {
    postMessage({
      type: "status",
      payload: state.status,
    });
  }

  function emitInstrument() {
    postMessage({
      type: "instrument",
      payload: state.instrument,
    });
  }

  function emitCaptureStats() {
    postMessage({
      type: "capture",
      payload: {
        tradeEvents: state.tradeHistory.length,
        depthEvents: state.depthEvents.length,
        depthSnapshots: state.depthHistory.length,
      },
    });
  }

  function emitReplayState() {
    const available = state.tradeHistory.length >= REPLAY_MIN_EVENTS;
    postMessage({
      type: "replay",
      payload: {
        available,
        enabled: state.replay.enabled,
        totalEvents: state.replay.enabled ? state.replay.trades.length : 0,
        cursor: state.replay.enabled ? state.replay.cursor : 0,
        startTime: state.replay.enabled ? state.replay.startMinuteOpen : null,
        currentTime: state.replay.enabled ? state.replay.currentTime : null,
      },
    });
  }

  function emitFullSnapshot() {
    if (state.replay.enabled) {
      emitReplaySnapshot();
      return;
    }

    const liveCandle = buildAggregatedLiveCandle();
    let history = copyBars(state.aggregatedHistory);

    if (liveCandle && history.at(-1)?.candle_open_time === liveCandle.candle_open_time) {
      history = history.slice(0, -1);
    }

    postMessage({
      type: "snapshot",
      payload: {
        candles: history,
        liveCandle,
        depthHistory: state.depthHistory.slice(-MAX_DEPTH_HISTORY),
        status: state.status,
      },
    });
  }

  function emitReplaySnapshot() {
    const replayHistory = aggregateBars(
      state.replay.completedBars,
      state.timeframe,
      state.tickMultiplier,
      state.studyConfig,
    );
    const liveCandle = buildReplayAggregatedLiveCandle();
    let history = mergeHistoryBars(state.replay.baseAggregatedBars, replayHistory).slice(-MAX_HISTORY_BARS);

    if (liveCandle && history.at(-1)?.candle_open_time === liveCandle.candle_open_time) {
      history = history.slice(0, -1);
    }

    postMessage({
      type: "snapshot",
      payload: {
        candles: history,
        liveCandle,
        depthHistory: state.replay.depthHistory.slice(-MAX_DEPTH_HISTORY),
        status: state.status,
      },
    });
  }

  function setStatus(nextStatus) {
    if (state.status === nextStatus) return;
    state.status = nextStatus;
    emitStatus();
  }

  return {
    init,
    updateSettings,
    startReplay,
    stopReplay,
    stepReplay,
    shutdown,
  };
}

function createReplayState() {
  return {
    enabled: false,
    startMinuteOpen: 0,
    replayFrameStart: 0,
    baseAggregatedBars: [],
    seededBars: [],
    trades: [],
    depthSource: [],
    cursor: 0,
    currentTime: 0,
    completedBars: [],
    currentCandle: null,
    currentCvd: 0,
    currentOI: 0,
    prevBarOI: 0,
    bestBid: 0,
    bestBidSize: 0,
    bestAsk: 0,
    bestAskSize: 0,
    depthCursor: 0,
    depthHistory: [],
    currentDepth: null,
  };
}

function normalizeProxyBase(proxyBase) {
  if (!proxyBase) return "/api";
  return proxyBase.endsWith("/") ? proxyBase.slice(0, -1) : proxyBase;
}

function normalizeInstrument(payload, fallbackSymbol) {
  return {
    symbol: String(payload?.symbol || fallbackSymbol || DEFAULT_SYMBOL).toUpperCase(),
    baseCoin: String(payload?.baseCoin || "").toUpperCase(),
    quoteCoin: String(payload?.quoteCoin || "").toUpperCase(),
    tickSize: Number(payload?.tickSize) || DEFAULT_ROW_SIZE,
    qtyStep: Number(payload?.qtyStep) || 0,
    minOrderQty: Number(payload?.minOrderQty) || 0,
    maxOrderQty: Number(payload?.maxOrderQty) || 0,
    minNotionalValue: Number(payload?.minNotionalValue) || 0,
    priceScale: Number(payload?.priceScale) || 1,
    defaultTicks: Array.isArray(payload?.defaultTicks) && payload.defaultTicks.length
      ? payload.defaultTicks.map((item) => Number(item) || 1).filter((item) => item > 0)
      : [1, 5, 10, 25, 50, 100],
  };
}

function buildReplayEventId({ timestamp, seq, tradeId, side, price, volume }) {
  const paddedTime = String(timestamp || 0).padStart(16, "0");
  const paddedSeq = String(seq || 0).padStart(12, "0");
  if (tradeId) {
    return `${paddedTime}:${paddedSeq}:${tradeId}`;
  }
  return `${paddedTime}:${paddedSeq}:${side}:${round6(price)}:${round6(volume)}`;
}

function buildDepthEventId({ timestamp, seq, updateId, kind }) {
  const paddedTime = String(timestamp || 0).padStart(16, "0");
  const paddedSeq = String(seq || 0).padStart(12, "0");
  const paddedUpdate = String(updateId || 0).padStart(12, "0");
  return `${paddedTime}:${paddedSeq}:${paddedUpdate}:${kind || "delta"}`;
}

function copyBookLevels(levels) {
  return (levels || []).map((level) => ({
    price: Number(level?.price) || 0,
    size: Number(level?.size) || 0,
  }));
}

function copyDepthSnapshot(snapshot) {
  return snapshot ? {
    timestamp: Number(snapshot.timestamp) || 0,
    row_size: Number(snapshot.row_size) || 0,
    best_bid: Number(snapshot.best_bid) || 0,
    best_bid_size: Number(snapshot.best_bid_size) || 0,
    best_ask: Number(snapshot.best_ask) || 0,
    best_ask_size: Number(snapshot.best_ask_size) || 0,
    bids: copyBookLevels(snapshot.bids),
    asks: copyBookLevels(snapshot.asks),
  } : null;
}

function normalizeDepthSnapshots(items) {
  return (items || [])
    .map(copyDepthSnapshot)
    .filter((snapshot) => snapshot?.timestamp);
}

function normalizeDepthEventLevels(levels) {
  return (levels || [])
    .map((level) => ({
      price: Number(level?.price ?? level?.[0]) || 0,
      size: Number(level?.size ?? level?.[1]) || 0,
    }))
    .filter((level) => level.price > 0);
}

function normalizeDepthEvent(item) {
  const depthEvent = {
    event_id: typeof item?.event_id === "string" ? item.event_id : "",
    timestamp: Number(item?.timestamp) || 0,
    seq: Number(item?.seq) || 0,
    update_id: Number(item?.update_id) || 0,
    kind: item?.kind === "snapshot" ? "snapshot" : "delta",
    best_bid: Number(item?.best_bid) || 0,
    best_bid_size: Number(item?.best_bid_size) || 0,
    best_ask: Number(item?.best_ask) || 0,
    best_ask_size: Number(item?.best_ask_size) || 0,
    bids: normalizeDepthEventLevels(item?.bids),
    asks: normalizeDepthEventLevels(item?.asks),
  };

  if (!depthEvent.event_id && depthEvent.timestamp) {
    depthEvent.event_id = buildDepthEventId({
      timestamp: depthEvent.timestamp,
      seq: depthEvent.seq,
      updateId: depthEvent.update_id,
      kind: depthEvent.kind,
    });
  }

  return depthEvent;
}

function normalizeDepthEvents(items) {
  return (items || [])
    .map(normalizeDepthEvent)
    .filter((event) => event.event_id && event.timestamp)
    .sort((a, b) => {
      const timestampDelta = a.timestamp - b.timestamp;
      if (timestampDelta !== 0) return timestampDelta;
      return a.seq - b.seq;
    });
}

function normalizeReplayTrade(item) {
  const trade = {
    event_id: typeof item?.event_id === "string" ? item.event_id : "",
    timestamp: Number(item?.timestamp) || 0,
    price: Number(item?.price) || 0,
    volume: Number(item?.volume) || 0,
    side: item?.side === "Sell" ? "Sell" : "Buy",
    seq: Number(item?.seq) || 0,
    trade_id: typeof item?.trade_id === "string" ? item.trade_id : "",
    oi: Number(item?.oi) || 0,
    best_bid: Number(item?.best_bid) || 0,
    best_bid_size: Number(item?.best_bid_size) || 0,
    best_ask: Number(item?.best_ask) || 0,
    best_ask_size: Number(item?.best_ask_size) || 0,
  };

  if (!trade.event_id && trade.timestamp) {
    trade.event_id = buildReplayEventId({
      timestamp: trade.timestamp,
      seq: trade.seq,
      tradeId: trade.trade_id,
      side: trade.side,
      price: trade.price,
      volume: trade.volume,
    });
  }

  return trade;
}

function normalizeReplayTrades(items) {
  return (items || [])
    .map(normalizeReplayTrade)
    .filter((trade) => trade.event_id && trade.timestamp && trade.price > 0 && trade.volume > 0)
    .sort((a, b) => {
      const timestampDelta = a.timestamp - b.timestamp;
      if (timestampDelta !== 0) return timestampDelta;
      return a.seq - b.seq;
    });
}

function clampInt(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, Number(value) || 0));
}

function createLiveCandle(openTime) {
  return {
    openTime,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    delta: 0,
    buyVol: 0,
    sellVol: 0,
    buyTrades: 0,
    sellTrades: 0,
    lastSeq: 0,
    hasTick: false,
    buckets: new Map(),
  };
}

function addTradeToCurrentCandle(candle, price, volume, side, seq, rowSize = DEFAULT_ROW_SIZE) {
  if (!candle.hasTick) {
    candle.open = price;
    candle.high = price;
    candle.low = price;
    candle.hasTick = true;
  }

  candle.high = Math.max(candle.high, price);
  candle.low = Math.min(candle.low, price);
  candle.close = price;
  candle.lastSeq = Math.max(candle.lastSeq, seq || 0);

  const bucketIndex = Math.floor(price / Math.max(Number(rowSize) || DEFAULT_ROW_SIZE, 0.000001));
  const bucket = candle.buckets.get(bucketIndex) || {
    buyVol: 0,
    sellVol: 0,
    buyTrades: 0,
    sellTrades: 0,
    maxTradeBuy: 0,
    maxTradeSell: 0,
  };

  if (side === "Buy") {
    bucket.buyVol += volume;
    bucket.buyTrades += 1;
    bucket.maxTradeBuy = Math.max(bucket.maxTradeBuy, volume);
    candle.delta += volume;
    candle.buyVol += volume;
    candle.buyTrades += 1;
  } else {
    bucket.sellVol += volume;
    bucket.sellTrades += 1;
    bucket.maxTradeSell = Math.max(bucket.maxTradeSell, volume);
    candle.delta -= volume;
    candle.sellVol += volume;
    candle.sellTrades += 1;
  }

  candle.buckets.set(bucketIndex, bucket);
}
