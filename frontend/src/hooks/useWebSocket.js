import { useCallback, useEffect, useRef, useState } from "react";

const HOST = window.location.host;
const PROTOCOL = window.location.protocol === "https:" ? "wss:" : "ws:";
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BASE_WS = IS_LOCAL ? "ws://localhost:8080" : `${PROTOCOL}//${HOST}`;
const BASE_HTTP = IS_LOCAL ? "http://localhost:8080" : "";
const HISTORY_LIMIT = 5000;

function normalizeBookLevels(levels) {
  return (levels || []).map((level) => ({
    price: Number(level?.price) || 0,
    size: Number(level?.size) || 0,
  }));
}

function normalizeClusters(clusters) {
  return (clusters || []).map((cluster) => ({
    price: Number(cluster?.price) || 0,
    buyVol: Number(cluster?.buyVol) || 0,
    sellVol: Number(cluster?.sellVol) || 0,
    delta: Number(cluster?.delta) || 0,
    totalVol: Number(cluster?.totalVol) || 0,
    buyTrades: Number(cluster?.buyTrades) || 0,
    sellTrades: Number(cluster?.sellTrades) || 0,
    imbalance_buy: Boolean(cluster?.imbalance_buy),
    imbalance_sell: Boolean(cluster?.imbalance_sell),
    stacked_buy: Boolean(cluster?.stacked_buy),
    stacked_sell: Boolean(cluster?.stacked_sell),
  }));
}

function normalizeCandle(candle) {
  if (!candle) return null;
  const buyTrades = Number(candle.buy_trades) || 0;
  const sellTrades = Number(candle.sell_trades) || 0;
  const buyVolume = Number(candle.buy_volume) || 0;
  const sellVolume = Number(candle.sell_volume) || 0;
  const orderflowCoverage = Number(candle.orderflow_coverage);
  const inferredCoverage = candle?.clusters?.length || buyTrades > 0 || sellTrades > 0 || buyVolume > 0 || sellVolume > 0 ? 1 : 0;
  return {
    ...candle,
    candle_open_time: Number(candle.candle_open_time) || 0,
    open: Number(candle.open) || 0,
    high: Number(candle.high) || 0,
    low: Number(candle.low) || 0,
    close: Number(candle.close) || 0,
    row_size: Number(candle.row_size) || 0,
    candle_delta: Number(candle.candle_delta) || 0,
    cvd: Number(candle.cvd) || 0,
    buy_trades: buyTrades,
    sell_trades: sellTrades,
    total_volume: Number(candle.total_volume) || 0,
    buy_volume: buyVolume,
    sell_volume: sellVolume,
    oi: Number(candle.oi) || 0,
    oi_delta: Number(candle.oi_delta) || 0,
    best_bid: Number(candle.best_bid) || 0,
    best_bid_size: Number(candle.best_bid_size) || 0,
    best_ask: Number(candle.best_ask) || 0,
    best_ask_size: Number(candle.best_ask_size) || 0,
    unfinished_low: Boolean(candle.unfinished_low),
    unfinished_high: Boolean(candle.unfinished_high),
    clusters: normalizeClusters(candle.clusters),
    bids: normalizeBookLevels(candle.bids),
    asks: normalizeBookLevels(candle.asks),
    orderflow_coverage: Number.isFinite(orderflowCoverage) ? orderflowCoverage : inferredCoverage,
    data_source: candle.data_source || (inferredCoverage >= 1 ? "live_trade_footprint" : "bybit_kline_backfill"),
  };
}

function normalizeDepthSnapshot(snapshot) {
  return {
    timestamp: Number(snapshot?.timestamp) || 0,
    row_size: Number(snapshot?.row_size) || 0,
    best_bid: Number(snapshot?.best_bid) || 0,
    best_bid_size: Number(snapshot?.best_bid_size) || 0,
    best_ask: Number(snapshot?.best_ask) || 0,
    best_ask_size: Number(snapshot?.best_ask_size) || 0,
    bids: normalizeBookLevels(snapshot?.bids),
    asks: normalizeBookLevels(snapshot?.asks),
  };
}

function buildChartQuery(timeframe, tickSize) {
  const params = new URLSearchParams({
    timeframe,
    tickSize,
    limit: String(HISTORY_LIMIT),
  });
  return params.toString();
}

export default function useWebSocket(timeframe = "1m", tickSize = "1") {
  const [candles, setCandles] = useState([]);
  const [liveCandle, setLiveCandle] = useState(null);
  const [depthHistory, setDepthHistory] = useState([]);
  const [status, setStatus] = useState("disconnected");

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const stoppedRef = useRef(false);
  const candleMapRef = useRef(new Map());
  const depthHistoryRef = useRef([]);

  const publishCandles = useCallback(() => {
    const ordered = [...candleMapRef.current.values()]
      .sort((a, b) => Number(a.candle_open_time) - Number(b.candle_open_time));
    setCandles(ordered.slice(0, -1));
    setLiveCandle(ordered.at(-1) ?? null);
  }, []);

  const upsertCandles = useCallback((incoming) => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    for (const raw of list) {
      const candle = normalizeCandle(raw);
      if (!candle?.candle_open_time) continue;
      candleMapRef.current.set(candle.candle_open_time, candle);
    }

    const keys = [...candleMapRef.current.keys()].sort((a, b) => a - b);
    if (keys.length > HISTORY_LIMIT) {
      for (const key of keys.slice(0, keys.length - HISTORY_LIMIT)) {
        candleMapRef.current.delete(key);
      }
    }

    publishCandles();
  }, [publishCandles]);

  const fetchHistory = useCallback(async (query) => {
    try {
      const res = await fetch(`${BASE_HTTP}/history?${query}`);
      const hist = await res.json();
      if (Array.isArray(hist)) {
        upsertCandles(hist);
      }
    } catch (error) {
      console.warn("[history] not available, starting from live:", error.message);
    }
  }, [upsertCandles]);

  const fetchDepthHistory = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_HTTP}/depth-history`);
      const depth = await res.json();
      if (Array.isArray(depth)) {
        const normalized = depth
          .map(normalizeDepthSnapshot)
          .filter((snapshot) => snapshot.timestamp > 0);
        depthHistoryRef.current = normalized.slice(-4000);
        setDepthHistory(depthHistoryRef.current);
      }
    } catch (error) {
      console.warn("[depth-history] not available:", error.message);
    }
  }, []);

  const appendDepthSnapshots = useCallback((incoming) => {
    const list = (Array.isArray(incoming) ? incoming : [incoming])
      .map(normalizeDepthSnapshot)
      .filter((snapshot) => snapshot.timestamp > 0);
    if (list.length === 0) return;

    const combined = [...depthHistoryRef.current];
    for (const snapshot of list) {
      const last = combined.at(-1);
      if (last?.timestamp === snapshot.timestamp) {
        combined[combined.length - 1] = snapshot;
      } else if (!last || snapshot.timestamp > last.timestamp) {
        combined.push(snapshot);
      }
    }

    depthHistoryRef.current = combined.slice(-4000);
    setDepthHistory(depthHistoryRef.current);
  }, []);

  useEffect(() => {
    stoppedRef.current = false;

    const query = buildChartQuery(timeframe, tickSize);

    const connect = () => {
      if (stoppedRef.current) return;
      if (wsRef.current) wsRef.current.close();

      setStatus("connecting");
      fetchHistory(query);
      fetchDepthHistory();

      const ws = new WebSocket(`${BASE_WS}?${query}`);
      wsRef.current = ws;

      ws.onopen = () => setStatus("connected");

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message?.type === "depth" && message?.payload) {
            appendDepthSnapshots(message.payload);
            return;
          }
          if (message?.type === "candle" && message?.payload) {
            upsertCandles(message.payload);
            return;
          }
          upsertCandles(message);
        } catch {
          // Ignore malformed frames from transient network/proxy issues.
        }
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        if (stoppedRef.current) return;
        setStatus("disconnected");
        reconnectRef.current = setTimeout(connect, 2000);
      };
    };

    const startTimer = setTimeout(() => {
      candleMapRef.current = new Map();
      depthHistoryRef.current = [];
      setCandles([]);
      setLiveCandle(null);
      setDepthHistory([]);
      connect();
    }, 0);

    return () => {
      stoppedRef.current = true;
      clearTimeout(startTimer);
      clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [appendDepthSnapshots, fetchDepthHistory, fetchHistory, tickSize, timeframe, upsertCandles]);

  return { candles, liveCandle, depthHistory, status };
}
