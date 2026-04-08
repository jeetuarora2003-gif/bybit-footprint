import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_SYMBOL = "BTCUSDT";

function resolveProxyBase() {
  const configured = import.meta.env.VITE_PROXY_BASE_URL;
  if (configured) {
    return configured.endsWith("/") ? configured.slice(0, -1) : configured;
  }
  return "/api";
}

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
    maxTradeBuy: Number(cluster?.maxTradeBuy) || 0,
    maxTradeSell: Number(cluster?.maxTradeSell) || 0,
    bidAskRatio: Number(cluster?.bidAskRatio) || 0,
    imbalance_buy: Boolean(cluster?.imbalance_buy),
    imbalance_sell: Boolean(cluster?.imbalance_sell),
    stacked_buy: Boolean(cluster?.stacked_buy),
    stacked_sell: Boolean(cluster?.stacked_sell),
    large_trade_buy: Boolean(cluster?.large_trade_buy),
    large_trade_sell: Boolean(cluster?.large_trade_sell),
    absorption_buy: Boolean(cluster?.absorption_buy),
    absorption_sell: Boolean(cluster?.absorption_sell),
    exhaustion_buy: Boolean(cluster?.exhaustion_buy),
    exhaustion_sell: Boolean(cluster?.exhaustion_sell),
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
    absorption_low: Boolean(candle.absorption_low),
    absorption_high: Boolean(candle.absorption_high),
    exhaustion_low: Boolean(candle.exhaustion_low),
    exhaustion_high: Boolean(candle.exhaustion_high),
    sweep_buy: Boolean(candle.sweep_buy),
    sweep_sell: Boolean(candle.sweep_sell),
    delta_divergence_bull: Boolean(candle.delta_divergence_bull),
    delta_divergence_bear: Boolean(candle.delta_divergence_bear),
    clusters: normalizeClusters(candle.clusters),
    bids: normalizeBookLevels(candle.bids),
    asks: normalizeBookLevels(candle.asks),
    alerts: Array.isArray(candle.alerts) ? candle.alerts.filter(Boolean) : [],
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

export default function useWebSocket(timeframe = "1m", tickSize = "1") {
  const [candles, setCandles] = useState([]);
  const [liveCandle, setLiveCandle] = useState(null);
  const [depthHistory, setDepthHistory] = useState([]);
  const [status, setStatus] = useState("disconnected");

  const workerRef = useRef(null);

  const applySnapshot = useCallback((payload) => {
    const nextCandles = Array.isArray(payload?.candles)
      ? payload.candles.map(normalizeCandle).filter((candle) => candle?.candle_open_time)
      : [];
    const nextLive = normalizeCandle(payload?.liveCandle);
    const nextDepth = Array.isArray(payload?.depthHistory)
      ? payload.depthHistory.map(normalizeDepthSnapshot).filter((snapshot) => snapshot.timestamp > 0)
      : [];

    setCandles(nextCandles);
    setLiveCandle(nextLive);
    setDepthHistory(nextDepth);
    if (payload?.status) {
      setStatus(payload.status);
    }
  }, []);

  const applyLiveUpdate = useCallback((payload) => {
    const nextLive = normalizeCandle(payload);
    if (!nextLive?.candle_open_time) return;
    setLiveCandle(nextLive);
  }, []);

  const appendDepthSnapshot = useCallback((payload) => {
    const nextSnapshot = normalizeDepthSnapshot(payload);
    if (!nextSnapshot.timestamp) return;

    setDepthHistory((current) => {
      const combined = [...current];
      const last = combined.at(-1);
      if (last?.timestamp === nextSnapshot.timestamp) {
        combined[combined.length - 1] = nextSnapshot;
      } else if (!last || nextSnapshot.timestamp > last.timestamp) {
        combined.push(nextSnapshot);
      }
      return combined.slice(-4000);
    });
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/marketDataWorker.js", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === "snapshot") {
        applySnapshot(payload);
      } else if (type === "live") {
        applyLiveUpdate(payload);
      } else if (type === "depth") {
        appendDepthSnapshot(payload);
      } else if (type === "status") {
        setStatus(typeof payload === "string" ? payload : "disconnected");
      }
    };

    worker.postMessage({
      type: "init",
      payload: {
        symbol: DEFAULT_SYMBOL,
        proxyBase: resolveProxyBase(),
      },
    });

    return () => {
      worker.postMessage({ type: "shutdown" });
      worker.terminate();
      workerRef.current = null;
    };
  }, [appendDepthSnapshot, applyLiveUpdate, applySnapshot]);

  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: "settings",
      payload: {
        timeframe,
        tickSize,
      },
    });
  }, [timeframe, tickSize]);

  return { candles, liveCandle, depthHistory, status };
}
