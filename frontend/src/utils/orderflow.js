export function summarizeCandleImbalance(candle) {
  if (!candle?.clusters?.length) return null

  let strongest = null
  let count = 0
  let stacked = false

  for (const cluster of candle.clusters) {
    if (cluster.imbalance_buy) {
      count += 1
      stacked = stacked || Boolean(cluster.stacked_buy)
      const value = Number(cluster.buyVol) || 0
      if (!strongest || value > strongest.value) {
        strongest = { value, side: "buy" }
      }
    }

    if (cluster.imbalance_sell) {
      count += 1
      stacked = stacked || Boolean(cluster.stacked_sell)
      const value = Number(cluster.sellVol) || 0
      if (!strongest || value > strongest.value) {
        strongest = { value, side: "sell" }
      }
    }
  }

  return strongest ? { ...strongest, count, stacked } : null
}

export function candleHasImbalance(candle) {
  return Boolean(summarizeCandleImbalance(candle))
}

export function summarizeStudySignals(candle) {
  if (!candle) return []
  const tags = []
  if (candle.absorption_low || candle.absorption_high) tags.push("ABS")
  if (candle.exhaustion_low || candle.exhaustion_high) tags.push("EXH")
  if (candle.sweep_buy) tags.push("SWEEP UP")
  if (candle.sweep_sell) tags.push("SWEEP DN")
  if (candle.delta_divergence_bull) tags.push("DIV BULL")
  if (candle.delta_divergence_bear) tags.push("DIV BEAR")
  if (Array.isArray(candle.alerts)) {
    for (const tag of candle.alerts) {
      if (tag && !tags.includes(tag)) tags.push(tag)
    }
  }
  return tags
}

function pushUnique(items, value) {
  if (value && !items.includes(value)) {
    items.push(value)
  }
}

function appendSentence(base, extra) {
  if (!extra) return base
  if (!base) return extra
  return `${base}${base.endsWith(".") ? "" : "."} ${extra}`
}

function clampBias(value, threshold) {
  if (!Number.isFinite(value)) return 0
  if (value > threshold) return 1
  if (value < -threshold) return -1
  return 0
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function isReliableOrderflow(candle) {
  return Number(candle?.orderflow_coverage ?? 0) >= 0.999
}

function sumBookSize(levels) {
  return (levels || []).reduce((total, level) => total + (Number(level?.size) || 0), 0)
}

function findLargestLevel(levels) {
  let largest = null
  for (const level of levels || []) {
    const size = Number(level?.size) || 0
    const price = Number(level?.price) || 0
    if (!size || !price) continue
    if (!largest || size > largest.size) {
      largest = { price, size }
    }
  }
  return largest
}

function formatLevelPrice(price, rowSize) {
  const numeric = Number(price)
  if (!Number.isFinite(numeric) || numeric <= 0) return "-"
  const step = Math.max(Number(rowSize) || 0.1, 0.0001)
  const decimals = step >= 1 ? 0 : Math.min(4, Math.max(1, Math.ceil(Math.log10(1 / step))))
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

function normalizeReadingContext(context) {
  if (!context) {
    return {
      previousCandle: null,
      nextCandle: null,
      recentCandles: [],
      futureCandles: [],
      market: null,
    }
  }

  if ("candle_open_time" in context && "close" in context) {
    return {
      previousCandle: context,
      nextCandle: null,
      recentCandles: [],
      futureCandles: [],
      market: null,
    }
  }

  const futureCandles = Array.isArray(context.futureCandles)
    ? context.futureCandles.filter(Boolean)
    : [context.nextCandle].filter(Boolean)

  return {
    previousCandle: context.previousCandle || null,
    nextCandle: context.nextCandle || futureCandles[0] || null,
    recentCandles: Array.isArray(context.recentCandles) ? context.recentCandles.filter(Boolean) : [],
    futureCandles,
    market: context.market || null,
  }
}

function summarizeParticipation(candle, previousCandle, reliable) {
  const referenceClose = Number(previousCandle?.close)
  const referencePrice = Number.isFinite(referenceClose) && referenceClose > 0
    ? referenceClose
    : Number(candle?.open) || 0
  const currentClose = Number(candle?.close) || 0
  const rowSize = Math.max(Number(candle?.row_size) || 0.1, 0.1)
  const barRange = Math.max(
    Math.abs((Number(candle?.high) || currentClose) - (Number(candle?.low) || currentClose)),
    rowSize,
  )
  const priceDelta = currentClose - referencePrice
  const priceBias = clampBias(priceDelta, Math.max(barRange * 0.15, rowSize * 2))

  const canUseCvd = reliable && isReliableOrderflow(previousCandle)
  const flowDelta = canUseCvd
    ? (Number(candle?.cvd) || 0) - (Number(previousCandle?.cvd) || 0)
    : Number(candle?.candle_delta) || 0
  const flowBias = clampBias(flowDelta, Math.max((Number(candle?.total_volume) || 0) * 0.08, 1))
  const flowLabel = canUseCvd ? "CVD" : "Delta"

  const currentOI = Number(candle?.oi) || 0
  const previousOI = Number(previousCandle?.oi) || 0
  const oiDelta = currentOI > 0 && previousOI > 0
    ? currentOI - previousOI
    : Number(candle?.oi_delta) || 0
  const oiReference = previousOI > 0 ? previousOI : currentOI
  const oiBias = oiReference > 0
    ? clampBias(oiDelta, Math.max(oiReference * 0.00025, 1))
    : 0

  const flowState = flowBias > 0 ? `${flowLabel} up` : flowBias < 0 ? `${flowLabel} down` : `${flowLabel} flat`
  const oiState = oiBias > 0 ? "OI up" : oiBias < 0 ? "OI down" : "OI flat"
  const row = `${flowState}, ${oiState}`

  if (priceBias > 0 && flowBias > 0 && oiBias > 0) {
    return {
      kind: "fresh_longs",
      directionBias: 3,
      score: 3,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Fresh longs drove the move",
      detail: `Price rose with ${flowLabel.toLowerCase()} and open interest rising, which usually points to new long positioning instead of simple short covering.`,
      shortDetail: "Flow and OI rose together, which looks more like fresh long participation.",
      chips: [`${flowLabel} up`, "OI up", "New longs"],
    }
  }

  if (priceBias > 0 && flowBias > 0 && oiBias < 0) {
    return {
      kind: "short_covering",
      directionBias: 2,
      score: 2,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Short covering is lifting price",
      detail: `Price rose with supportive ${flowLabel.toLowerCase()}, but open interest fell. That usually means shorts are closing rather than new longs building aggressively.`,
      shortDetail: "Price is rising on covering, which can fade faster than fresh long initiation.",
      chips: [`${flowLabel} up`, "OI down", "Short covering"],
    }
  }

  if (priceBias < 0 && flowBias < 0 && oiBias > 0) {
    return {
      kind: "fresh_shorts",
      directionBias: -3,
      score: -3,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Fresh shorts pressed the move",
      detail: `Price fell with ${flowLabel.toLowerCase()} and open interest rising, which usually points to new short positioning adding pressure.`,
      shortDetail: "Flow and OI both point to fresh short participation.",
      chips: [`${flowLabel} down`, "OI up", "New shorts"],
    }
  }

  if (priceBias < 0 && flowBias < 0 && oiBias < 0) {
    return {
      kind: "long_liquidation",
      directionBias: -2,
      score: -2,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Long liquidation is driving the drop",
      detail: `Price fell with negative ${flowLabel.toLowerCase()}, but open interest also dropped. That usually looks more like longs bailing out than aggressive new shorts building.`,
      shortDetail: "The drop looks liquidation-led rather than fresh short initiative.",
      chips: [`${flowLabel} down`, "OI down", "Long liquidation"],
    }
  }

  if (priceBias > 0 && flowBias < 0) {
    return {
      kind: "bearish_divergence",
      directionBias: -2,
      score: -2,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Price rose on weak underlying flow",
      detail: `Price pushed higher while ${flowLabel.toLowerCase()} faded. That often means passive sellers are absorbing the move or late buyers are chasing into a weaker auction.`,
      shortDetail: "Price is higher, but the underlying flow is not confirming it.",
      chips: [`${flowLabel} down`, "Flow divergence"],
    }
  }

  if (priceBias < 0 && flowBias > 0) {
    return {
      kind: "bullish_divergence",
      directionBias: 2,
      score: 2,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Selling pushed price lower, but flow held up",
      detail: `Price dropped while ${flowLabel.toLowerCase()} improved. That often shows seller exhaustion or buyers absorbing the move underneath.`,
      shortDetail: "Price is lower, but the underlying flow is holding up better than price.",
      chips: [`${flowLabel} up`, "Flow divergence"],
    }
  }

  if (flowBias > 0 && oiBias > 0) {
    return {
      kind: "buy_build",
      directionBias: 1,
      score: 1,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Buyers are active, but price has not expanded yet",
      detail: `${flowLabel} and open interest both improved, so there is still constructive participation under this bar even though price has not cleanly expanded yet.`,
      shortDetail: "Buy-side flow is active under the surface.",
      chips: [`${flowLabel} up`, "OI up"],
    }
  }

  if (flowBias < 0 && oiBias > 0) {
    return {
      kind: "sell_build",
      directionBias: -1,
      score: -1,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Sellers are active, but the move is not clean yet",
      detail: `${flowLabel} weakened and open interest rose, so sellers are participating, but price still needs cleaner follow-through to confirm control.`,
      shortDetail: "Sell-side participation is building, but price still needs confirmation.",
      chips: [`${flowLabel} down`, "OI up"],
    }
  }

  if (priceBias !== 0 || flowBias !== 0 || oiBias !== 0) {
    return {
      kind: "mixed",
      directionBias: 0,
      score: 0,
      flowBias,
      oiBias,
      priceBias,
      flowLabel,
      flowState,
      oiState,
      row,
      headline: "Participation is mixed",
      detail: `${flowState} while ${oiState}. This bar has activity, but the participation mix is not clean enough to call it a high-conviction initiative move.`,
      shortDetail: `${flowState} while ${oiState}.`,
      chips: [flowState, oiState],
    }
  }

  return {
    kind: "flat",
    directionBias: 0,
    score: 0,
    flowBias,
    oiBias,
    priceBias,
    flowLabel,
    flowState,
    oiState,
    row,
    headline: "Participation is flat",
    detail: "This bar does not show a clear participation edge yet.",
    shortDetail: "Participation is flat.",
    chips: [],
  }
}

function summarizeLiquidity(candle) {
  const bids = Array.isArray(candle?.bids) ? candle.bids : []
  const asks = Array.isArray(candle?.asks) ? candle.asks : []
  if (!bids.length && !asks.length) return null

  const bidTotal = sumBookSize(bids)
  const askTotal = sumBookSize(asks)
  const largestBid = findLargestLevel(bids)
  const largestAsk = findLargestLevel(asks)
  const close = Number(candle?.close) || Number(candle?.best_bid) || Number(candle?.best_ask) || 0
  const rowSize = Math.max(
    Number(candle?.row_size) || Math.abs((Number(candle?.best_ask) || 0) - (Number(candle?.best_bid) || 0)) || 0.1,
    0.1,
  )

  const bidToAskRatio = askTotal > 0 ? bidTotal / askTotal : bidTotal > 0 ? Infinity : 1
  const bidDistanceTicks = largestBid ? (close - largestBid.price) / rowSize : Infinity
  const askDistanceTicks = largestAsk ? (largestAsk.price - close) / rowSize : Infinity
  const nearBidWall = largestBid && bidDistanceTicks >= -1 && bidDistanceTicks <= 10 && largestBid.size >= bidTotal * 0.28
  const nearAskWall = largestAsk && askDistanceTicks >= -1 && askDistanceTicks <= 10 && largestAsk.size >= askTotal * 0.28

  if (bidToAskRatio >= 1.35 && nearBidWall) {
    const price = formatLevelPrice(largestBid.price, rowSize)
    return {
      kind: "bid_support",
      headline: "Bid support sits just below price",
      detail: `Visible bid liquidity is heavier than the ask side and the biggest bid wall is parked near ${price}. That can support price until it is pulled or cleanly traded through.`,
      shortDetail: "Visible bid liquidity is stacked below price.",
      chips: ["Bid support"],
      bias: 1,
      row: "Bid liquidity is heavier below price",
    }
  }

  if (bidToAskRatio <= 0.74 && nearAskWall) {
    const price = formatLevelPrice(largestAsk.price, rowSize)
    return {
      kind: "ask_resistance",
      headline: "Ask liquidity is capping the move overhead",
      detail: `Visible ask liquidity outweighs the bid side and the biggest offer sits near ${price}. That can cap price until buyers chew through it or the wall gets pulled.`,
      shortDetail: "A visible offer wall sits just above price.",
      chips: ["Ask wall"],
      bias: -1,
      row: "Ask liquidity is heavier above price",
    }
  }

  if (bidToAskRatio >= 1.35) {
    return {
      kind: "book_bid_heavy",
      headline: "The visible book leans bid",
      detail: "Visible resting liquidity is heavier on the bid side, which gives buyers a nearby support edge, but the wall is not concentrated right on top of price yet.",
      shortDetail: "The visible book leans bid.",
      chips: ["Book bid-heavy"],
      bias: 1,
      row: "Visible book leans bid",
    }
  }

  if (bidToAskRatio <= 0.74) {
    return {
      kind: "book_ask_heavy",
      headline: "The visible book leans ask",
      detail: "Visible resting liquidity is heavier on the ask side, which gives sellers an overhead resistance edge, but the wall is not concentrated right on top of price yet.",
      shortDetail: "The visible book leans ask.",
      chips: ["Book ask-heavy"],
      bias: -1,
      row: "Visible book leans ask",
    }
  }

  return {
    kind: "book_balanced",
    headline: "The visible book is balanced",
    detail: "Visible bid and ask liquidity are fairly even here, so the next move depends more on trades hitting the tape than on a strong resting-liquidity skew.",
    shortDetail: "Visible bid and ask liquidity are fairly balanced.",
    chips: [],
    bias: 0,
    row: "Visible book is balanced",
  }
}

function describeDataQuality(candle, reliable) {
  const hasOI = (Number(candle?.oi) || 0) > 0
  const hasBook = (candle?.bids?.length || 0) > 0 || (candle?.asks?.length || 0) > 0

  if (reliable) {
    if (hasOI && hasBook) {
      return "Live footprint from raw trades, live OI, and a visible orderbook snapshot."
    }
    if (hasOI) {
      return "Live footprint from raw trades with live OI, but limited visible book context on this bar."
    }
    return "Live footprint from raw trades. OI has not populated yet on this bar."
  }

  if (hasOI) {
    return "History uses OHLC plus Bybit open-interest backfill. CVD, absorption, and imbalance are not reconstructed here."
  }
  return "History-only bar. Wait for live capture or replay for full orderflow context."
}

function buildLocationContext(candle, recentCandles, market) {
  const currentHigh = Number(candle?.high) || 0
  const currentLow = Number(candle?.low) || 0
  const currentClose = Number(candle?.close) || 0
  const step = Math.max(Number(candle?.row_size) || 0.1, 0.1)
  const session = market?.session || null
  const selectedProfile = market?.profile?.selected || null
  const nearbyLevels = Array.isArray(market?.nearbyLevels) ? market.nearbyLevels : []

  const isNearLevel = (price, ticks = 2) => {
    const numeric = Number(price)
    if (!Number.isFinite(numeric) || numeric <= 0) return false
    return Math.abs(currentClose - numeric) <= step * ticks
      || Math.abs(currentHigh - numeric) <= step * ticks
      || Math.abs(currentLow - numeric) <= step * ticks
  }

  if (!recentCandles.length) {
    return {
      hasContext: nearbyLevels.length > 0 || Boolean(session || selectedProfile),
      step,
      referenceHigh: currentHigh,
      referenceLow: currentLow,
      rangeMid: (currentHigh + currentLow) / 2,
      nearHigh: isNearLevel(session?.sessionHigh) || isNearLevel(session?.priorHigh) || isNearLevel(session?.openingRangeHigh) || isNearLevel(selectedProfile?.vah),
      nearLow: isNearLevel(session?.sessionLow) || isNearLevel(session?.priorLow) || isNearLevel(session?.openingRangeLow) || isNearLevel(selectedProfile?.val),
      sweptHigh: false,
      sweptLow: false,
      profileNearPOC: isNearLevel(selectedProfile?.poc, 3),
      nearbyLevels,
      volumeSpike: false,
      averageVolume: Number(candle?.total_volume) || 0,
    }
  }

  const highs = recentCandles.map((item) => Number(item?.high) || 0).filter((value) => value > 0)
  const lows = recentCandles.map((item) => Number(item?.low) || 0).filter((value) => value > 0)
  const volumes = recentCandles.map((item) => Number(item?.total_volume) || 0).filter((value) => value > 0)
  const referenceHigh = highs.length ? Math.max(...highs) : currentHigh
  const referenceLow = lows.length ? Math.min(...lows) : currentLow
  const averageVolume = average(volumes) || Number(candle?.total_volume) || 0
  const rangeMid = (referenceHigh + referenceLow) / 2
  const derivedNearHigh = currentHigh >= referenceHigh - step * 1.5
  const derivedNearLow = currentLow <= referenceLow + step * 1.5
  const profileNearHigh = isNearLevel(selectedProfile?.vah) || isNearLevel(session?.sessionHigh) || isNearLevel(session?.priorHigh) || isNearLevel(session?.openingRangeHigh)
  const profileNearLow = isNearLevel(selectedProfile?.val) || isNearLevel(session?.sessionLow) || isNearLevel(session?.priorLow) || isNearLevel(session?.openingRangeLow)

  return {
    hasContext: (highs.length > 0 && lows.length > 0) || nearbyLevels.length > 0 || Boolean(session || selectedProfile),
    step,
    referenceHigh,
    referenceLow,
    rangeMid,
    nearHigh: derivedNearHigh || profileNearHigh,
    nearLow: derivedNearLow || profileNearLow,
    sweptHigh: (currentHigh >= referenceHigh + step * 0.75 && currentClose <= referenceHigh - step * 0.25)
      || (session?.priorHigh ? currentHigh >= Number(session.priorHigh) + step * 0.5 && currentClose <= Number(session.priorHigh) - step * 0.25 : false),
    sweptLow: (currentLow <= referenceLow - step * 0.75 && currentClose >= referenceLow + step * 0.25)
      || (session?.priorLow ? currentLow <= Number(session.priorLow) - step * 0.5 && currentClose >= Number(session.priorLow) + step * 0.25 : false),
    profileNearPOC: isNearLevel(selectedProfile?.poc, 3),
    nearbyLevels,
    volumeSpike: averageVolume > 0
      ? (Number(candle?.total_volume) || 0) >= averageVolume * 1.25
      : (Number(candle?.total_volume) || 0) > 0,
    averageVolume,
  }
}

function evaluateReversalConfirmation(futureCandles, direction, candle, step) {
  const bars = (futureCandles || []).filter(Boolean).slice(0, 2)
  if (!bars.length) {
    return {
      state: "pending",
      row: "Await the next 1-2 bars for rejection confirmation",
      confirmed: false,
    }
  }

  const triggerMid = ((Number(candle?.high) || 0) + (Number(candle?.low) || 0)) / 2
  const invalidation = direction === "short"
    ? (Number(candle?.high) || 0) + step * 0.5
    : (Number(candle?.low) || 0) - step * 0.5

  for (const bar of bars) {
    if (direction === "short") {
      const movedAway = (Number(bar?.close) || 0) < triggerMid
      const alignedFlow = (Number(bar?.candle_delta) || 0) < 0 || Boolean(bar?.delta_divergence_bear)
      if ((Number(bar?.high) || 0) > invalidation && (Number(bar?.close) || 0) > (Number(candle?.close) || 0)) {
        return {
          state: "failed",
          row: "Next bar kept trading higher through the trapped high",
          confirmed: false,
        }
      }
      if (movedAway && alignedFlow) {
        return {
          state: "confirmed",
          row: "Next bar rejected the high with seller follow-through",
          confirmed: true,
        }
      }
    } else {
      const movedAway = (Number(bar?.close) || 0) > triggerMid
      const alignedFlow = (Number(bar?.candle_delta) || 0) > 0 || Boolean(bar?.delta_divergence_bull)
      if ((Number(bar?.low) || 0) < invalidation && (Number(bar?.close) || 0) < (Number(candle?.close) || 0)) {
        return {
          state: "failed",
          row: "Next bar kept trading lower through the trapped low",
          confirmed: false,
        }
      }
      if (movedAway && alignedFlow) {
        return {
          state: "confirmed",
          row: "Next bar rejected the low with buyer follow-through",
          confirmed: true,
        }
      }
    }
  }

  return {
    state: "pending",
    row: "The rejection has not fully confirmed yet",
    confirmed: false,
  }
}

function evaluateContinuationConfirmation(futureCandles, direction, candle, step) {
  const bars = (futureCandles || []).filter(Boolean).slice(0, 2)
  if (!bars.length) {
    return {
      state: "pending",
      row: "Await the next 1-2 bars for continuation follow-through",
      confirmed: false,
    }
  }

  const breakoutLevel = direction === "long"
    ? (Number(candle?.high) || 0) + step * 0.25
    : (Number(candle?.low) || 0) - step * 0.25
  const failureLevel = direction === "long"
    ? (Number(candle?.low) || 0) - step * 0.5
    : (Number(candle?.high) || 0) + step * 0.5

  for (const bar of bars) {
    if (direction === "long") {
      if ((Number(bar?.low) || 0) < failureLevel && (Number(bar?.close) || 0) < (Number(candle?.close) || 0)) {
        return {
          state: "failed",
          row: "Follow-through failed and price slipped back under the trigger bar",
          confirmed: false,
        }
      }
      if ((Number(bar?.high) || 0) > breakoutLevel && (Number(bar?.candle_delta) || 0) >= 0) {
        return {
          state: "confirmed",
          row: "Next bar extended higher and held the buy pressure",
          confirmed: true,
        }
      }
    } else {
      if ((Number(bar?.high) || 0) > failureLevel && (Number(bar?.close) || 0) > (Number(candle?.close) || 0)) {
        return {
          state: "failed",
          row: "Follow-through failed and price snapped back above the trigger bar",
          confirmed: false,
        }
      }
      if ((Number(bar?.low) || 0) < breakoutLevel && (Number(bar?.candle_delta) || 0) <= 0) {
        return {
          state: "confirmed",
          row: "Next bar extended lower and held the sell pressure",
          confirmed: true,
        }
      }
    }
  }

  return {
    state: "pending",
    row: "The continuation has not fully confirmed yet",
    confirmed: false,
  }
}

function buildQualityLabel(score, thresholds) {
  if (score >= (thresholds?.A ?? 9)) return "A setup"
  if (score >= (thresholds?.B ?? 7)) return "B setup"
  if (score >= (thresholds?.C ?? 5)) return "C setup"
  return "D setup"
}

function buildQualityTone(direction, reliable) {
  if (!reliable) return "muted"
  if (direction === "long") return "bullish"
  if (direction === "short") return "bearish"
  return "neutral"
}

function buildSetupQuality({
  scoreConfig,
  reliable,
  locationStrong,
  triggerStrong,
  confirmation,
  flowSupport,
  liquiditySupport,
  volumeSpike,
  sessionSupport,
  confluenceSupport,
  profileSupport,
  sessionFilter,
  sessionQuality,
}) {
  const weights = scoreConfig?.weights || {
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
  }
  let score = 0
  if (reliable) score += weights.reliable || 0
  if (locationStrong) score += weights.location || 0
  if (triggerStrong) score += weights.trigger || 0
  if (confirmation.state === "confirmed") score += weights.confirmation || 0
  if (flowSupport) score += weights.flow || 0
  if (liquiditySupport) score += weights.liquidity || 0
  if (volumeSpike) score += weights.volume || 0
  if (sessionSupport) score += weights.session || 0
  if (confluenceSupport) score += weights.confluence || 0
  if (profileSupport) score += weights.profile || 0
  if (confirmation.state === "failed") {
    score = Math.max(0, score - (weights.confirmation || 2))
  }

  const bucket = sessionQuality?.bucket || "balanced"
  if (sessionFilter === "strict" && ["poor", "chaotic", "history"].includes(bucket)) {
    return 0
  }
  if (sessionFilter === "balanced") {
    if (bucket === "poor") score = Math.max(0, score - 1)
    if (bucket === "chaotic") score = Math.max(0, score - 2)
    if (bucket === "history") score = Math.max(0, score - 3)
  }
  return score
}

function buildSetupRows(setup) {
  return [
    { label: "Setup", value: setup.setupLabel },
    ...(setup.locationLabel ? [{ label: "Location", value: setup.locationLabel }] : []),
    { label: "Confirmation", value: setup.confirmation.row },
    ...(setup.environmentLabel ? [{ label: "Environment", value: setup.environmentLabel }] : []),
    ...(setup.confluenceLabel ? [{ label: "HTF", value: setup.confluenceLabel }] : []),
    { label: "Risk", value: setup.invalidation },
    { label: "Target", value: setup.target },
  ]
}

function detectOrderflowSetup({
  candle,
  recentCandles,
  futureCandles,
  participation,
  liquidity,
  imbalance,
  reliable,
  market,
}) {
  const location = buildLocationContext(candle, recentCandles, market)
  if (!location.hasContext) return null

  const sessionQuality = market?.session?.quality || null
  const confluence = market?.confluence || null
  const selectedProfile = market?.profile?.selected || null
  const scoreConfig = market?.scoreConfig || null
  const sessionFilter = market?.sessionFilter || "balanced"
  const maxScore = scoreConfig?.maxScore || 11
  const locationLabel = location.nearbyLevels?.length
    ? location.nearbyLevels.map((level) => level.text).join(" | ")
    : location.nearHigh
      ? "Trading into local highs"
      : location.nearLow
        ? "Trading into local lows"
        : ""
  const environmentLabel = sessionQuality?.row || ""
  const confluenceLabel = confluence?.row || ""
  const bullishConfluence = (confluence?.directionBias || 0) >= 1
  const bearishConfluence = (confluence?.directionBias || 0) <= -1
  const sessionSupport = !sessionQuality || sessionQuality.score >= 1
  const profileSupport = Boolean(
    location.profileNearPOC
    || (location.nearHigh && selectedProfile?.vah)
    || (location.nearLow && selectedProfile?.val)
  )
  if (sessionFilter === "strict" && ["poor", "chaotic", "history"].includes(sessionQuality?.bucket)) {
    return null
  }
  const step = location.step
  const deltaThreshold = Math.max((Number(candle?.total_volume) || 0) * 0.15, location.averageVolume * 0.12, 1)
  const buyAggression = Boolean(
    candle?.absorption_high
    || candle?.unfinished_high
    || candle?.sweep_buy
    || imbalance?.side === "buy"
    || (Number(candle?.candle_delta) || 0) >= deltaThreshold
  )
  const sellAggression = Boolean(
    candle?.absorption_low
    || candle?.unfinished_low
    || candle?.sweep_sell
    || imbalance?.side === "sell"
    || (Number(candle?.candle_delta) || 0) <= -deltaThreshold
  )

  if (location.sweptHigh && buyAggression) {
    const confirmation = evaluateReversalConfirmation(futureCandles, "short", candle, step)
    const flowSupport = ["short_covering", "bearish_divergence", "mixed"].includes(participation.kind)
      || Boolean(candle?.delta_divergence_bear || candle?.absorption_high)
    const liquiditySupport = (liquidity?.bias || 0) <= 0
    const qualityScore = buildSetupQuality({
      scoreConfig,
      reliable,
      locationStrong: true,
      triggerStrong: true,
      confirmation,
      flowSupport,
      liquiditySupport,
      volumeSpike: location.volumeSpike,
      sessionSupport,
      confluenceSupport: bearishConfluence,
      profileSupport,
      sessionFilter,
      sessionQuality,
    })

    return {
      direction: "short",
      setupLabel: "Bull trap short",
      gradeLabel: `${buildQualityLabel(qualityScore, scoreConfig?.thresholds)} (${qualityScore}/${maxScore})`,
      gradeTone: buildQualityTone("short", reliable),
      qualityScore,
      confirmation,
      locationLabel,
      environmentLabel,
      confluenceLabel,
      invalidation: `Above ${formatLevelPrice((Number(candle?.high) || 0) + step * 0.5, step)}`,
      target: `Back inside range toward ${formatLevelPrice(location.rangeMid, step)}, then ${formatLevelPrice(location.referenceLow, step)}`,
      chips: ["Trap setup", "Fade breakout"],
      scoreAdjustment: confirmation.state === "confirmed" ? -6 : -3,
      headline: confirmation.state === "confirmed"
        ? "Bull trap confirmed at swing high"
        : "Possible bull trap at swing high",
      detail: confirmation.state === "confirmed"
        ? "Aggressive buyers chased a sweep above the prior high, but price failed back inside the range and the next bar rejected it. That is the classic trapped-breakout short."
        : "Price swept the prior high, printed aggressive buying at the top, and closed back inside the range. For sniper execution, wait for the next 1-2 bars to reject the high cleanly.",
    }
  }

  if (location.sweptLow && sellAggression) {
    const confirmation = evaluateReversalConfirmation(futureCandles, "long", candle, step)
    const flowSupport = ["long_liquidation", "bullish_divergence", "mixed"].includes(participation.kind)
      || Boolean(candle?.delta_divergence_bull || candle?.absorption_low)
    const liquiditySupport = (liquidity?.bias || 0) >= 0
    const qualityScore = buildSetupQuality({
      scoreConfig,
      reliable,
      locationStrong: true,
      triggerStrong: true,
      confirmation,
      flowSupport,
      liquiditySupport,
      volumeSpike: location.volumeSpike,
      sessionSupport,
      confluenceSupport: bullishConfluence,
      profileSupport,
      sessionFilter,
      sessionQuality,
    })

    return {
      direction: "long",
      setupLabel: "Bear trap long",
      gradeLabel: `${buildQualityLabel(qualityScore, scoreConfig?.thresholds)} (${qualityScore}/${maxScore})`,
      gradeTone: buildQualityTone("long", reliable),
      qualityScore,
      confirmation,
      locationLabel,
      environmentLabel,
      confluenceLabel,
      invalidation: `Below ${formatLevelPrice((Number(candle?.low) || 0) - step * 0.5, step)}`,
      target: `Back inside range toward ${formatLevelPrice(location.rangeMid, step)}, then ${formatLevelPrice(location.referenceHigh, step)}`,
      chips: ["Trap setup", "Fade breakdown"],
      scoreAdjustment: confirmation.state === "confirmed" ? 6 : 3,
      headline: confirmation.state === "confirmed"
        ? "Bear trap confirmed at swing low"
        : "Possible bear trap at swing low",
      detail: confirmation.state === "confirmed"
        ? "Aggressive sellers swept the prior low, but price failed back inside the range and the next bar rejected it. That is the classic trapped-breakdown long."
        : "Price swept the prior low, printed aggressive selling at the bottom, and closed back inside the range. For sniper execution, wait for the next 1-2 bars to reject the low cleanly.",
    }
  }

  if (location.nearHigh && candle?.absorption_high) {
    const confirmation = evaluateReversalConfirmation(futureCandles, "short", candle, step)
    const flowSupport = ["short_covering", "bearish_divergence", "mixed"].includes(participation.kind)
      || Boolean(candle?.delta_divergence_bear)
    const liquiditySupport = (liquidity?.bias || 0) <= 0
    const qualityScore = buildSetupQuality({
      scoreConfig,
      reliable,
      locationStrong: true,
      triggerStrong: true,
      confirmation,
      flowSupport,
      liquiditySupport,
      volumeSpike: location.volumeSpike,
      sessionSupport,
      confluenceSupport: bearishConfluence,
      profileSupport,
      sessionFilter,
      sessionQuality,
    })

    return {
      direction: "short",
      setupLabel: "Resistance absorption short",
      gradeLabel: `${buildQualityLabel(qualityScore, scoreConfig?.thresholds)} (${qualityScore}/${maxScore})`,
      gradeTone: buildQualityTone("short", reliable),
      qualityScore,
      confirmation,
      locationLabel,
      environmentLabel,
      confluenceLabel,
      invalidation: `Above ${formatLevelPrice((Number(candle?.high) || 0) + step * 0.5, step)}`,
      target: `Back away from resistance toward ${formatLevelPrice(location.rangeMid, step)}`,
      chips: ["Absorption", "Resistance defense"],
      scoreAdjustment: confirmation.state === "confirmed" ? -5 : -2,
      headline: confirmation.state === "confirmed"
        ? "Seller absorption held near resistance"
        : "Seller absorption is forming near resistance",
      detail: confirmation.state === "confirmed"
        ? "Buyers lifted the offer into a known high area, but passive sellers absorbed the flow and the next bar failed to extend. That is cleaner than shorting raw green numbers."
        : "Buyers are hitting the offer near a prior high, but price is not making clean progress. That often becomes a short only after the next bar confirms the rejection.",
    }
  }

  if (location.nearLow && candle?.absorption_low) {
    const confirmation = evaluateReversalConfirmation(futureCandles, "long", candle, step)
    const flowSupport = ["long_liquidation", "bullish_divergence", "mixed"].includes(participation.kind)
      || Boolean(candle?.delta_divergence_bull)
    const liquiditySupport = (liquidity?.bias || 0) >= 0
    const qualityScore = buildSetupQuality({
      scoreConfig,
      reliable,
      locationStrong: true,
      triggerStrong: true,
      confirmation,
      flowSupport,
      liquiditySupport,
      volumeSpike: location.volumeSpike,
      sessionSupport,
      confluenceSupport: bullishConfluence,
      profileSupport,
      sessionFilter,
      sessionQuality,
    })

    return {
      direction: "long",
      setupLabel: "Support absorption long",
      gradeLabel: `${buildQualityLabel(qualityScore, scoreConfig?.thresholds)} (${qualityScore}/${maxScore})`,
      gradeTone: buildQualityTone("long", reliable),
      qualityScore,
      confirmation,
      locationLabel,
      environmentLabel,
      confluenceLabel,
      invalidation: `Below ${formatLevelPrice((Number(candle?.low) || 0) - step * 0.5, step)}`,
      target: `Back away from support toward ${formatLevelPrice(location.rangeMid, step)}`,
      chips: ["Absorption", "Support defense"],
      scoreAdjustment: confirmation.state === "confirmed" ? 5 : 2,
      headline: confirmation.state === "confirmed"
        ? "Buyer absorption held near support"
        : "Buyer absorption is forming near support",
      detail: confirmation.state === "confirmed"
        ? "Sellers hit the bid into a known low area, but passive buyers absorbed the flow and the next bar failed to extend. That is the cleaner long entry than guessing at the low."
        : "Sellers are pressing into support, but price is not making clean progress lower. That often becomes a long only after the next bar confirms the defense.",
    }
  }

  if (imbalance?.stacked && imbalance.side === "buy" && ["fresh_longs", "buy_build"].includes(participation.kind)) {
    const confirmation = evaluateContinuationConfirmation(futureCandles, "long", candle, step)
    const liquiditySupport = (liquidity?.bias || 0) >= 0
    const qualityScore = buildSetupQuality({
      scoreConfig,
      reliable,
      locationStrong: location.nearHigh,
      triggerStrong: true,
      confirmation,
      flowSupport: true,
      liquiditySupport,
      volumeSpike: location.volumeSpike,
      sessionSupport,
      confluenceSupport: bullishConfluence,
      profileSupport,
      sessionFilter,
      sessionQuality,
    })

    return {
      direction: "long",
      setupLabel: "Stacked imbalance continuation long",
      gradeLabel: `${buildQualityLabel(qualityScore, scoreConfig?.thresholds)} (${qualityScore}/${maxScore})`,
      gradeTone: buildQualityTone("long", reliable),
      qualityScore,
      confirmation,
      locationLabel,
      environmentLabel,
      confluenceLabel,
      invalidation: `Below ${formatLevelPrice((Number(candle?.low) || 0) - step * 0.5, step)}`,
      target: `Continuation through the high above ${formatLevelPrice(Number(candle?.high) || 0, step)}`,
      chips: ["Stacked imbalance", "Continuation"],
      scoreAdjustment: confirmation.state === "confirmed" ? 4 : 2,
      headline: confirmation.state === "confirmed"
        ? "Buy imbalance continuation confirmed"
        : "Stacked buy imbalance needs follow-through",
      detail: confirmation.state === "confirmed"
        ? "Multiple buy imbalances fired together and the next bar extended higher. That is the kind of continuation you trade with, not fade."
        : "Stacked buy imbalances alone are not enough. The next bar still needs to extend and hold the buy pressure before this becomes a cleaner continuation long.",
    }
  }

  if (imbalance?.stacked && imbalance.side === "sell" && ["fresh_shorts", "sell_build"].includes(participation.kind)) {
    const confirmation = evaluateContinuationConfirmation(futureCandles, "short", candle, step)
    const liquiditySupport = (liquidity?.bias || 0) <= 0
    const qualityScore = buildSetupQuality({
      scoreConfig,
      reliable,
      locationStrong: location.nearLow,
      triggerStrong: true,
      confirmation,
      flowSupport: true,
      liquiditySupport,
      volumeSpike: location.volumeSpike,
      sessionSupport,
      confluenceSupport: bearishConfluence,
      profileSupport,
      sessionFilter,
      sessionQuality,
    })

    return {
      direction: "short",
      setupLabel: "Stacked imbalance continuation short",
      gradeLabel: `${buildQualityLabel(qualityScore, scoreConfig?.thresholds)} (${qualityScore}/${maxScore})`,
      gradeTone: buildQualityTone("short", reliable),
      qualityScore,
      confirmation,
      locationLabel,
      environmentLabel,
      confluenceLabel,
      invalidation: `Above ${formatLevelPrice((Number(candle?.high) || 0) + step * 0.5, step)}`,
      target: `Continuation through the low below ${formatLevelPrice(Number(candle?.low) || 0, step)}`,
      chips: ["Stacked imbalance", "Continuation"],
      scoreAdjustment: confirmation.state === "confirmed" ? -4 : -2,
      headline: confirmation.state === "confirmed"
        ? "Sell imbalance continuation confirmed"
        : "Stacked sell imbalance needs follow-through",
      detail: confirmation.state === "confirmed"
        ? "Multiple sell imbalances fired together and the next bar extended lower. That is the kind of continuation you trade with, not fade."
        : "Stacked sell imbalances alone are not enough. The next bar still needs to extend and hold the sell pressure before this becomes a cleaner continuation short.",
    }
  }

  if (location.nearHigh && (candle?.delta_divergence_bear || participation.kind === "bearish_divergence")) {
    const confirmation = evaluateReversalConfirmation(futureCandles, "short", candle, step)
    const liquiditySupport = (liquidity?.bias || 0) <= 0
    const qualityScore = buildSetupQuality({
      scoreConfig,
      reliable,
      locationStrong: true,
      triggerStrong: true,
      confirmation,
      flowSupport: true,
      liquiditySupport,
      volumeSpike: location.volumeSpike,
      sessionSupport,
      confluenceSupport: bearishConfluence,
      profileSupport,
      sessionFilter,
      sessionQuality,
    })

    return {
      direction: "short",
      setupLabel: "Bearish divergence reversal",
      gradeLabel: `${buildQualityLabel(qualityScore, scoreConfig?.thresholds)} (${qualityScore}/${maxScore})`,
      gradeTone: buildQualityTone("short", reliable),
      qualityScore,
      confirmation,
      locationLabel,
      environmentLabel,
      confluenceLabel,
      invalidation: `Above ${formatLevelPrice((Number(candle?.high) || 0) + step * 0.5, step)}`,
      target: `Back into the prior range toward ${formatLevelPrice(location.rangeMid, step)}`,
      chips: ["Divergence", "Reversal"],
      scoreAdjustment: confirmation.state === "confirmed" ? -4 : -2,
      headline: confirmation.state === "confirmed"
        ? "Bearish divergence reversal confirmed"
        : "Bearish divergence is forming at the high",
      detail: confirmation.state === "confirmed"
        ? "Price stretched into a higher area, but the underlying flow weakened and the next bar confirmed the rejection. That is a cleaner reversal than fading strength blindly."
        : "Price is pushing into the high area without strong flow confirmation. That can become a short only if the next bar rejects the area.",
    }
  }

  if (location.nearLow && (candle?.delta_divergence_bull || participation.kind === "bullish_divergence")) {
    const confirmation = evaluateReversalConfirmation(futureCandles, "long", candle, step)
    const liquiditySupport = (liquidity?.bias || 0) >= 0
    const qualityScore = buildSetupQuality({
      scoreConfig,
      reliable,
      locationStrong: true,
      triggerStrong: true,
      confirmation,
      flowSupport: true,
      liquiditySupport,
      volumeSpike: location.volumeSpike,
      sessionSupport,
      confluenceSupport: bullishConfluence,
      profileSupport,
      sessionFilter,
      sessionQuality,
    })

    return {
      direction: "long",
      setupLabel: "Bullish divergence reversal",
      gradeLabel: `${buildQualityLabel(qualityScore, scoreConfig?.thresholds)} (${qualityScore}/${maxScore})`,
      gradeTone: buildQualityTone("long", reliable),
      qualityScore,
      confirmation,
      locationLabel,
      environmentLabel,
      confluenceLabel,
      invalidation: `Below ${formatLevelPrice((Number(candle?.low) || 0) - step * 0.5, step)}`,
      target: `Back into the prior range toward ${formatLevelPrice(location.rangeMid, step)}`,
      chips: ["Divergence", "Reversal"],
      scoreAdjustment: confirmation.state === "confirmed" ? 4 : 2,
      headline: confirmation.state === "confirmed"
        ? "Bullish divergence reversal confirmed"
        : "Bullish divergence is forming at the low",
      detail: confirmation.state === "confirmed"
        ? "Price stretched into a lower area, but the underlying flow improved and the next bar confirmed the rejection. That is a cleaner reversal than bottom-picking blindly."
        : "Price is pressing into the low area without strong sell-side confirmation. That can become a long only if the next bar rejects the area.",
    }
  }

  return null
}

function buildHistoryReading(candle, participation, liquidity, dataQuality, market) {
  const rows = []
  const chips = []

  if (participation?.row) {
    rows.push({ label: "Flow", value: participation.row })
  }
  if (liquidity?.row) {
    rows.push({ label: "Liquidity", value: liquidity.row })
  }
  if (market?.session?.quality?.row) {
    rows.push({ label: "Session", value: market.session.quality.row })
  }
  if (market?.confluence?.row) {
    rows.push({ label: "HTF", value: market.confluence.row })
  }
  rows.push({ label: "Data", value: dataQuality })

  if (participation?.chips) {
    participation.chips.forEach((chip) => pushUnique(chips, chip))
  }
  if (liquidity?.chips) {
    liquidity.chips.forEach((chip) => pushUnique(chips, chip))
  }
  pushUnique(chips, (Number(candle?.oi) || 0) > 0 ? "History OI" : "History only")

  return {
    tone: "muted",
    gradeLabel: "",
    gradeTone: "muted",
    headline: participation?.headline || "Backfilled bar",
    detail: appendSentence(
      participation?.detail || "This bar is historical backfill, so CVD, absorption, and imbalance reads are not fully available here.",
      liquidity?.shortDetail,
    ),
    chips: chips.slice(0, 6),
    rows: rows.slice(0, 6),
    score: participation?.score || 0,
    setup: null,
  }
}

export function buildOrderflowReading(candle, context) {
  if (!candle) {
    return {
      tone: "neutral",
      gradeLabel: "",
      gradeTone: "neutral",
      headline: "No candle selected",
      detail: "Hover a footprint bar or wait for live flow to read absorption, participation, and liquidity.",
      chips: [],
      rows: [],
      score: 0,
      setup: null,
    }
  }

  const readingContext = normalizeReadingContext(context)
  const reliable = isReliableOrderflow(candle)
  const imbalance = reliable ? summarizeCandleImbalance(candle) : null
  const participation = summarizeParticipation(candle, readingContext.previousCandle, reliable)
  const liquidity = summarizeLiquidity(candle)
  const dataQuality = describeDataQuality(candle, reliable)
  const market = readingContext.market || null

  if (!reliable) {
    return buildHistoryReading(candle, participation, liquidity, dataQuality, market)
  }

  const setup = detectOrderflowSetup({
    candle,
    recentCandles: readingContext.recentCandles,
    futureCandles: readingContext.futureCandles,
    participation,
    liquidity,
    imbalance,
    reliable,
    market,
  })

  const rows = []
  const chips = []
  let bullScore = 0
  let bearScore = 0
  let headline = "Balanced orderflow"
  let detail = "No standout orderflow edge on this bar. Use location and follow-through for context."
  let gradeLabel = ""
  let gradeTone = "neutral"

  if (candle.absorption_low) {
    bullScore += 4
    pushUnique(chips, "Buyer absorption")
    headline = "Buyer absorption at the low"
    detail = "Heavy sells hit the bid but price held. Passive buyers likely defended this area."
  }

  if (candle.absorption_high) {
    bearScore += 4
    pushUnique(chips, "Seller absorption")
    if (bearScore >= bullScore) {
      headline = "Seller absorption at the high"
      detail = "Heavy buys lifted the offer but price stalled. Passive sellers likely capped this area."
    }
  }

  if (imbalance?.side === "buy") {
    bullScore += imbalance.stacked ? 3 : 2
    pushUnique(chips, imbalance.stacked ? "Stacked buy imbalance" : "Buy imbalance")
    if (!candle.absorption_low && bullScore >= bearScore) {
      headline = imbalance.stacked ? "Initiative buying stepped in" : "Buyers won the cluster battle"
      detail = imbalance.stacked
        ? "Multiple adjacent ask-side imbalances show aggressive buyers pressing through nearby prices."
        : "Ask-side volume dominated the bar, which points to aggressive buyers."
    }
  }

  if (imbalance?.side === "sell") {
    bearScore += imbalance.stacked ? 3 : 2
    pushUnique(chips, imbalance.stacked ? "Stacked sell imbalance" : "Sell imbalance")
    if (!candle.absorption_high && bearScore > bullScore) {
      headline = imbalance.stacked ? "Initiative selling stepped in" : "Sellers won the cluster battle"
      detail = imbalance.stacked
        ? "Multiple adjacent bid-side imbalances show aggressive sellers pressing through nearby prices."
        : "Bid-side volume dominated the bar, which points to aggressive sellers."
    }
  }

  if (candle.exhaustion_low) {
    bullScore += 2
    pushUnique(chips, "Seller exhaustion")
    if (bullScore >= bearScore && !candle.absorption_low) {
      headline = "Sellers look exhausted near the low"
      detail = "Price pushed lower but the selling effort dried up, which can support a bounce if context agrees."
    }
  }

  if (candle.exhaustion_high) {
    bearScore += 2
    pushUnique(chips, "Buyer exhaustion")
    if (bearScore > bullScore && !candle.absorption_high) {
      headline = "Buyers look exhausted near the high"
      detail = "Price pushed higher but the buying effort faded, which can support a rejection if context agrees."
    }
  }

  if (candle.delta_divergence_bull) {
    bullScore += 2
    pushUnique(chips, "Bullish divergence")
    if (bullScore >= bearScore && !candle.absorption_low && !candle.exhaustion_low) {
      headline = "Bullish delta divergence"
      detail = "Price closed weakly, but the orderflow underneath was stronger than price suggests."
    }
  }

  if (candle.delta_divergence_bear) {
    bearScore += 2
    pushUnique(chips, "Bearish divergence")
    if (bearScore > bullScore && !candle.absorption_high && !candle.exhaustion_high) {
      headline = "Bearish delta divergence"
      detail = "Price closed strongly, but the orderflow underneath was weaker than price suggests."
    }
  }

  if (candle.sweep_buy) {
    bullScore += 2
    pushUnique(chips, "Buy sweep")
  }

  if (candle.sweep_sell) {
    bearScore += 2
    pushUnique(chips, "Sell sweep")
  }

  if (candle.unfinished_low) {
    pushUnique(chips, "Unfinished low")
  }

  if (candle.unfinished_high) {
    pushUnique(chips, "Unfinished high")
  }

  if (Math.abs(Number(candle?.candle_delta) || 0) > 0) {
    if ((Number(candle?.candle_delta) || 0) > 0) {
      bullScore += 1
    } else {
      bearScore += 1
    }
  }

  if (participation) {
    if (participation.score > 0) {
      bullScore += participation.score
    } else if (participation.score < 0) {
      bearScore += Math.abs(participation.score)
    }

    participation.chips.forEach((chip) => pushUnique(chips, chip))

    const barHasStructuralSignal = Boolean(
      candle.absorption_low
      || candle.absorption_high
      || candle.exhaustion_low
      || candle.exhaustion_high
      || candle.delta_divergence_bull
      || candle.delta_divergence_bear,
    )

    if (!barHasStructuralSignal || Math.abs(participation.score) >= Math.max(bullScore, bearScore) / 2) {
      headline = participation.headline
      detail = participation.detail
    } else {
      detail = appendSentence(detail, participation.shortDetail)
    }
  }

  if (liquidity) {
    if (liquidity.bias > 0) bullScore += 1
    if (liquidity.bias < 0) bearScore += 1
    liquidity.chips.forEach((chip) => pushUnique(chips, chip))

    if (!participation && Math.abs(bullScore - bearScore) <= 1 && Math.abs(liquidity.bias) > 0) {
      headline = liquidity.headline
      detail = liquidity.detail
    } else if (liquidity.shortDetail && !detail.includes(liquidity.shortDetail)) {
      detail = appendSentence(detail, liquidity.shortDetail)
    }
  }

  if (setup) {
    if (setup.scoreAdjustment > 0) {
      bullScore += setup.scoreAdjustment
    } else {
      bearScore += Math.abs(setup.scoreAdjustment)
    }
    gradeLabel = setup.gradeLabel
    gradeTone = setup.gradeTone
    setup.chips.forEach((chip) => pushUnique(chips, chip))
    rows.push(...buildSetupRows(setup))
    headline = setup.headline
    detail = appendSentence(setup.detail, participation.shortDetail)
    if (liquidity?.shortDetail && !detail.includes(liquidity.shortDetail)) {
      detail = appendSentence(detail, liquidity.shortDetail)
    }
  }

  if (participation?.row) {
    rows.push({ label: "Flow", value: participation.row })
  }
  if (liquidity?.row) {
    rows.push({ label: "Liquidity", value: liquidity.row })
  }
  if (market?.session?.quality?.row) {
    rows.push({ label: "Session", value: market.session.quality.row })
  }
  if (market?.confluence?.row) {
    rows.push({ label: "HTF", value: market.confluence.row })
  }
  if (market?.nearbyLevels?.length) {
    rows.push({ label: "Levels", value: market.nearbyLevels.map((level) => level.text).join(" | ") })
  }
  rows.push({ label: "Data", value: dataQuality })

  const score = bullScore - bearScore
  const tone = setup
    ? (setup.direction === "long" ? "bullish" : "bearish")
    : score > 1
      ? "bullish"
      : score < -1
        ? "bearish"
        : "neutral"

  if (!gradeLabel && tone !== "neutral") {
    gradeLabel = "Directional read"
    gradeTone = tone
  }

  if (tone === "neutral" && chips.length === 0) {
    chips.push("No standout signal")
  }

  return {
    tone,
    gradeLabel,
    gradeTone,
    headline,
    detail,
    chips: chips.slice(0, 7),
    rows: rows.slice(0, 9),
    score,
    setup: setup ? {
      direction: setup.direction,
      gradeLabel: setup.gradeLabel,
      qualityScore: setup.qualityScore,
      setupLabel: setup.setupLabel,
      headline: setup.headline,
      price: setup.direction === "short" ? Number(candle?.high) || Number(candle?.close) || 0 : Number(candle?.low) || Number(candle?.close) || 0,
    } : null,
  }
}
