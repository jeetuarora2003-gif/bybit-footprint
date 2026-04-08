import { useCallback, useEffect, useRef, useState } from "react";

const HOST = window.location.host;
const PROTOCOL = window.location.protocol === "https:" ? "wss:" : "ws:";
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BASE_WS = IS_LOCAL ? "ws://localhost:8080" : `${PROTOCOL}//${HOST}`;
const BASE_HTTP = IS_LOCAL ? "http://localhost:8080" : "";

const SERVER_BAR_MS = 60000;
const BASE_TICK_SIZE = 0.10;

const TF_MS = {
  "1m": 60000, "2m": 120000, "3m": 180000, "5m": 300000,
  "10m": 600000, "15m": 900000, "30m": 1800000,
  "1h": 3600000, "2h": 7200000, "4h": 14400000,
  "6h": 21600000, "8h": 28800000, "12h": 43200000,
  "D": 86400000, "W": 604800000, "M": 2592000000,
};

function timeframeMs(timeframe) {
  return Math.max(SERVER_BAR_MS, TF_MS[timeframe] ?? SERVER_BAR_MS);
}

function frameOpenTime(timestamp, timeframe) {
  const date = new Date(timestamp);

  if (timeframe === "D") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  if (timeframe === "W") {
    const day = date.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday);
  }

  if (timeframe === "M") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }

  const tfMs = timeframeMs(timeframe);
  return timestamp - (timestamp % tfMs);
}

function rowSizeFromMultiplier(tickMultiplier) {
  const multiplier = Number.parseFloat(tickMultiplier);
  return BASE_TICK_SIZE * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
}

function round6(value) {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

function roundPrice(value) {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

function bucketPrice(price, rowSize) {
  return roundPrice(Math.floor((price + Number.EPSILON) / rowSize) * rowSize);
}

function markStacked(clusters, predicateKey, stackedKey) {
  let streak = [];

  const flush = () => {
    if (streak.length >= 3) {
      streak.forEach((index) => {
        clusters[index][stackedKey] = true;
      });
    }
    streak = [];
  };

  clusters.forEach((cluster, index) => {
    if (cluster[predicateKey]) {
      streak.push(index);
      return;
    }
    flush();
  });
  flush();
}

function annotateClusters(clusters) {
  const normalized = (clusters || []).map((cluster) => ({
    price: roundPrice(Number(cluster.price) || 0),
    buyVol: round6(Number(cluster.buyVol) || 0),
    sellVol: round6(Number(cluster.sellVol) || 0),
    delta: round6(Number(cluster.delta) || ((Number(cluster.buyVol) || 0) - (Number(cluster.sellVol) || 0))),
    totalVol: round6(Number(cluster.totalVol) || ((Number(cluster.buyVol) || 0) + (Number(cluster.sellVol) || 0))),
    buyTrades: Number(cluster.buyTrades) || 0,
    sellTrades: Number(cluster.sellTrades) || 0,
    imbalance_buy: false,
    imbalance_sell: false,
    stacked_buy: false,
    stacked_sell: false,
  })).sort((a, b) => a.price - b.price);

  normalized.forEach((cluster, index) => {
    const below = normalized[index - 1];
    const above = normalized[index + 1];

    if (below && below.sellVol > 0 && cluster.buyVol >= below.sellVol * 3 && cluster.buyVol >= 1) {
      cluster.imbalance_buy = true;
    }
    if (above && above.buyVol > 0 && cluster.sellVol >= above.buyVol * 3 && cluster.sellVol >= 1) {
      cluster.imbalance_sell = true;
    }
  });

  markStacked(normalized, "imbalance_buy", "stacked_buy");
  markStacked(normalized, "imbalance_sell", "stacked_sell");
  return normalized;
}

function normalizeClusters(clusters, rowSize) {
  const buckets = new Map();

  for (const cluster of clusters || []) {
    const price = bucketPrice(Number(cluster.price), rowSize);
    const prev = buckets.get(price) ?? {
      price,
      buyVol: 0,
      sellVol: 0,
      delta: 0,
      totalVol: 0,
      buyTrades: 0,
      sellTrades: 0,
    };
    prev.buyVol += Number(cluster.buyVol) || 0;
    prev.sellVol += Number(cluster.sellVol) || 0;
    prev.buyTrades += Number(cluster.buyTrades) || 0;
    prev.sellTrades += Number(cluster.sellTrades) || 0;
    buckets.set(price, prev);
  }

  return annotateClusters([...buckets.values()].map((cluster) => ({
    price: cluster.price,
    buyVol: round6(cluster.buyVol),
    sellVol: round6(cluster.sellVol),
    delta: round6(cluster.buyVol - cluster.sellVol),
    totalVol: round6(cluster.buyVol + cluster.sellVol),
    buyTrades: cluster.buyTrades,
    sellTrades: cluster.sellTrades,
  })));
}

function mergeIntoFrame(frame, candle, rowSize) {
  frame.high = Math.max(frame.high, Number(candle.high));
  frame.low = Math.min(frame.low, Number(candle.low));
  frame.close = Number(candle.close);
  frame.candle_delta += Number(candle.candle_delta) || 0;
  frame.total_volume += Number(candle.total_volume) || 0;
  frame.buy_volume += Number(candle.buy_volume) || 0;
  frame.sell_volume += Number(candle.sell_volume) || 0;
  frame.buy_trades += Number(candle.buy_trades) || 0;
  frame.sell_trades += Number(candle.sell_trades) || 0;
  frame.oi_delta += Number(candle.oi_delta) || 0;
  frame.cvd = Number(candle.cvd) || frame.cvd;
  frame.oi = Number(candle.oi) || frame.oi;
  frame.best_bid = Number(candle.best_bid) || frame.best_bid;
  frame.best_bid_size = Number(candle.best_bid_size) || frame.best_bid_size;
  frame.best_ask = Number(candle.best_ask) || frame.best_ask;
  frame.best_ask_size = Number(candle.best_ask_size) || frame.best_ask_size;
  frame.bids = candle.bids || frame.bids;
  frame.asks = candle.asks || frame.asks;
  frame.row_size = Number(candle.row_size) || frame.row_size || rowSize;
  frame.clusters = normalizeClusters([...frame.clusters, ...(candle.clusters || [])], rowSize);
  frame.unfinished_low = Boolean(frame.clusters[0]?.buyVol > 0 && frame.clusters[0]?.sellVol > 0);
  frame.unfinished_high = Boolean(frame.clusters.at(-1)?.buyVol > 0 && frame.clusters.at(-1)?.sellVol > 0);
}

function makeFrame(candle, openTime, rowSize) {
  const frame = {
    ...candle,
    candle_open_time: openTime,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    clusters: [],
    candle_delta: 0,
    total_volume: 0,
    buy_volume: 0,
    sell_volume: 0,
    buy_trades: 0,
    sell_trades: 0,
    oi_delta: 0,
    row_size: Number(candle.row_size) || rowSize,
    unfinished_low: false,
    unfinished_high: false,
  };
  mergeIntoFrame(frame, candle, rowSize);
  return frame;
}

function aggregateCandles(sourceCandles, timeframe, tickMultiplier) {
  const rowSize = rowSizeFromMultiplier(tickMultiplier);
  const frames = [];
  let current = null;

  for (const candle of sourceCandles) {
    if (!candle || candle.candle_open_time == null) continue;
    const sourceOpen = Number(candle.candle_open_time);
    const openTime = frameOpenTime(sourceOpen, timeframe);

    if (!current || current.candle_open_time !== openTime) {
      current = makeFrame(candle, openTime, rowSize);
      frames.push(current);
    } else {
      mergeIntoFrame(current, candle, rowSize);
    }
  }

  return frames.map((frame) => ({
    ...frame,
    candle_delta: round6(frame.candle_delta),
    total_volume: round6(frame.total_volume),
    buy_volume: round6(frame.buy_volume),
    sell_volume: round6(frame.sell_volume),
    oi_delta: round6(frame.oi_delta),
  }));
}

export default function useWebSocket(timeframe = "1m", tickSize = "1") {
  const [candles, setCandles] = useState([]);
  const [liveCandle, setLiveCandle] = useState(null);
  const [recentTrades, setRecentTrades] = useState([]);
  const [status, setStatus] = useState("disconnected");

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const connectRef = useRef(() => {});
  const stoppedRef = useRef(false);
  const baseCandlesRef = useRef(new Map());
  const timeframeRef = useRef(timeframe);
  const tickSizeRef = useRef(tickSize);

  const publishAggregated = useCallback(() => {
    const source = [...baseCandlesRef.current.values()]
      .sort((a, b) => Number(a.candle_open_time) - Number(b.candle_open_time));
    const aggregated = aggregateCandles(source, timeframeRef.current, tickSizeRef.current);

    setCandles(aggregated.slice(0, -1));
    setLiveCandle(aggregated.at(-1) ?? null);
  }, []);

  const upsertBaseCandles = useCallback((incoming) => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    for (const candle of list) {
      if (candle?.candle_open_time == null) continue;
      baseCandlesRef.current.set(Number(candle.candle_open_time), candle);
      if (Array.isArray(candle?.recent_trades)) {
        setRecentTrades(candle.recent_trades);
      }
    }

    const keys = [...baseCandlesRef.current.keys()].sort((a, b) => a - b);
    if (keys.length > 600) {
      for (const key of keys.slice(0, keys.length - 600)) {
        baseCandlesRef.current.delete(key);
      }
    }
    publishAggregated();
  }, [publishAggregated]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_HTTP}/history`);
      const hist = await res.json();
      if (Array.isArray(hist)) {
        upsertBaseCandles(hist);
      }
    } catch (error) {
      console.warn("[history] not available, starting from live:", error.message);
    }
  }, [upsertBaseCandles]);

  const fetchTape = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_HTTP}/tape`);
      const tape = await res.json();
      if (Array.isArray(tape)) {
        setRecentTrades(tape);
      }
    } catch (error) {
      console.warn("[tape] not available:", error.message);
    }
  }, []);

  const connect = useCallback(() => {
    if (stoppedRef.current) return;
    if (wsRef.current) wsRef.current.close();

    setStatus("connecting");
    fetchHistory();
    fetchTape();

    const ws = new WebSocket(BASE_WS);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (evt) => {
      try {
        upsertBaseCandles(JSON.parse(evt.data));
      } catch {
        // Ignore malformed frames from transient network/proxy issues.
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      if (stoppedRef.current) return;
      setStatus("disconnected");
      reconnectRef.current = setTimeout(() => connectRef.current(), 2000);
    };
  }, [fetchHistory, fetchTape, upsertBaseCandles]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    stoppedRef.current = false;
    const startTimer = setTimeout(() => connectRef.current(), 0);
    return () => {
      stoppedRef.current = true;
      clearTimeout(startTimer);
      clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  useEffect(() => {
    timeframeRef.current = timeframe;
    tickSizeRef.current = tickSize;
    publishAggregated();
  }, [timeframe, tickSize, publishAggregated]);

  return { candles, liveCandle, recentTrades, status };
}
