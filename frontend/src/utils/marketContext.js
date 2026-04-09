import { aggregateBars, timeframeDurationMs } from "../market/aggregate";

const PRIME_TIMEFRAMES = ["5m", "15m", "1h", "4h", "D"];

const SCORING_PRESETS = {
  aggressive: {
    name: "Aggressive",
    weights: {
      reliable: 1,
      location: 1,
      trigger: 2,
      confirmation: 1,
      flow: 1,
      liquidity: 1,
      volume: 1,
      session: 1,
      confluence: 1,
      profile: 1,
    },
    thresholds: { A: 8, B: 6, C: 4 },
    qualityFloor: { poor: 3, balanced: 0, strong: 0, elite: 0, chaotic: 4, history: 99 },
  },
  strict: {
    name: "Strict",
    weights: {
      reliable: 2,
      location: 2,
      trigger: 2,
      confirmation: 2,
      flow: 1,
      liquidity: 1,
      volume: 1,
      session: 2,
      confluence: 2,
      profile: 1,
    },
    thresholds: { A: 11, B: 8, C: 6 },
    qualityFloor: { poor: 99, balanced: 0, strong: 0, elite: 0, chaotic: 10, history: 99 },
  },
  balanced: {
    name: "Balanced",
    weights: {
      reliable: 2,
      location: 2,
      trigger: 2,
      confirmation: 2,
      flow: 1,
      liquidity: 1,
      volume: 1,
      session: 1,
      confluence: 1,
      profile: 1,
    },
    thresholds: { A: 10, B: 7, C: 5 },
    qualityFloor: { poor: 5, balanced: 0, strong: 0, elite: 0, chaotic: 7, history: 99 },
  },
};

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rowSizeFor(candle, settings) {
  return Math.max(Number(candle?.row_size) || Number(settings?.baseRowSize) || 0.1, 0.000001);
}

function formatPrice(price, rowSize = 0.1) {
  const numeric = Number(price);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  const step = Math.max(Number(rowSize) || 0.1, 0.000001);
  const decimals = step >= 1 ? 0 : Math.min(6, Math.max(1, Math.ceil(Math.log10(1 / step))));
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function bucketVolume(profile, price, volume) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(volume) || volume <= 0) return;
  profile.set(price, (profile.get(price) || 0) + volume);
}

export function buildProfileLevels(candles, rowSize, valueAreaPercent = 70) {
  const profile = new Map();

  for (const candle of candles || []) {
    const clusters = Array.isArray(candle?.clusters) ? candle.clusters : [];
    if (clusters.length > 0) {
      for (const cluster of clusters) {
        bucketVolume(profile, Number(cluster?.price) || 0, Number(cluster?.totalVol) || 0);
      }
      continue;
    }

    const fallbackPrice = Math.floor((Number(candle?.close) || 0) / rowSize) * rowSize;
    bucketVolume(profile, fallbackPrice, Number(candle?.total_volume) || 0);
  }

  if (profile.size === 0) {
    return null;
  }

  const prices = [...profile.keys()].sort((a, b) => a - b);
  let pocPrice = prices[0];
  let pocVolume = 0;
  let totalVolume = 0;
  for (const price of prices) {
    const volume = profile.get(price) || 0;
    totalVolume += volume;
    if (volume > pocVolume) {
      pocPrice = price;
      pocVolume = volume;
    }
  }

  const targetVolume = totalVolume * ((Number(valueAreaPercent) || 70) / 100);
  let lowIndex = prices.indexOf(pocPrice);
  let highIndex = lowIndex;
  let covered = pocVolume;
  while (covered < targetVolume && (lowIndex > 0 || highIndex < prices.length - 1)) {
    const nextLowVolume = lowIndex > 0 ? (profile.get(prices[lowIndex - 1]) || 0) : -1;
    const nextHighVolume = highIndex < prices.length - 1 ? (profile.get(prices[highIndex + 1]) || 0) : -1;
    if (nextHighVolume >= nextLowVolume) {
      highIndex += 1;
      covered += Math.max(0, nextHighVolume);
    } else {
      lowIndex -= 1;
      covered += Math.max(0, nextLowVolume);
    }
  }

  return {
    poc: pocPrice,
    vah: prices[highIndex],
    val: prices[lowIndex],
    totalVolume,
    rowSize,
  };
}

function sessionWindow(timestamp, mode) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (mode === "asia") {
    const start = Date.UTC(year, month, day, 0, 0, 0, 0);
    return { start, end: start + 8 * 60 * 60_000, label: "Asia" };
  }

  if (mode === "london") {
    const start = Date.UTC(year, month, day, 7, 0, 0, 0);
    return { start, end: start + 8 * 60 * 60_000, label: "London" };
  }

  if (mode === "newyork") {
    const start = Date.UTC(year, month, day, 13, 0, 0, 0);
    return { start, end: start + 8 * 60 * 60_000, label: "New York" };
  }

  const start = Date.UTC(year, month, day, 0, 0, 0, 0);
  return { start, end: start + 24 * 60 * 60_000, label: "UTC day" };
}

function resolveSessionWindow(timestamp, mode) {
  let window = sessionWindow(timestamp, mode);
  if (timestamp >= window.end) {
    window = sessionWindow(window.end + 1, mode);
  }
  if (timestamp < window.start) {
    window = sessionWindow(window.start - 1, mode);
  }
  return window;
}

function buildSessionStats(candles, currentIndex, settings) {
  const candle = candles[currentIndex];
  if (!candle) return null;
  const availableBars = candles.slice(0, currentIndex + 1);

  const currentWindow = resolveSessionWindow(candle.candle_open_time, settings?.sessionMode || "utcDay");
  const priorWindow = resolveSessionWindow(currentWindow.start - 1, settings?.sessionMode || "utcDay");
  const currentBars = availableBars.filter((item) => item.candle_open_time >= currentWindow.start && item.candle_open_time < currentWindow.end);
  const priorBars = availableBars.filter((item) => item.candle_open_time >= priorWindow.start && item.candle_open_time < priorWindow.end);
  const rowSize = rowSizeFor(candle, settings);

  if (!currentBars.length) return null;

  const sessionHigh = Math.max(...currentBars.map((item) => Number(item?.high) || 0));
  const sessionLow = Math.min(...currentBars.map((item) => Number(item?.low) || 0));
  const openingRangeBars = currentBars.slice(0, Math.min(5, currentBars.length));
  const openingRangeHigh = Math.max(...openingRangeBars.map((item) => Number(item?.high) || 0));
  const openingRangeLow = Math.min(...openingRangeBars.map((item) => Number(item?.low) || 0));
  const sessionProfile = buildProfileLevels(currentBars, rowSize, settings?.vaPercent);
  const priorProfile = priorBars.length ? buildProfileLevels(priorBars, rowSize, settings?.vaPercent) : null;

  return {
    mode: settings?.sessionMode || "utcDay",
    label: currentWindow.label,
    currentWindow,
    currentBars,
    priorBars,
    sessionHigh,
    sessionLow,
    priorHigh: priorBars.length ? Math.max(...priorBars.map((item) => Number(item?.high) || 0)) : null,
    priorLow: priorBars.length ? Math.min(...priorBars.map((item) => Number(item?.low) || 0)) : null,
    openingRangeHigh,
    openingRangeLow,
    rowSize,
    sessionProfile,
    priorProfile,
  };
}

function classifySessionQuality(candles, currentIndex, sessionStats) {
  if (!sessionStats?.currentBars?.length) {
    return {
      label: "History only",
      bucket: "history",
      row: "History-only context",
      detail: "Session-quality filters need live or replay orderflow bars.",
      score: 0,
    };
  }

  const baselineWindow = candles.slice(Math.max(0, currentIndex - 90), currentIndex + 1);
  const baselineVolumes = baselineWindow.map((item) => Number(item?.total_volume) || 0).filter((value) => value > 0);
  const baselineRanges = baselineWindow
    .map((item) => Math.abs((Number(item?.high) || 0) - (Number(item?.low) || 0)))
    .filter((value) => value > 0);
  const sessionVolumes = sessionStats.currentBars.map((item) => Number(item?.total_volume) || 0).filter((value) => value > 0);
  const sessionRanges = sessionStats.currentBars
    .map((item) => Math.abs((Number(item?.high) || 0) - (Number(item?.low) || 0)))
    .filter((value) => value > 0);
  const reliableRatio = average(sessionStats.currentBars.map((item) => Number(item?.orderflow_coverage) || 0));
  const volumeRatio = average(sessionVolumes) / Math.max(average(baselineVolumes), 1);
  const rangeRatio = average(sessionRanges) / Math.max(average(baselineRanges), 0.000001);
  const lastBar = sessionStats.currentBars.at(-1);
  const lastRange = Math.abs((Number(lastBar?.high) || 0) - (Number(lastBar?.low) || 0));
  const lastVolume = Number(lastBar?.total_volume) || 0;
  const baselineRange = average(baselineRanges);
  const baselineVolume = average(baselineVolumes);
  const chaotic = lastRange >= baselineRange * 2.8 && lastVolume >= baselineVolume * 2.2;

  if (reliableRatio < 0.45) {
    return {
      label: "History only",
      bucket: "history",
      row: "Session quality needs live footprint capture",
      detail: "This session is mostly history-only bars, so orderflow quality filters are muted.",
      score: 0,
    };
  }

  if (chaotic) {
    return {
      label: "Chaotic",
      bucket: "chaotic",
      row: "Fast, volatile tape",
      detail: "This session is moving fast enough to distort clean footprint reads. Great for momentum, worse for patient trap confirmation.",
      score: 1,
    };
  }

  if (volumeRatio >= 1.35 && rangeRatio >= 1.2) {
    return {
      label: "Elite",
      bucket: "elite",
      row: "High participation and clean expansion",
      detail: "This session has strong volume and range expansion, which makes initiative and trap reads more trustworthy.",
      score: 3,
    };
  }

  if (volumeRatio >= 1.05 && rangeRatio >= 0.95) {
    return {
      label: "Strong",
      bucket: "strong",
      row: "Healthy participation",
      detail: "Participation is healthy enough that footprint and OI reads should carry better than average.",
      score: 2,
    };
  }

  if (volumeRatio < 0.75 && rangeRatio < 0.8) {
    return {
      label: "Poor",
      bucket: "poor",
      row: "Thin participation",
      detail: "This session is quiet enough that traps and imbalances need extra confirmation before they deserve trust.",
      score: -1,
    };
  }

  return {
    label: "Balanced",
    bucket: "balanced",
    row: "Normal participation",
    detail: "The tape is active enough to read, but not especially rich or especially dead.",
    score: 1,
  };
}

function classifyBarBias(bar) {
  if (!bar) return { bias: 0, label: "flat" };
  const open = Number(bar?.open) || 0;
  const close = Number(bar?.close) || 0;
  const high = Number(bar?.high) || close;
  const low = Number(bar?.low) || close;
  const range = Math.max(high - low, 0.000001);
  const move = close - open;
  if (move >= range * 0.2) return { bias: 1, label: "up" };
  if (move <= -range * 0.2) return { bias: -1, label: "down" };
  return { bias: 0, label: "flat" };
}

function buildConfluence(candles, currentIndex, currentTimeframe) {
  const uptoCurrent = candles.slice(0, currentIndex + 1);
  const currentDuration = timeframeDurationMs(currentTimeframe || "1m", uptoCurrent.at(-1)?.candle_open_time || Date.now());
  const frames = PRIME_TIMEFRAMES
    .filter((timeframe) => timeframeDurationMs(timeframe, uptoCurrent.at(-1)?.candle_open_time || Date.now()) > currentDuration)
    .slice(0, 3)
    .map((timeframe) => {
      const aggregated = aggregateBars(uptoCurrent, timeframe, 1);
      const bar = aggregated.at(-1);
      const classified = classifyBarBias(bar);
      return {
        timeframe,
        ...classified,
        bar,
      };
    });

  const directionBias = frames.reduce((sum, frame) => sum + frame.bias, 0);
  const alignedCount = frames.filter((frame) => frame.bias !== 0).length;
  const label = frames.length
    ? frames.map((frame) => `${frame.timeframe} ${frame.label}`).join(", ")
    : "No HTF confluence";

  return {
    frames,
    directionBias,
    alignedCount,
    label,
    row: frames.length ? label : "No HTF confluence",
    detail: frames.length
      ? `Higher-timeframe tone: ${label}.`
      : "No higher-timeframe confluence is available yet.",
  };
}

function buildNearbyLevels(candle, sessionStats, selectedProfile) {
  const levels = [];
  const close = Number(candle?.close) || 0;
  const rowSize = sessionStats?.rowSize || rowSizeFor(candle, {});
  const pushLevel = (label, price) => {
    const numeric = Number(price);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const distanceTicks = Math.abs(numeric - close) / rowSize;
    if (distanceTicks > 18) return;
    levels.push({
      label,
      price: numeric,
      text: `${label} ${formatPrice(numeric, rowSize)}`,
      distanceTicks,
    });
  };

  pushLevel("Session high", sessionStats?.sessionHigh);
  pushLevel("Session low", sessionStats?.sessionLow);
  pushLevel("Prior high", sessionStats?.priorHigh);
  pushLevel("Prior low", sessionStats?.priorLow);
  pushLevel("OR high", sessionStats?.openingRangeHigh);
  pushLevel("OR low", sessionStats?.openingRangeLow);
  pushLevel("POC", selectedProfile?.poc);
  pushLevel("VAH", selectedProfile?.vah);
  pushLevel("VAL", selectedProfile?.val);

  return levels.sort((a, b) => a.distanceTicks - b.distanceTicks).slice(0, 4);
}

export function getScoringConfig(settings) {
  const preset = SCORING_PRESETS[settings?.scoringPreset] || SCORING_PRESETS.balanced;
  const maxScore = Object.values(preset.weights).reduce((sum, value) => sum + value, 0);
  return {
    ...preset,
    maxScore,
    calloutMinimumScore: minimumScoreForGrade(settings?.calloutGrade || "B", preset.thresholds),
  };
}

export function minimumScoreForGrade(grade, thresholds) {
  if (grade === "A") return thresholds.A;
  if (grade === "B") return thresholds.B;
  if (grade === "C") return thresholds.C;
  return 0;
}

export function buildCandleContext(candles, index, settings) {
  const safeIndex = Math.max(0, Math.min(index, candles.length - 1));
  const availableCandles = candles.slice(0, safeIndex + 1);
  const candle = candles[safeIndex];
  const previousCandle = safeIndex > 0 ? candles[safeIndex - 1] : null;
  const nextCandle = safeIndex + 1 < candles.length ? candles[safeIndex + 1] : null;
  const recentCandles = candles.slice(Math.max(0, safeIndex - 16), safeIndex);
  const futureCandles = candles.slice(safeIndex + 1, safeIndex + 3);
  const sessionStats = buildSessionStats(candles, safeIndex, settings);
  const rowSize = rowSizeFor(candle, settings);
  const selectedProfileSource = settings?.profileStudy === "composite"
    ? availableCandles
    : settings?.profileStudy === "session"
      ? sessionStats?.currentBars || recentCandles
      : availableCandles.slice(Math.max(0, availableCandles.length - 81));
  const selectedProfile = buildProfileLevels(selectedProfileSource, rowSize, settings?.vaPercent);
  const compositeProfile = buildProfileLevels(availableCandles, rowSize, settings?.vaPercent);
  const sessionQuality = classifySessionQuality(candles, safeIndex, sessionStats);
  const confluence = buildConfluence(candles, safeIndex, settings?.timeframe || "1m");
  const scoreConfig = getScoringConfig(settings);
  const nearbyLevels = buildNearbyLevels(candle, sessionStats, selectedProfile);

  return {
    previousCandle,
    nextCandle,
    recentCandles,
    futureCandles,
    market: {
      session: sessionStats ? {
        ...sessionStats,
        quality: sessionQuality,
      } : null,
      profile: {
        selected: selectedProfile,
        composite: compositeProfile,
      },
      confluence,
      scoreConfig,
      sessionFilter: settings?.sessionFilter || "balanced",
      nearbyLevels,
    },
  };
}

export function buildMarketContext(candles, activeCandle, settings) {
  if (!activeCandle?.candle_open_time || !candles?.length) {
    return {
      previousCandle: null,
      nextCandle: null,
      recentCandles: [],
      futureCandles: [],
      market: {
        session: null,
        profile: { selected: null, composite: null },
        confluence: { frames: [], directionBias: 0, alignedCount: 0, row: "No HTF confluence" },
        scoreConfig: getScoringConfig(settings),
        sessionFilter: settings?.sessionFilter || "balanced",
        nearbyLevels: [],
      },
    };
  }

  let index = candles.findIndex((candle) => candle?.candle_open_time === activeCandle.candle_open_time);
  if (index < 0) {
    index = candles.length - 1;
  }
  return buildCandleContext(candles, index, settings);
}
