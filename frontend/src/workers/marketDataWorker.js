import {
  aggregateBars,
  copyBars,
  frameOpenTime,
  mergeHistoryBars,
  normalizeStoredBar,
  parseTickMultiplier,
  round6,
} from "../market/aggregate";
import {
  appendBar,
  appendDepthSnapshot,
  loadCacheSnapshot,
  replaceBars,
} from "../market/cache";
import { DEFAULT_STUDY_CONFIG } from "../market/studyConfig";

const LIVE_WS_URL = "wss://stream.bybit.com/v5/public/linear";
const DEFAULT_SYMBOL = "BTCUSDT";
const BASE_ROW_SIZE = 0.1;
const MAX_HISTORY_BARS = 5000;
const MAX_DEPTH_HISTORY = 4000;
const MAX_SEEN_TRADE_IDS = 200_000;
const SEEN_TRADE_ID_TRIM_BATCH = 1024;
const HEARTBEAT_MS = 20_000;
const RECONNECT_MS = 2_000;
const BROADCAST_MS = 500;
const BOOK_LEVELS = 15;

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

  if (type === "shutdown") {
    engine.shutdown();
  }
};

function createEngine() {
  const state = {
    symbol: DEFAULT_SYMBOL,
    proxyBase: "/api",
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
    lastTradeSeq: 0,
    seenTradeIds: [],
    seenTradeSet: new Set(),
    lastBroadcastLiveOpenTime: null,
  };

  async function init(payload) {
    shutdown();
    state.shuttingDown = false;
    state.symbol = payload.symbol || DEFAULT_SYMBOL;
    state.proxyBase = normalizeProxyBase(payload.proxyBase);
    state.timeframe = payload.timeframe || "1m";
    state.tickMultiplier = parseTickMultiplier(payload.tickSize);
    state.completedBars = [];
    state.aggregatedHistory = [];
    state.depthHistory = [];
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
    state.lastTradeSeq = 0;
    state.seenTradeIds = [];
    state.seenTradeSet = new Set();
    state.lastBroadcastLiveOpenTime = null;
    state.status = "loading";
    emitStatus();

    try {
      const cached = await loadCacheSnapshot();
      state.completedBars = mergeHistoryBars([], cached.bars).slice(-MAX_HISTORY_BARS);
      state.depthHistory = (cached.depth || []).slice(-MAX_DEPTH_HISTORY);
      seedRuntimeFromHistory();
      recomputeAggregatedHistory();
      emitFullSnapshot();
    } catch {
      state.completedBars = [];
      state.depthHistory = [];
      state.aggregatedHistory = [];
      emitFullSnapshot();
    }

    connect();
    startBroadcastLoop();
    void hydrateHistoryFromProxy();
  }

  function updateSettings(payload) {
    state.timeframe = payload.timeframe || state.timeframe;
    state.tickMultiplier = parseTickMultiplier(payload.tickSize);
    recomputeAggregatedHistory();
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
    if (state.ws) {
      state.ws.close();
      state.ws = null;
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
      await replaceBars(state.completedBars, MAX_HISTORY_BARS);
      emitFullSnapshot();
    } catch {
      // Live data can proceed even if the proxy is unavailable.
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
        price: round6(bucketIndex * BASE_ROW_SIZE),
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
      row_size: BASE_ROW_SIZE,
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
          `orderbook.50.${state.symbol}`,
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
    state.broadcastId = setInterval(async () => {
      const depthSnapshot = buildDepthSnapshot();
      if (depthSnapshot) {
        state.depthHistory.push(depthSnapshot);
        if (state.depthHistory.length > MAX_DEPTH_HISTORY) {
          state.depthHistory = state.depthHistory.slice(-MAX_DEPTH_HISTORY);
        }
        void appendDepthSnapshot(depthSnapshot, MAX_DEPTH_HISTORY);
        postMessage({
          type: "depth",
          payload: depthSnapshot,
        });
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

    const openTime = timestamp - (timestamp % 60_000);
    if (!state.currentCandle || openTime !== state.currentCandle.openTime) {
      rotateCurrentCandle(openTime);
    }

    addTradeToCurrentCandle(state.currentCandle, price, volume, side, seq);
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
      void appendBar(closedBar, MAX_HISTORY_BARS);
    } else if (state.currentCandle) {
      state.prevBarOI = state.currentOI;
    }

    state.currentCandle = createLiveCandle(nextOpenTime);
  }

  function handleOrderbookEnvelope(message) {
    const book = message?.data || {};
    const bids = Array.isArray(book?.b) ? book.b : [];
    const asks = Array.isArray(book?.a) ? book.a : [];

    if (message?.type === "snapshot" || Number(book?.u) === 1) {
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
  }

  function handleTickerEnvelope(message) {
    const oi = Number.parseFloat(message?.data?.openInterest);
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
      row_size: BASE_ROW_SIZE,
      best_bid: state.bestBid,
      best_bid_size: state.bestBidSize,
      best_ask: state.bestAsk,
      best_ask_size: state.bestAskSize,
      bids,
      asks,
    };
  }

  function emitStatus() {
    postMessage({
      type: "status",
      payload: state.status,
    });
  }

  function emitFullSnapshot() {
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

  function setStatus(nextStatus) {
    if (state.status === nextStatus) return;
    state.status = nextStatus;
    emitStatus();
  }

  return {
    init,
    updateSettings,
    shutdown,
  };
}

function normalizeProxyBase(proxyBase) {
  if (!proxyBase) return "/api";
  return proxyBase.endsWith("/") ? proxyBase.slice(0, -1) : proxyBase;
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

function addTradeToCurrentCandle(candle, price, volume, side, seq) {
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

  const bucketIndex = Math.floor(price / BASE_ROW_SIZE);
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
