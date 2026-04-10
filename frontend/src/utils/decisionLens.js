import { describeCandleDataQuality, summarizeCandleImbalance } from "./orderflow";

const TRADE_FRESH_MS = 6_000;
const DEPTH_FRESH_MS = 12_000;
const OI_FRESH_MS = 20_000;
const MIN_SIGNAL_CONFIDENCE = 75;

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function formatSignedPercent(value) {
  const numeric = Number(value) || 0;
  return `${numeric > 0 ? "+" : numeric < 0 ? "" : ""}${numeric.toFixed(0)}%`;
}

function rangeOf(candle) {
  return Math.abs((Number(candle?.high) || 0) - (Number(candle?.low) || 0));
}

function getCloseLocation(candle) {
  const range = rangeOf(candle);
  if (range <= 0) return 0.5;
  return ((Number(candle?.close) || 0) - (Number(candle?.low) || 0)) / range;
}

function computeTrendEfficiency(bars) {
  if (!Array.isArray(bars) || bars.length < 3) return 0;
  const closes = bars.map((bar) => Number(bar?.close) || 0).filter((value) => value > 0);
  if (closes.length < 3) return 0;

  let path = 0;
  for (let index = 1; index < closes.length; index += 1) {
    path += Math.abs(closes[index] - closes[index - 1]);
  }
  if (path <= 0) return 0;
  return Math.abs(closes.at(-1) - closes[0]) / path;
}

function computeAtr(bars, length) {
  const sample = (bars || []).slice(-length);
  return average(sample.map((bar) => rangeOf(bar)).filter((value) => value > 0));
}

function resolveMarketState(history) {
  const bars = (history || []).filter(Boolean);
  const trendBars = bars.slice(-10);
  const compressionBars = bars.slice(-20);
  const recentFive = bars.slice(-5);
  const trendEfficiency = computeTrendEfficiency(trendBars);
  const atr10 = computeAtr(bars, 10);
  const atr50 = computeAtr(bars, 50) || atr10 || 1;
  const compression = average(recentFive.map(rangeOf).filter((value) => value > 0))
    / Math.max(average(compressionBars.map(rangeOf).filter((value) => value > 0)), 0.000001);
  const volatilityRegime = atr10 > 0 ? atr10 / atr50 : 1;
  const referenceClose = Number(trendBars[0]?.close) || Number(bars.at(-1)?.open) || 0;
  const currentClose = Number(bars.at(-1)?.close) || referenceClose;
  const bias = currentClose - referenceClose;

  let state = "RANGE";
  if (trendEfficiency < 0.25 && compression < 0.85) {
    state = "COMPRESSION";
  } else if (trendEfficiency > 0.45) {
    state = bias >= 0 ? "TREND BULLISH" : "TREND BEARISH";
  }

  return {
    state,
    trendEfficiency,
    compression,
    atr10,
    atr50,
    volatilityRegime,
    biasedTrend: trendEfficiency > 0.45 ? (bias >= 0 ? "bullish" : "bearish") : "neutral",
    blocked: trendEfficiency < 0.25 && compression < 0.85,
  };
}

function computeDailyVwap(history, activeCandle) {
  if (!activeCandle?.candle_open_time) return 0;

  const activeDate = new Date(Number(activeCandle.candle_open_time));
  const sessionBars = (history || []).filter((bar) => {
    const date = new Date(Number(bar?.candle_open_time) || 0);
    return date.getUTCFullYear() === activeDate.getUTCFullYear()
      && date.getUTCMonth() === activeDate.getUTCMonth()
      && date.getUTCDate() === activeDate.getUTCDate();
  });

  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  for (const bar of sessionBars) {
    const volume = Number(bar?.total_volume) || 0;
    if (volume <= 0) continue;
    const typicalPrice = ((Number(bar?.high) || 0) + (Number(bar?.low) || 0) + (Number(bar?.close) || 0)) / 3;
    cumulativePriceVolume += typicalPrice * volume;
    cumulativeVolume += volume;
  }

  return cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : 0;
}

function countLevelTouches(level, bars, threshold) {
  if (!Number.isFinite(level)) return 0;
  return (bars || []).reduce((count, bar) => {
    const high = Number(bar?.high) || 0;
    const low = Number(bar?.low) || 0;
    return high >= level - threshold && low <= level + threshold ? count + 1 : count;
  }, 0);
}

function buildLocationCandidates(candle, context, threshold) {
  const history = Array.isArray(context?.history) ? context.history.filter(Boolean) : [];
  const previousBars = history.slice(0, -1);
  const recentBars = previousBars.slice(-40);
  const rowSize = Math.max(Number(candle?.row_size) || 0.1, 0.0001);
  const activeHigh = Number(candle?.high) || 0;
  const activeLow = Number(candle?.low) || 0;
  const activeClose = Number(candle?.close) || 0;
  const upperCandidates = [];
  const lowerCandidates = [];

  if (recentBars.length > 0) {
    const swingHigh = Math.max(...recentBars.map((bar) => Number(bar?.high) || 0));
    const swingLow = Math.min(...recentBars.map((bar) => Number(bar?.low) || Number.MAX_VALUE));
    if (swingHigh > 0) upperCandidates.push({ kind: "swing high", price: swingHigh });
    if (swingLow > 0 && swingLow < Number.MAX_VALUE) lowerCandidates.push({ kind: "swing low", price: swingLow });
  }

  const vwap = computeDailyVwap(history, candle);
  if (vwap > 0) {
    if (vwap >= activeClose) {
      upperCandidates.push({ kind: "VWAP", price: vwap });
    }
    if (vwap <= activeClose) {
      lowerCandidates.push({ kind: "VWAP", price: vwap });
    }
  }

  for (const bar of recentBars.slice(-20)) {
    if (bar?.absorption_high || bar?.unfinished_high || bar?.exhaustion_high) {
      upperCandidates.push({ kind: "failed auction high", price: Number(bar?.high) || 0 });
    }
    if (bar?.absorption_low || bar?.unfinished_low || bar?.exhaustion_low) {
      lowerCandidates.push({ kind: "failed auction low", price: Number(bar?.low) || 0 });
    }
  }

  const askLevels = (candle?.asks || []).filter((level) => {
    const price = Number(level?.price) || 0;
    return price >= activeClose && price <= activeClose + threshold * 2;
  });
  const bidLevels = (candle?.bids || []).filter((level) => {
    const price = Number(level?.price) || 0;
    return price <= activeClose && price >= activeClose - threshold * 2;
  });
  const largestAsk = askLevels.sort((a, b) => (Number(b?.size) || 0) - (Number(a?.size) || 0))[0];
  const largestBid = bidLevels.sort((a, b) => (Number(b?.size) || 0) - (Number(a?.size) || 0))[0];
  if (largestAsk) upperCandidates.push({ kind: "ask shelf", price: Number(largestAsk.price) || 0 });
  if (largestBid) lowerCandidates.push({ kind: "bid shelf", price: Number(largestBid.price) || 0 });

  const chooseNearest = (candidates, referencePrice) => {
    const valid = candidates
      .filter((candidate) => Number.isFinite(candidate.price) && candidate.price > 0)
      .map((candidate) => {
        const distance = Math.abs(candidate.price - referencePrice);
        const touches = countLevelTouches(candidate.price, recentBars.slice(-30), Math.max(threshold * 0.8, rowSize * 2));
        return {
          ...candidate,
          distance,
          touches,
        };
      })
      .filter((candidate) => candidate.distance <= threshold)
      .sort((left, right) => left.distance - right.distance || left.touches - right.touches);

    return valid[0] || null;
  };

  return {
    upper: chooseNearest(upperCandidates, activeHigh || activeClose),
    lower: chooseNearest(lowerCandidates, activeLow || activeClose),
  };
}

function resolveSignalState(candle, marketState, location) {
  if (location?.upper) return `${marketState.state} | UPPER LOCATION`;
  if (location?.lower) return `${marketState.state} | LOWER LOCATION`;
  return `${marketState.state} | MIDRANGE`;
}

function computeFreshFeed(status, captureStats, candle, requireLiveFeed) {
  const now = Date.now();
  const source = String(candle?.data_source || "");
  if (!requireLiveFeed || source === "replay_trade_footprint") {
    return { ok: true, reason: "" };
  }

  if (status !== "connected") {
    return { ok: false, reason: "Feed disconnected" };
  }

  const tradeAge = now - (Number(captureStats?.lastTradeTimestamp) || 0);
  const depthAge = now - (Number(captureStats?.lastDepthTimestamp) || 0);
  const oiAge = now - (Number(captureStats?.lastTickerTimestamp) || 0);
  if (!Number(captureStats?.lastTradeTimestamp) || tradeAge > TRADE_FRESH_MS) {
    return { ok: false, reason: "Tape stale" };
  }
  if (!Number(captureStats?.lastDepthTimestamp) || depthAge > DEPTH_FRESH_MS) {
    return { ok: false, reason: "Book stale" };
  }
  if (!Number(captureStats?.lastTickerTimestamp) || oiAge > OI_FRESH_MS) {
    return { ok: false, reason: "OI stale" };
  }
  return { ok: true, reason: "" };
}

function computeLocationThreshold(candle, marketState) {
  const rowSize = Math.max(Number(candle?.row_size) || 0.1, 0.0001);
  const atr10 = marketState.atr10 || rowSize * 8;
  let threshold = Math.max(rowSize * 4, atr10 * 0.18);
  if (marketState.volatilityRegime > 1.2) threshold *= 1.3;
  if (marketState.volatilityRegime < 0.8) threshold *= 0.7;
  return Math.max(threshold, rowSize * 3);
}

function buildNoTrade({
  state,
  reason,
  location,
  marketState,
  confidence = 0,
}) {
  return {
    status: "NO TRADE",
    tone: "muted",
    headline: "NO TRADE",
    direction: "",
    confidence,
    state,
    reason,
    rows: [
      { label: "State", value: state },
      { label: "Gate", value: reason },
      {
        label: "Location",
        value: location
          ? `${location.kind} | distance ${location.distance.toFixed(1)} | touches ${location.touches}`
          : "No valid location",
      },
      {
        label: "Context",
        value: `Trend ${marketState.trendEfficiency.toFixed(2)} | Compression ${marketState.compression.toFixed(2)}`,
      },
    ],
  };
}

export function buildDecisionLens(candle, context, captureStats, status) {
  if (!candle) {
    return {
      status: "NO TRADE",
      tone: "muted",
      headline: "NO TRADE",
      direction: "",
      confidence: 0,
      state: "NO DATA",
      reason: "No candle selected",
      rows: [],
    };
  }

  const quality = describeCandleDataQuality(candle);
  const source = String(candle?.data_source || "");
  const tradeableSource = source === "live_trade_footprint" || source === "replay_trade_footprint";
  const marketState = resolveMarketState(context?.history || []);
  const threshold = computeLocationThreshold(candle, marketState);
  const location = buildLocationCandidates(candle, context, threshold);
  const state = resolveSignalState(candle, marketState, location.upper || location.lower);

  if (!tradeableSource || Number(candle?.orderflow_coverage ?? 0) < 0.999) {
    return buildNoTrade({
      state,
      reason: `${quality.label} bars are blocked`,
      location: location.upper || location.lower,
      marketState,
    });
  }

  const requiresLiveFeed = !context?.nextCandle && source === "live_trade_footprint";
  const feed = computeFreshFeed(status, captureStats, candle, requiresLiveFeed);
  if (!feed.ok) {
    return buildNoTrade({
      state,
      reason: feed.reason,
      location: location.upper || location.lower,
      marketState,
    });
  }

  if (marketState.blocked) {
    return buildNoTrade({
      state,
      reason: "Compression / chop filter active",
      location: location.upper || location.lower,
      marketState,
    });
  }

  const history = (context?.history || []).filter(Boolean);
  const recentBars = history.slice(-21, -1);
  const previousCandle = context?.previousCandle || null;
  const nextCandle = context?.nextCandle || null;
  const rowSize = Math.max(Number(candle?.row_size) || 0.1, 0.0001);
  const range = Math.max(rangeOf(candle), rowSize);
  const closeLocation = getCloseLocation(candle);
  const upperWick = (Number(candle?.high) || 0) - Math.max(Number(candle?.open) || 0, Number(candle?.close) || 0);
  const lowerWick = Math.min(Number(candle?.open) || 0, Number(candle?.close) || 0) - (Number(candle?.low) || 0);
  const imbalance = summarizeCandleImbalance(candle);
  const delta = Number(candle?.candle_delta) || 0;
  const averageAbsDelta = average(recentBars.map((bar) => Math.abs(Number(bar?.candle_delta) || 0)).filter((value) => value > 0)) || 1;
  const deltaStrength = Math.abs(delta) / Math.max(averageAbsDelta, 1);
  const deltaThreshold = Math.max(averageAbsDelta * 1.5, (Number(candle?.total_volume) || 0) * 0.1, 1);
  const currentOI = Number(candle?.oi) || 0;
  const previousOI = Number(previousCandle?.oi) || 0;
  const oiDelta = currentOI > 0 && previousOI > 0 ? currentOI - previousOI : Number(candle?.oi_delta) || 0;

  const shortLocation = location.upper;
  const longLocation = location.lower;
  const shortRejection = closeLocation < 0.42 && upperWick >= range * 0.25;
  const longRejection = closeLocation > 0.58 && lowerWick >= range * 0.25;
  const shortImmediateFailure = nextCandle
    ? (Number(nextCandle?.high) || 0) <= (Number(candle?.high) || 0) + rowSize * 0.5
    : shortRejection;
  const longImmediateFailure = nextCandle
    ? (Number(nextCandle?.low) || 0) >= (Number(candle?.low) || 0) - rowSize * 0.5
    : longRejection;

  const shortTrapCandidate = Boolean(
    shortLocation
    && shortLocation.touches <= 2
    && delta >= deltaThreshold
    && deltaStrength >= 1.6
    && imbalance?.side === "buy"
    && shortRejection
    && shortImmediateFailure,
  );

  const longTrapCandidate = Boolean(
    longLocation
    && longLocation.touches <= 2
    && delta <= -deltaThreshold
    && deltaStrength >= 1.6
    && imbalance?.side === "sell"
    && longRejection
    && longImmediateFailure,
  );

  if (!shortTrapCandidate && !longTrapCandidate) {
    const gateReason = !shortLocation && !longLocation
      ? "No valid location nearby"
      : "No confirmed trap failure";
    return buildNoTrade({
      state,
      reason: gateReason,
      location: shortLocation || longLocation,
      marketState,
    });
  }

  const direction = shortTrapCandidate ? "SHORT" : "LONG";
  const chosenLocation = shortTrapCandidate ? shortLocation : longLocation;
  const rejectionScore = clamp((shortTrapCandidate ? upperWick : lowerWick) / Math.max(range * 0.35, rowSize), 0, 1);
  const locationScore = clamp(1 - (chosenLocation.distance / Math.max(threshold, rowSize)), 0, 1);
  const deltaScore = clamp((deltaStrength - 1.2) / 1.4, 0, 1);
  const imbalanceScore = imbalance?.stacked ? 1 : 0.75;
  const oiScore = clamp(oiDelta > 0 ? 1 : oiDelta < 0 ? 0.35 : 0.55, 0, 1);

  const confidence = Math.round(
    locationScore * 40
    + deltaScore * 20
    + imbalanceScore * 15
    + rejectionScore * 15
    + oiScore * 10,
  );

  if (confidence < MIN_SIGNAL_CONFIDENCE) {
    return buildNoTrade({
      state,
      reason: "Trap quality below threshold",
      location: chosenLocation,
      marketState,
      confidence,
    });
  }

  const reason = shortTrapCandidate
    ? `Buy aggression failed at ${chosenLocation.kind} with ${deltaStrength.toFixed(1)}x delta`
    : `Sell aggression failed at ${chosenLocation.kind} with ${deltaStrength.toFixed(1)}x delta`;

  return {
    status: "TRAP",
    tone: shortTrapCandidate ? "bearish" : "bullish",
    headline: `TRAP ${direction}`,
    direction,
    confidence,
    state,
    reason,
    rows: [
      { label: "State", value: state },
      { label: "Signal", value: `${direction} trap allowed` },
      { label: "Location", value: `${chosenLocation.kind} | distance ${chosenLocation.distance.toFixed(1)} | touches ${chosenLocation.touches}` },
      { label: "Reason", value: reason },
      { label: "Context", value: `Trend ${marketState.trendEfficiency.toFixed(2)} | Compression ${marketState.compression.toFixed(2)} | OI ${formatSignedPercent(oiScore * 100 - 50)}` },
    ],
  };
}
