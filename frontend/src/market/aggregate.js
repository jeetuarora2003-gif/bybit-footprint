import { DEFAULT_STUDY_CONFIG } from "./studyConfig";

const BASE_ROW_SIZE = 0.1;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const TIMEFRAME_DEFINITIONS = {
  "1m": { type: "fixed", ms: 1 * MINUTE },
  "2m": { type: "fixed", ms: 2 * MINUTE },
  "3m": { type: "fixed", ms: 3 * MINUTE },
  "5m": { type: "fixed", ms: 5 * MINUTE },
  "10m": { type: "fixed", ms: 10 * MINUTE },
  "15m": { type: "fixed", ms: 15 * MINUTE },
  "30m": { type: "fixed", ms: 30 * MINUTE },
  "1h": { type: "fixed", ms: 1 * HOUR },
  "2h": { type: "fixed", ms: 2 * HOUR },
  "4h": { type: "fixed", ms: 4 * HOUR },
  "6h": { type: "fixed", ms: 6 * HOUR },
  "8h": { type: "fixed", ms: 8 * HOUR },
  "12h": { type: "fixed", ms: 12 * HOUR },
  D: { type: "day" },
  W: { type: "week" },
  M: { type: "month" },
};

const SUPPORTED_TIMEFRAMES = new Set(Object.keys(TIMEFRAME_DEFINITIONS));

export function round6(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

export function normalizeTimeframe(timeframe) {
  return SUPPORTED_TIMEFRAMES.has(timeframe) ? timeframe : "1m";
}

export function parseTickMultiplier(value) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

export function aggregatedRowSize(tickMultiplier, baseRowSize = BASE_ROW_SIZE) {
  return round6((Number(baseRowSize) || BASE_ROW_SIZE) * parseTickMultiplier(tickMultiplier));
}

function monthStartUtc(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function timeframeOpenTime(timestamp, timeframe) {
  const definition = TIMEFRAME_DEFINITIONS[normalizeTimeframe(timeframe)] || TIMEFRAME_DEFINITIONS["1m"];
  const value = Number(timestamp) || 0;

  if (definition.type === "fixed") {
    return value - (value % definition.ms);
  }

  const date = new Date(value);
  switch (definition.type) {
    case "day":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    case "week": {
      const dayOfWeek = date.getUTCDay();
      const mondayOffset = (dayOfWeek + 6) % 7;
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset);
    }
    case "month":
      return monthStartUtc(value);
    default:
      return value - (value % MINUTE);
  }
}

function nextFrameOpenTime(timestamp, timeframe) {
  const normalized = normalizeTimeframe(timeframe);
  const definition = TIMEFRAME_DEFINITIONS[normalized] || TIMEFRAME_DEFINITIONS["1m"];
  const openTime = timeframeOpenTime(timestamp, normalized);

  if (definition.type === "fixed") {
    return openTime + definition.ms;
  }

  const date = new Date(openTime);
  switch (definition.type) {
    case "day":
      return openTime + DAY;
    case "week":
      return openTime + WEEK;
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    default:
      return openTime + MINUTE;
  }
}

export function timeframeDurationMs(timeframe, timestamp = Date.now()) {
  const normalized = normalizeTimeframe(timeframe);
  const definition = TIMEFRAME_DEFINITIONS[normalized] || TIMEFRAME_DEFINITIONS["1m"];
  if (definition.type === "fixed") {
    return definition.ms;
  }
  const openTime = timeframeOpenTime(timestamp, normalized);
  return nextFrameOpenTime(openTime, normalized) - openTime;
}

export function frameOpenTime(timestamp, timeframe) {
  return timeframeOpenTime(timestamp, timeframe);
}

function copyBookLevels(levels) {
  return (levels || []).map((level) => ({
    price: Number(level?.price) || 0,
    size: Number(level?.size) || 0,
  }));
}

function copyClusters(clusters) {
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

export function copyBars(bars) {
  return (bars || []).map((bar) => ({
    candle_open_time: Number(bar?.candle_open_time) || 0,
    open: Number(bar?.open) || 0,
    high: Number(bar?.high) || 0,
    low: Number(bar?.low) || 0,
    close: Number(bar?.close) || 0,
    row_size: Number(bar?.row_size) || BASE_ROW_SIZE,
    clusters: copyClusters(bar?.clusters),
    candle_delta: Number(bar?.candle_delta) || 0,
    cvd: Number(bar?.cvd) || 0,
    buy_trades: Number(bar?.buy_trades) || 0,
    sell_trades: Number(bar?.sell_trades) || 0,
    total_volume: Number(bar?.total_volume) || 0,
    buy_volume: Number(bar?.buy_volume) || 0,
    sell_volume: Number(bar?.sell_volume) || 0,
    oi: Number(bar?.oi) || 0,
    oi_delta: Number(bar?.oi_delta) || 0,
    best_bid: Number(bar?.best_bid) || 0,
    best_bid_size: Number(bar?.best_bid_size) || 0,
    best_ask: Number(bar?.best_ask) || 0,
    best_ask_size: Number(bar?.best_ask_size) || 0,
    bids: copyBookLevels(bar?.bids),
    asks: copyBookLevels(bar?.asks),
    unfinished_low: Boolean(bar?.unfinished_low),
    unfinished_high: Boolean(bar?.unfinished_high),
    absorption_low: Boolean(bar?.absorption_low),
    absorption_high: Boolean(bar?.absorption_high),
    exhaustion_low: Boolean(bar?.exhaustion_low),
    exhaustion_high: Boolean(bar?.exhaustion_high),
    sweep_buy: Boolean(bar?.sweep_buy),
    sweep_sell: Boolean(bar?.sweep_sell),
    delta_divergence_bull: Boolean(bar?.delta_divergence_bull),
    delta_divergence_bear: Boolean(bar?.delta_divergence_bear),
    alerts: Array.isArray(bar?.alerts) ? [...bar.alerts] : [],
    orderflow_coverage: Number(bar?.orderflow_coverage) || 0,
    data_source: typeof bar?.data_source === "string" ? bar.data_source : "",
  }));
}

export function normalizeStoredBar(bar) {
  const normalized = copyBars([bar])[0] || null;
  if (!normalized) return null;

  const hasOrderflow = normalized.clusters.length > 0
    || normalized.buy_trades > 0
    || normalized.sell_trades > 0
    || normalized.buy_volume > 0
    || normalized.sell_volume > 0;

  if (normalized.orderflow_coverage <= 0) {
    normalized.orderflow_coverage = hasOrderflow ? 1 : 0;
  }
  normalized.orderflow_coverage = Math.max(0, Math.min(1, round6(normalized.orderflow_coverage)));

  if (!normalized.data_source) {
    normalized.data_source = normalized.orderflow_coverage >= 0.999
      ? "live_trade_footprint"
      : "bybit_kline_backfill";
  }

  return normalized;
}

export function mergeHistoryBars(baseBars, incomingBars) {
  const barsByOpenTime = new Map();
  for (const bar of baseBars || []) {
    const normalized = normalizeStoredBar(bar);
    if (normalized?.candle_open_time) {
      barsByOpenTime.set(normalized.candle_open_time, normalized);
    }
  }

  for (const bar of incomingBars || []) {
    const normalized = normalizeStoredBar(bar);
    if (!normalized?.candle_open_time) continue;
    const existing = barsByOpenTime.get(normalized.candle_open_time);
    barsByOpenTime.set(
      normalized.candle_open_time,
      existing ? preferHistoricalBar(existing, normalized) : normalized,
    );
  }

  return [...barsByOpenTime.values()].sort((a, b) => a.candle_open_time - b.candle_open_time);
}

function preferHistoricalBar(existing, candidate) {
  if (existing.orderflow_coverage > candidate.orderflow_coverage) return existing;
  if (candidate.orderflow_coverage > existing.orderflow_coverage) return candidate;

  const existingHasOrderflow = existing.orderflow_coverage >= 0.999;
  const candidateHasOrderflow = candidate.orderflow_coverage >= 0.999;
  if (existingHasOrderflow && !candidateHasOrderflow) return existing;
  if (candidate.total_volume > 0 && existing.total_volume === 0) return candidate;
  if (existing.oi !== 0 && candidate.oi === 0) return existing;
  return existing;
}

function bucketPriceForSize(price, targetRowSize) {
  const rowSize = targetRowSize > 0 ? targetRowSize : BASE_ROW_SIZE;
  return round6(Math.floor((Number(price) + Number.EPSILON) / rowSize) * rowSize);
}

function normalizeAggregatedClusters(clusters, targetRowSize, studyConfig) {
  if (!clusters?.length) {
    return { clusters: [], summary: emptySignalSummary() };
  }

  const buckets = new Map();
  for (const cluster of clusters) {
    const price = bucketPriceForSize(cluster.price, targetRowSize);
    const current = buckets.get(price) || {
      buyVol: 0,
      sellVol: 0,
      buyTrades: 0,
      sellTrades: 0,
      maxTradeBuy: 0,
      maxTradeSell: 0,
    };
    current.buyVol += Number(cluster.buyVol) || 0;
    current.sellVol += Number(cluster.sellVol) || 0;
    current.buyTrades += Number(cluster.buyTrades) || 0;
    current.sellTrades += Number(cluster.sellTrades) || 0;
    current.maxTradeBuy = Math.max(current.maxTradeBuy, Number(cluster.maxTradeBuy) || 0);
    current.maxTradeSell = Math.max(current.maxTradeSell, Number(cluster.maxTradeSell) || 0);
    buckets.set(price, current);
  }

  const normalized = [...buckets.entries()]
    .map(([price, item]) => ({
      price: round6(price),
      buyVol: round6(item.buyVol),
      sellVol: round6(item.sellVol),
      delta: round6(item.buyVol - item.sellVol),
      totalVol: round6(item.buyVol + item.sellVol),
      buyTrades: item.buyTrades,
      sellTrades: item.sellTrades,
      maxTradeBuy: round6(item.maxTradeBuy),
      maxTradeSell: round6(item.maxTradeSell),
      bidAskRatio: 0,
      imbalance_buy: false,
      imbalance_sell: false,
      stacked_buy: false,
      stacked_sell: false,
      large_trade_buy: false,
      large_trade_sell: false,
      absorption_buy: false,
      absorption_sell: false,
      exhaustion_buy: false,
      exhaustion_sell: false,
    }))
    .sort((a, b) => a.price - b.price);

  return {
    clusters: normalized,
    summary: annotateClusterSignals(normalized, studyConfig),
  };
}

function emptySignalSummary() {
  return {
    unfinishedLow: false,
    unfinishedHigh: false,
    absorptionLow: false,
    absorptionHigh: false,
    exhaustionLow: false,
    exhaustionHigh: false,
    imbalanceCount: 0,
    stackedCount: 0,
    largeTradeCount: 0,
  };
}

export function annotateClusterSignals(clusters, studyConfig = DEFAULT_STUDY_CONFIG) {
  if (!clusters?.length) {
    return emptySignalSummary();
  }

  const bullish = new Array(clusters.length).fill(false);
  const bearish = new Array(clusters.length).fill(false);
  const summary = emptySignalSummary();
  let avgTotalVol = 0;
  for (const cluster of clusters) {
    avgTotalVol += Number(cluster.totalVol) || 0;
  }
  avgTotalVol /= Math.max(1, clusters.length);

  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index];
    cluster.bidAskRatio = round6((cluster.buyVol + 1e-9) / (cluster.sellVol + 1e-9));
    cluster.large_trade_buy = cluster.maxTradeBuy >= studyConfig.large_trade_threshold;
    cluster.large_trade_sell = cluster.maxTradeSell >= studyConfig.large_trade_threshold;
    if (cluster.large_trade_buy || cluster.large_trade_sell) {
      summary.largeTradeCount += 1;
    }

    // Exocharts-style imbalance compares diagonally:
    // ask/buy volume at the current price against bid/sell volume one level below,
    // and bid/sell volume at the current price against ask/buy volume one level above.
    if (index > 0) {
      const below = clusters[index - 1];
      if (below.sellVol > 0
        && cluster.buyVol >= below.sellVol * studyConfig.imbalance_threshold
        && cluster.buyVol >= studyConfig.min_imbalance_volume) {
        bullish[index] = true;
        cluster.imbalance_buy = true;
        summary.imbalanceCount += 1;
      }
    }

    if (index + 1 < clusters.length) {
      const above = clusters[index + 1];
      if (above.buyVol > 0
        && cluster.sellVol >= above.buyVol * studyConfig.imbalance_threshold
        && cluster.sellVol >= studyConfig.min_imbalance_volume) {
        bearish[index] = true;
        cluster.imbalance_sell = true;
        summary.imbalanceCount += 1;
      }
    }
  }

  summary.stackedCount += markStackedSide(clusters, bullish, true, studyConfig.stacked_levels);
  summary.stackedCount += markStackedSide(clusters, bearish, false, studyConfig.stacked_levels);

  const low = clusters[0];
  const high = clusters[clusters.length - 1];
  summary.unfinishedLow = low.buyVol > 0 && low.sellVol > 0;
  summary.unfinishedHigh = high.buyVol > 0 && high.sellVol > 0;

  const highVolumeThreshold = avgTotalVol * studyConfig.absorption_volume_factor;
  const lowVolumeThreshold = avgTotalVol * studyConfig.exhaustion_volume_factor;

  if (
    low.totalVol >= highVolumeThreshold
    && low.buyVol > 0
    && low.sellVol > 0
    && low.buyVol >= low.sellVol * studyConfig.absorption_ratio_threshold
  ) {
    low.absorption_buy = true;
    summary.absorptionLow = true;
  }

  if (
    high.totalVol >= highVolumeThreshold
    && high.buyVol > 0
    && high.sellVol > 0
    && high.sellVol >= high.buyVol * studyConfig.absorption_ratio_threshold
  ) {
    high.absorption_sell = true;
    summary.absorptionHigh = true;
  }

  if (
    low.totalVol > 0
    && low.totalVol <= lowVolumeThreshold
    && low.sellVol >= low.buyVol * studyConfig.bid_ask_ratio_threshold
  ) {
    low.exhaustion_sell = true;
    summary.exhaustionLow = true;
  }

  if (
    high.totalVol > 0
    && high.totalVol <= lowVolumeThreshold
    && high.buyVol >= high.sellVol * studyConfig.bid_ask_ratio_threshold
  ) {
    high.exhaustion_buy = true;
    summary.exhaustionHigh = true;
  }

  return summary;
}

function markStackedSide(clusters, flags, buySide, required) {
  let streak = [];
  let marked = 0;

  const flush = () => {
    if (streak.length < required) {
      streak = [];
      return;
    }
    for (const index of streak) {
      if (buySide) {
        clusters[index].stacked_buy = true;
      } else {
        clusters[index].stacked_sell = true;
      }
      marked += 1;
    }
    streak = [];
  };

  flags.forEach((flag, index) => {
    if (flag) {
      streak.push(index);
      return;
    }
    flush();
  });
  flush();
  return marked;
}

function buildCandleAlerts(message, summary, studyConfig = DEFAULT_STUDY_CONFIG) {
  if (!message || message.orderflow_coverage <= 0) {
    return [];
  }

  const alerts = [];
  if (summary.imbalanceCount > 0) {
    alerts.push(summary.stackedCount > 0 ? "STACKED IMB" : "IMB");
  }
  if (summary.absorptionLow || summary.absorptionHigh) alerts.push("ABS");
  if (summary.exhaustionLow || summary.exhaustionHigh) alerts.push("EXH");
  if (summary.largeTradeCount > 0) alerts.push("LARGE");

  let rangeTicks = 0;
  if (message.row_size > 0) {
    rangeTicks = (message.high - message.low) / message.row_size;
  }
  const volumeDenominator = Math.max(message.total_volume || 0, 1e-9);
  const deltaRatio = Math.abs(message.candle_delta || 0) / volumeDenominator;
  if (rangeTicks >= studyConfig.sweep_range_ticks && deltaRatio >= studyConfig.sweep_delta_ratio) {
    if (message.close >= message.open && message.candle_delta > 0) {
      message.sweep_buy = true;
      alerts.push("SWEEP UP");
    } else if (message.close <= message.open && message.candle_delta < 0) {
      message.sweep_sell = true;
      alerts.push("SWEEP DN");
    }
  }

  if ((message.total_volume || 0) > 0) {
    if (
      message.close > message.open
      && message.candle_delta < 0
      && Math.abs(message.candle_delta) / message.total_volume >= studyConfig.delta_divergence_ratio
    ) {
      message.delta_divergence_bear = true;
      alerts.push("DIV BEAR");
    }
    if (
      message.close < message.open
      && message.candle_delta > 0
      && Math.abs(message.candle_delta) / message.total_volume >= studyConfig.delta_divergence_ratio
    ) {
      message.delta_divergence_bull = true;
      alerts.push("DIV BULL");
    }
  }

  return alerts;
}

function applyStudySignals(message, summary, studyConfig = DEFAULT_STUDY_CONFIG) {
  if (!message) return message;
  message.unfinished_low = summary.unfinishedLow;
  message.unfinished_high = summary.unfinishedHigh;
  message.absorption_low = summary.absorptionLow;
  message.absorption_high = summary.absorptionHigh;
  message.exhaustion_low = summary.exhaustionLow;
  message.exhaustion_high = summary.exhaustionHigh;
  message.alerts = buildCandleAlerts(message, summary, studyConfig);
  return message;
}

function mergeDataSource(current, next) {
  if (!current) return next;
  if (!next) return current;
  if (current === next) return current;
  return "mixed";
}

export function aggregateBars(source, timeframe = "1m", tickMultiplier = 1, studyConfig = DEFAULT_STUDY_CONFIG) {
  const normalizedTimeframe = normalizeTimeframe(timeframe);
  if (!source?.length) return [];

  const firstBarWithRowSize = source.find((bar) => (Number(bar?.row_size) || 0) > 0);
  const sourceRowSize = Number(firstBarWithRowSize?.row_size) || BASE_ROW_SIZE;
  const targetRowSize = round6(sourceRowSize * parseTickMultiplier(tickMultiplier));

  const frames = [];
  const frameCounts = [];
  let current = null;

  for (const raw of source) {
    const candle = normalizeStoredBar(raw);
    if (!candle?.candle_open_time) continue;

    const openTime = frameOpenTime(candle.candle_open_time, normalizedTimeframe);
    if (!current || current.candle_open_time !== openTime) {
      current = {
        candle_open_time: openTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        row_size: targetRowSize,
        clusters: [],
        candle_delta: 0,
        cvd: candle.cvd,
        buy_trades: 0,
        sell_trades: 0,
        total_volume: 0,
        buy_volume: 0,
        sell_volume: 0,
        oi: candle.oi,
        oi_delta: 0,
        best_bid: candle.best_bid,
        best_bid_size: candle.best_bid_size,
        best_ask: candle.best_ask,
        best_ask_size: candle.best_ask_size,
        bids: copyBookLevels(candle.bids),
        asks: copyBookLevels(candle.asks),
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
        orderflow_coverage: 0,
        data_source: candle.data_source,
      };
      frames.push(current);
      frameCounts.push(0);
    }

    frameCounts[frameCounts.length - 1] += 1;
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.candle_delta = round6(current.candle_delta + candle.candle_delta);
    current.cvd = candle.cvd;
    current.buy_trades += candle.buy_trades;
    current.sell_trades += candle.sell_trades;
    current.total_volume = round6(current.total_volume + candle.total_volume);
    current.buy_volume = round6(current.buy_volume + candle.buy_volume);
    current.sell_volume = round6(current.sell_volume + candle.sell_volume);
    current.oi = candle.oi;
    current.oi_delta = round6(current.oi_delta + candle.oi_delta);
    current.best_bid = candle.best_bid;
    current.best_bid_size = candle.best_bid_size;
    current.best_ask = candle.best_ask;
    current.best_ask_size = candle.best_ask_size;
    current.bids = copyBookLevels(candle.bids);
    current.asks = copyBookLevels(candle.asks);
    current.clusters.push(...copyClusters(candle.clusters));
    current.orderflow_coverage = round6(current.orderflow_coverage + Math.max(0, Math.min(1, candle.orderflow_coverage)));
    current.data_source = mergeDataSource(current.data_source, candle.data_source);
  }

  return frames.map((frame, index) => {
    const { clusters, summary } = normalizeAggregatedClusters(frame.clusters, targetRowSize, studyConfig);
    const normalized = {
      ...frame,
      clusters,
      orderflow_coverage: frameCounts[index] > 0
        ? round6(frame.orderflow_coverage / frameCounts[index])
        : 0,
      data_source: frame.data_source || "mixed",
    };
    return applyStudySignals(normalized, summary, studyConfig);
  });
}
