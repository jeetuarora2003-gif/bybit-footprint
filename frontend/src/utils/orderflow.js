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
  if (candle.absorption_low) tags.push("ABS LOW")
  if (candle.absorption_high) tags.push("ABS HIGH")
  if (candle.exhaustion_low) tags.push("EXH LOW")
  if (candle.exhaustion_high) tags.push("EXH HIGH")
  if (candle.sweep_buy) tags.push("SWEEP UP")
  if (candle.sweep_sell) tags.push("SWEEP DN")
  if (candle.delta_divergence_bull) tags.push("DIV BULL")
  if (candle.delta_divergence_bear) tags.push("DIV BEAR")
  if (candle.unfinished_low) tags.push("UNF LOW")
  if (candle.unfinished_high) tags.push("UNF HIGH")

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

function getPriceDecimals(rowSize, fallback = 2) {
  const step = Number(rowSize)
  if (!Number.isFinite(step) || step <= 0) return fallback
  if (step >= 1) return 0
  return Math.min(4, Math.max(1, Math.ceil(Math.log10(1 / step))))
}

function formatCompact(value, maximumFractionDigits = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  return numeric.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits,
  })
}

function formatSignedCompact(value, maximumFractionDigits = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  const formatted = formatCompact(Math.abs(numeric), maximumFractionDigits)
  return `${numeric > 0 ? "+" : numeric < 0 ? "-" : ""}${formatted}`
}

function formatPlain(value, maximumFractionDigits = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits,
  })
}

function formatPrice(value, rowSize) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: getPriceDecimals(rowSize, 2),
  })
}

function formatSignedPrice(value, rowSize) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  const formatted = formatPrice(Math.abs(numeric), rowSize)
  return `${numeric > 0 ? "+" : numeric < 0 ? "-" : ""}${formatted}`
}

function formatRatio(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  return `${numeric.toFixed(2)}x`
}

function formatCoverage(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  return `${(numeric * 100).toFixed(1)}%`
}

function normalizeReadingContext(context) {
  if (!context) {
    return {
      previousCandle: null,
      recentCandles: [],
    }
  }

  if ("candle_open_time" in context && "close" in context) {
    return {
      previousCandle: context,
      recentCandles: [],
    }
  }

  return {
    previousCandle: context.previousCandle || null,
    recentCandles: Array.isArray(context.recentCandles) ? context.recentCandles.filter(Boolean) : [],
  }
}

function describeDataQuality(candle, reliable) {
  const hasOI = (Number(candle?.oi) || 0) > 0
  const hasBook = (candle?.bids?.length || 0) > 0 || (candle?.asks?.length || 0) > 0
  const coverage = formatCoverage(candle?.orderflow_coverage ?? 0)

  if (reliable) {
    if (hasOI && hasBook) {
      return {
        label: "Live captured",
        tone: "live",
        chip: "Live captured",
        row: `Live trades, live OI, and visible book. Coverage ${coverage}.`,
        detail: "This bar is built from captured live trades with matching open-interest and book context.",
        panelTone: "neutral",
      }
    }

    if (hasOI) {
      return {
        label: "Partial live",
        tone: "caution",
        chip: "Partial live",
        row: `Live trades and OI, but limited book depth. Coverage ${coverage}.`,
        detail: "The trade tape and OI are live, but the visible book is thin or missing for this bar.",
        panelTone: "neutral",
      }
    }

    return {
      label: "Live incomplete",
      tone: "caution",
      chip: "OI pending",
      row: `Live trades captured, but OI has not populated yet. Coverage ${coverage}.`,
      detail: "This bar is live, but participation is incomplete because open interest is not populated yet.",
      panelTone: "neutral",
    }
  }

  if (hasOI) {
    return {
      label: "Backfill + OI",
      tone: "muted",
      chip: "Backfill + OI",
      row: "Historical OHLC with open-interest backfill only.",
      detail: "Historical bars here do not contain reconstructed live footprint or book events.",
      panelTone: "muted",
    }
  }

  return {
    label: "Backfill only",
    tone: "muted",
    chip: "Backfill only",
    row: "Historical OHLC only, without reconstructed footprint details.",
    detail: "This is context history only. Advanced tape details are unavailable on this bar.",
    panelTone: "muted",
  }
}

function buildPriceRow(candle) {
  const rowSize = Number(candle?.row_size) || 0.1
  const range = (Number(candle?.high) || 0) - (Number(candle?.low) || 0)
  const ticks = rowSize > 0 ? range / rowSize : 0

  return {
    label: "Price",
    value: `O ${formatPrice(candle?.open, rowSize)} | H ${formatPrice(candle?.high, rowSize)} | L ${formatPrice(candle?.low, rowSize)} | C ${formatPrice(candle?.close, rowSize)} | Range ${formatPlain(ticks, 1)} ticks`,
  }
}

function buildVolumeRow(candle) {
  return {
    label: "Volume",
    value: `Total ${formatCompact(candle?.total_volume)} | Buy ${formatCompact(candle?.buy_volume)} | Sell ${formatCompact(candle?.sell_volume)} | Delta ${formatSignedCompact(candle?.candle_delta)}`,
  }
}

function buildFlowRow(candle, previousCandle, reliable) {
  const parts = [`Bar delta ${formatSignedCompact(candle?.candle_delta)}`]

  if (reliable && isReliableOrderflow(previousCandle)) {
    const cvdChange = (Number(candle?.cvd) || 0) - (Number(previousCandle?.cvd) || 0)
    parts.unshift(`CVD change ${formatSignedCompact(cvdChange)}`)
  } else if (reliable && Number.isFinite(Number(candle?.cvd))) {
    parts.unshift(`CVD ${formatSignedCompact(candle?.cvd)}`)
  } else {
    parts.unshift("CVD unavailable")
  }

  if (previousCandle?.close != null && candle?.close != null) {
    const priceChange = (Number(candle.close) || 0) - (Number(previousCandle.close) || 0)
    parts.push(`Close vs prev ${formatSignedPrice(priceChange, candle?.row_size)}`)
  }

  return {
    label: "Flow",
    value: parts.join(" | "),
  }
}

function buildOIRow(candle, previousCandle) {
  const currentOI = Number(candle?.oi)
  const previousOI = Number(previousCandle?.oi)
  const explicitDelta = Number(candle?.oi_delta)
  const oiDelta = Number.isFinite(currentOI) && currentOI > 0 && Number.isFinite(previousOI) && previousOI > 0
    ? currentOI - previousOI
    : explicitDelta

  if (!Number.isFinite(currentOI) || currentOI <= 0) {
    return {
      label: "OI",
      value: "Open interest unavailable on this bar",
    }
  }

  return {
    label: "OI",
    value: `OI ${formatCompact(currentOI)} | Change ${formatSignedCompact(oiDelta)}`,
  }
}

function buildImbalanceRow(candle) {
  const imbalance = summarizeCandleImbalance(candle)
  if (!imbalance) {
    return {
      label: "Imbalance",
      value: "No flagged imbalance on this bar",
    }
  }

  return {
    label: "Imbalance",
    value: `${imbalance.side.toUpperCase()} ${imbalance.stacked ? "stacked" : "single"} | ${imbalance.count} flagged prints | Strongest ${formatCompact(imbalance.value)}`,
  }
}

function buildLiquidityRow(candle) {
  const bids = Array.isArray(candle?.bids) ? candle.bids : []
  const asks = Array.isArray(candle?.asks) ? candle.asks : []
  if (!bids.length && !asks.length) {
    return {
      label: "Book",
      value: "Visible orderbook unavailable on this bar",
    }
  }

  const bidTotal = sumBookSize(bids)
  const askTotal = sumBookSize(asks)
  const ratio = askTotal > 0 ? bidTotal / askTotal : bidTotal > 0 ? Infinity : 1
  const largestBid = findLargestLevel(bids)
  const largestAsk = findLargestLevel(asks)
  const rowSize = Number(candle?.row_size) || Math.abs((Number(candle?.best_ask) || 0) - (Number(candle?.best_bid) || 0)) || 0.1

  const parts = [
    `Bid ${formatCompact(bidTotal)}`,
    `Ask ${formatCompact(askTotal)}`,
    `B/A ${formatRatio(ratio)}`,
  ]

  if (largestBid) {
    parts.push(`Max bid ${formatPrice(largestBid.price, rowSize)} x ${formatCompact(largestBid.size)}`)
  }

  if (largestAsk) {
    parts.push(`Max ask ${formatPrice(largestAsk.price, rowSize)} x ${formatCompact(largestAsk.size)}`)
  }

  return {
    label: "Book",
    value: parts.join(" | "),
  }
}

function buildContextRow(candle, previousCandle, recentCandles) {
  if (!previousCandle && (!recentCandles || recentCandles.length === 0)) {
    return {
      label: "Context",
      value: "Need nearby live bars for comparative context",
    }
  }

  const currentVolume = Number(candle?.total_volume) || 0
  const currentRange = Math.abs((Number(candle?.high) || 0) - (Number(candle?.low) || 0))
  const currentAbsDelta = Math.abs(Number(candle?.candle_delta) || 0)

  const recentVolumeAvg = average(recentCandles.map((item) => Number(item?.total_volume) || 0).filter((value) => value > 0))
  const recentRangeAvg = average(recentCandles.map((item) => Math.abs((Number(item?.high) || 0) - (Number(item?.low) || 0))).filter((value) => value > 0))
  const recentAbsDeltaAvg = average(recentCandles.map((item) => Math.abs(Number(item?.candle_delta) || 0)).filter((value) => value > 0))

  const parts = []

  if (previousCandle?.close != null && candle?.close != null) {
    const closeChange = (Number(candle.close) || 0) - (Number(previousCandle.close) || 0)
    parts.push(`Close vs prev ${formatSignedPrice(closeChange, candle?.row_size)}`)
  }

  if (recentVolumeAvg > 0) {
    parts.push(`Volume ${formatRatio(currentVolume / recentVolumeAvg)} recent avg`)
  }

  if (recentAbsDeltaAvg > 0) {
    parts.push(`Abs delta ${formatRatio(currentAbsDelta / recentAbsDeltaAvg)} recent avg`)
  }

  if (recentRangeAvg > 0) {
    parts.push(`Range ${formatRatio(currentRange / recentRangeAvg)} recent avg`)
  }

  return {
    label: "Context",
    value: parts.length ? parts.join(" | ") : "Need nearby live bars for comparative context",
  }
}

function buildFlagsRow(candle) {
  const flags = summarizeStudySignals(candle)
  return {
    label: "Flags",
    value: flags.length ? flags.join(" | ") : "No study flags on this bar",
  }
}

export function buildOrderflowReading(candle, context) {
  if (!candle) {
    return {
      tone: "muted",
      gradeLabel: "",
      gradeTone: "muted",
      headline: "No candle selected",
      detail: "Hover a footprint bar or wait for live data to inspect raw price, volume, delta, OI, imbalance, and book metrics.",
      chips: [],
      rows: [],
      score: 0,
      qualityLabel: "",
      qualityTone: "muted",
      setup: null,
    }
  }

  const readingContext = normalizeReadingContext(context)
  const reliable = isReliableOrderflow(candle)
  const dataQuality = describeDataQuality(candle, reliable)
  const rows = [
    buildPriceRow(candle),
    buildVolumeRow(candle),
    buildFlowRow(candle, readingContext.previousCandle, reliable),
    buildOIRow(candle, readingContext.previousCandle),
    buildImbalanceRow(candle),
    buildLiquidityRow(candle),
    buildContextRow(candle, readingContext.previousCandle, readingContext.recentCandles),
    buildFlagsRow(candle),
    { label: "Quality", value: dataQuality.row },
  ]

  const chips = []
  pushUnique(chips, dataQuality.chip)

  const studySignals = summarizeStudySignals(candle)
  for (const tag of studySignals.slice(0, 6)) {
    pushUnique(chips, tag)
  }

  const headline = reliable
    ? "Objective footprint data for the selected bar"
    : "Historical bar with limited footprint fidelity"

  const detail = `${dataQuality.detail} This panel is descriptive only and does not generate trade signals.`

  return {
    tone: dataQuality.panelTone,
    gradeLabel: "",
    gradeTone: "neutral",
    qualityLabel: dataQuality.label,
    qualityTone: dataQuality.tone,
    headline,
    detail,
    chips,
    rows,
    score: 0,
    setup: null,
  }
}
