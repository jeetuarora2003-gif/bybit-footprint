export function summarizeCandleImbalance(candle) {
  if (!candle?.clusters?.length) return null;

  let strongest = null;
  let count = 0;
  let stacked = false;

  for (const cluster of candle.clusters) {
    if (cluster.imbalance_buy) {
      count += 1;
      stacked = stacked || Boolean(cluster.stacked_buy);
      const value = Number(cluster.buyVol) || 0;
      if (!strongest || value > strongest.value) {
        strongest = { value, side: "buy" };
      }
    }

    if (cluster.imbalance_sell) {
      count += 1;
      stacked = stacked || Boolean(cluster.stacked_sell);
      const value = Number(cluster.sellVol) || 0;
      if (!strongest || value > strongest.value) {
        strongest = { value, side: "sell" };
      }
    }
  }

  return strongest ? { ...strongest, count, stacked } : null;
}

export function candleHasImbalance(candle) {
  return Boolean(summarizeCandleImbalance(candle));
}

export function summarizeStudySignals(candle) {
  if (!candle) return [];
  const tags = [];
  if (candle.absorption_low || candle.absorption_high) tags.push("ABS");
  if (candle.exhaustion_low || candle.exhaustion_high) tags.push("EXH");
  if (candle.sweep_buy) tags.push("SWEEP UP");
  if (candle.sweep_sell) tags.push("SWEEP DN");
  if (candle.delta_divergence_bull) tags.push("DIV BULL");
  if (candle.delta_divergence_bear) tags.push("DIV BEAR");
  if (Array.isArray(candle.alerts)) {
    for (const tag of candle.alerts) {
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

function pushUnique(items, value) {
  if (value && !items.includes(value)) {
    items.push(value);
  }
}

function appendSentence(base, extra) {
  if (!extra) return base;
  if (!base) return extra;
  return `${base}${base.endsWith(".") ? "" : "."} ${extra}`;
}

function clampBias(value, threshold) {
  if (!Number.isFinite(value)) return 0;
  if (value > threshold) return 1;
  if (value < -threshold) return -1;
  return 0;
}

function isReliableOrderflow(candle) {
  return Number(candle?.orderflow_coverage ?? 0) >= 0.999;
}

function sumBookSize(levels) {
  return (levels || []).reduce((total, level) => total + (Number(level?.size) || 0), 0);
}

function findLargestLevel(levels) {
  let largest = null;
  for (const level of levels || []) {
    const size = Number(level?.size) || 0;
    const price = Number(level?.price) || 0;
    if (!size || !price) continue;
    if (!largest || size > largest.size) {
      largest = { price, size };
    }
  }
  return largest;
}

function formatLevelPrice(price, rowSize) {
  const numeric = Number(price);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  const step = Math.max(Number(rowSize) || 0.1, 0.0001);
  const decimals = step >= 1 ? 0 : Math.min(4, Math.max(1, Math.ceil(Math.log10(1 / step))));
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function summarizeParticipation(candle, previousCandle, reliable) {
  const referenceClose = Number(previousCandle?.close);
  const referencePrice = Number.isFinite(referenceClose) && referenceClose > 0
    ? referenceClose
    : Number(candle?.open) || 0;
  const currentClose = Number(candle?.close) || 0;
  const rowSize = Math.max(Number(candle?.row_size) || 0.1, 0.1);
  const barRange = Math.max(Math.abs((Number(candle?.high) || currentClose) - (Number(candle?.low) || currentClose)), rowSize);
  const priceDelta = currentClose - referencePrice;
  const priceBias = clampBias(priceDelta, Math.max(barRange * 0.15, rowSize * 2));

  const canUseCvd = reliable && isReliableOrderflow(previousCandle);
  const flowDelta = canUseCvd
    ? (Number(candle?.cvd) || 0) - (Number(previousCandle?.cvd) || 0)
    : Number(candle?.candle_delta) || 0;
  const flowBias = clampBias(flowDelta, Math.max((Number(candle?.total_volume) || 0) * 0.08, 1));
  const flowLabel = canUseCvd ? "CVD" : "Delta";

  const currentOI = Number(candle?.oi) || 0;
  const previousOI = Number(previousCandle?.oi) || 0;
  const oiDelta = currentOI > 0 && previousOI > 0
    ? currentOI - previousOI
    : Number(candle?.oi_delta) || 0;
  const oiReference = previousOI > 0 ? previousOI : currentOI;
  const oiBias = oiReference > 0
    ? clampBias(oiDelta, Math.max(oiReference * 0.00025, 1))
    : 0;

  const flowState = flowBias > 0 ? `${flowLabel} up` : flowBias < 0 ? `${flowLabel} down` : `${flowLabel} flat`;
  const oiState = oiBias > 0 ? "OI up" : oiBias < 0 ? "OI down" : "OI flat";

  if (priceBias > 0 && flowBias > 0 && oiBias > 0) {
    return {
      headline: "Fresh longs drove the move",
      detail: `Price rose with ${flowLabel.toLowerCase()} and open interest rising, which usually points to new long positioning instead of simple short covering.`,
      shortDetail: "Flow and OI rose together, which looks more like fresh long participation.",
      chips: [`${flowLabel} up`, "OI up", "New longs"],
      score: 3,
      row: `${flowState}, ${oiState}`,
    };
  }

  if (priceBias > 0 && flowBias > 0 && oiBias < 0) {
    return {
      headline: "Short covering is lifting price",
      detail: `Price rose with supportive ${flowLabel.toLowerCase()}, but open interest fell. That usually means shorts are closing rather than new longs building aggressively.`,
      shortDetail: "Price is rising on covering, which can fade faster than fresh long initiation.",
      chips: [`${flowLabel} up`, "OI down", "Short covering"],
      score: 2,
      row: `${flowState}, ${oiState}`,
    };
  }

  if (priceBias < 0 && flowBias < 0 && oiBias > 0) {
    return {
      headline: "Fresh shorts pressed the move",
      detail: `Price fell with ${flowLabel.toLowerCase()} and open interest rising, which usually points to new short positioning adding pressure.`,
      shortDetail: "Flow and OI both point to fresh short participation.",
      chips: [`${flowLabel} down`, "OI up", "New shorts"],
      score: -3,
      row: `${flowState}, ${oiState}`,
    };
  }

  if (priceBias < 0 && flowBias < 0 && oiBias < 0) {
    return {
      headline: "Long liquidation is driving the drop",
      detail: `Price fell with negative ${flowLabel.toLowerCase()}, but open interest also dropped. That usually looks more like longs bailing out than aggressive new shorts building.`,
      shortDetail: "The drop looks liquidation-led rather than fresh short initiative.",
      chips: [`${flowLabel} down`, "OI down", "Long liquidation"],
      score: -2,
      row: `${flowState}, ${oiState}`,
    };
  }

  if (priceBias > 0 && flowBias < 0) {
    return {
      headline: "Price rose on weak underlying flow",
      detail: `Price pushed higher while ${flowLabel.toLowerCase()} faded. That often means passive sellers are absorbing the move or late buyers are chasing into a weaker auction.`,
      shortDetail: "Price is higher, but the underlying flow is not confirming it.",
      chips: [`${flowLabel} down`, "Flow divergence"],
      score: -2,
      row: `${flowState}, ${oiState}`,
    };
  }

  if (priceBias < 0 && flowBias > 0) {
    return {
      headline: "Selling pushed price lower, but flow held up",
      detail: `Price dropped while ${flowLabel.toLowerCase()} improved. That often shows seller exhaustion or buyers absorbing the move underneath.`,
      shortDetail: "Price is lower, but the underlying flow is holding up better than price.",
      chips: [`${flowLabel} up`, "Flow divergence"],
      score: 2,
      row: `${flowState}, ${oiState}`,
    };
  }

  if (flowBias > 0 && oiBias > 0) {
    return {
      headline: "Buyers are active, but price has not expanded yet",
      detail: `${flowLabel} and open interest both improved, so there is still constructive participation under this bar even though price has not cleanly expanded yet.`,
      shortDetail: "Buy-side flow is active under the surface.",
      chips: [`${flowLabel} up`, "OI up"],
      score: 1,
      row: `${flowState}, ${oiState}`,
    };
  }

  if (flowBias < 0 && oiBias > 0) {
    return {
      headline: "Sellers are active, but the move is not clean yet",
      detail: `${flowLabel} weakened and open interest rose, so sellers are participating, but price still needs cleaner follow-through to confirm control.`,
      shortDetail: "Sell-side participation is building, but price still needs confirmation.",
      chips: [`${flowLabel} down`, "OI up"],
      score: -1,
      row: `${flowState}, ${oiState}`,
    };
  }

  if (priceBias !== 0 || flowBias !== 0 || oiBias !== 0) {
    return {
      headline: "Participation is mixed",
      detail: `${flowState} while ${oiState}. This bar has activity, but the participation mix is not clean enough to call it a high-conviction initiative move.`,
      shortDetail: `${flowState} while ${oiState}.`,
      chips: [flowState, oiState],
      score: 0,
      row: `${flowState}, ${oiState}`,
    };
  }

  return null;
}

function summarizeLiquidity(candle) {
  const bids = Array.isArray(candle?.bids) ? candle.bids : [];
  const asks = Array.isArray(candle?.asks) ? candle.asks : [];
  if (!bids.length && !asks.length) return null;

  const bidTotal = sumBookSize(bids);
  const askTotal = sumBookSize(asks);
  const largestBid = findLargestLevel(bids);
  const largestAsk = findLargestLevel(asks);
  const close = Number(candle?.close) || Number(candle?.best_bid) || Number(candle?.best_ask) || 0;
  const rowSize = Math.max(Number(candle?.row_size) || Math.abs((Number(candle?.best_ask) || 0) - (Number(candle?.best_bid) || 0)) || 0.1, 0.1);

  const bidToAskRatio = askTotal > 0 ? bidTotal / askTotal : bidTotal > 0 ? Infinity : 1;
  const bidDistanceTicks = largestBid ? (close - largestBid.price) / rowSize : Infinity;
  const askDistanceTicks = largestAsk ? (largestAsk.price - close) / rowSize : Infinity;
  const nearBidWall = largestBid && bidDistanceTicks >= -1 && bidDistanceTicks <= 10 && largestBid.size >= bidTotal * 0.28;
  const nearAskWall = largestAsk && askDistanceTicks >= -1 && askDistanceTicks <= 10 && largestAsk.size >= askTotal * 0.28;

  if (bidToAskRatio >= 1.35 && nearBidWall) {
    const price = formatLevelPrice(largestBid.price, rowSize);
    return {
      headline: "Bid support sits just below price",
      detail: `Visible bid liquidity is heavier than the ask side and the biggest bid wall is parked near ${price}. That can support price until it is pulled or cleanly traded through.`,
      shortDetail: "Visible bid liquidity is stacked below price.",
      chips: ["Bid support"],
      bias: 1,
      row: "Bid liquidity is heavier below price",
    };
  }

  if (bidToAskRatio <= 0.74 && nearAskWall) {
    const price = formatLevelPrice(largestAsk.price, rowSize);
    return {
      headline: "Ask liquidity is capping the move overhead",
      detail: `Visible ask liquidity outweighs the bid side and the biggest offer sits near ${price}. That can cap price until buyers chew through it or the wall gets pulled.`,
      shortDetail: "A visible offer wall sits just above price.",
      chips: ["Ask wall"],
      bias: -1,
      row: "Ask liquidity is heavier above price",
    };
  }

  if (bidToAskRatio >= 1.35) {
    return {
      headline: "The visible book leans bid",
      detail: "Visible resting liquidity is heavier on the bid side, which gives buyers a nearby support edge, but the wall is not concentrated right on top of price yet.",
      shortDetail: "The visible book leans bid.",
      chips: ["Book bid-heavy"],
      bias: 1,
      row: "Visible book leans bid",
    };
  }

  if (bidToAskRatio <= 0.74) {
    return {
      headline: "The visible book leans ask",
      detail: "Visible resting liquidity is heavier on the ask side, which gives sellers an overhead resistance edge, but the wall is not concentrated right on top of price yet.",
      shortDetail: "The visible book leans ask.",
      chips: ["Book ask-heavy"],
      bias: -1,
      row: "Visible book leans ask",
    };
  }

  return {
    headline: "The visible book is balanced",
    detail: "Visible bid and ask liquidity are fairly even here, so the next move depends more on trades hitting the tape than on a strong resting-liquidity skew.",
    shortDetail: "Visible bid and ask liquidity are fairly balanced.",
    chips: [],
    bias: 0,
    row: "Visible book is balanced",
  };
}

function describeDataQuality(candle, reliable) {
  const hasOI = (Number(candle?.oi) || 0) > 0;
  const hasBook = (candle?.bids?.length || 0) > 0 || (candle?.asks?.length || 0) > 0;

  if (reliable) {
    if (hasOI && hasBook) {
      return "Live footprint from raw trades, live OI, and a visible orderbook snapshot.";
    }
    if (hasOI) {
      return "Live footprint from raw trades with live OI, but limited visible book context on this bar.";
    }
    return "Live footprint from raw trades. OI has not populated yet on this bar.";
  }

  if (hasOI) {
    return "History uses OHLC plus Bybit open-interest backfill. CVD, absorption, and imbalance are not reconstructed here.";
  }
  return "History-only bar. Wait for live capture or replay for full orderflow context.";
}

export function buildOrderflowReading(candle, previousCandle) {
  if (!candle) {
    return {
      tone: "neutral",
      headline: "No candle selected",
      detail: "Hover a footprint bar or wait for live flow to read absorption, participation, and liquidity.",
      chips: [],
      rows: [],
      score: 0,
    };
  }

  const reliable = isReliableOrderflow(candle);
  const imbalance = reliable ? summarizeCandleImbalance(candle) : null;
  const participation = summarizeParticipation(candle, previousCandle, reliable);
  const liquidity = summarizeLiquidity(candle);
  const dataQuality = describeDataQuality(candle, reliable);
  const rows = [];
  const chips = [];

  if (participation?.row) {
    rows.push({ label: "Flow", value: participation.row });
  }
  if (liquidity?.row) {
    rows.push({ label: "Liquidity", value: liquidity.row });
  }
  rows.push({ label: "Data", value: dataQuality });

  if (!reliable) {
    if (participation?.chips) {
      participation.chips.forEach((chip) => pushUnique(chips, chip));
    }
    if (liquidity?.chips) {
      liquidity.chips.forEach((chip) => pushUnique(chips, chip));
    }
    pushUnique(chips, (Number(candle?.oi) || 0) > 0 ? "History OI" : "History only");

    return {
      tone: "muted",
      headline: participation?.headline || "Backfilled bar",
      detail: appendSentence(
        participation?.detail || "This bar is historical backfill, so CVD, absorption, and imbalance reads are not fully available here.",
        liquidity?.shortDetail,
      ),
      chips: chips.slice(0, 5),
      rows: rows.slice(0, 3),
      score: participation?.score || 0,
    };
  }

  let bullScore = 0;
  let bearScore = 0;
  let headline = "Balanced orderflow";
  let detail = "No standout orderflow edge on this bar. Use location and follow-through for context.";

  if (candle.absorption_low) {
    bullScore += 4;
    pushUnique(chips, "Buyer absorption");
    headline = "Buyer absorption at the low";
    detail = "Heavy sells hit the bid but price held. Passive buyers likely defended this area.";
  }

  if (candle.absorption_high) {
    bearScore += 4;
    pushUnique(chips, "Seller absorption");
    if (bearScore >= bullScore) {
      headline = "Seller absorption at the high";
      detail = "Heavy buys lifted the offer but price stalled. Passive sellers likely capped this area.";
    }
  }

  if (imbalance?.side === "buy") {
    bullScore += imbalance.stacked ? 3 : 2;
    pushUnique(chips, imbalance.stacked ? "Stacked buy imbalance" : "Buy imbalance");
    if (!candle.absorption_low && bullScore >= bearScore) {
      headline = imbalance.stacked ? "Initiative buying stepped in" : "Buyers won the cluster battle";
      detail = imbalance.stacked
        ? "Multiple adjacent ask-side imbalances show aggressive buyers pressing through nearby prices."
        : "Ask-side volume dominated the bar, which points to aggressive buyers.";
    }
  }

  if (imbalance?.side === "sell") {
    bearScore += imbalance.stacked ? 3 : 2;
    pushUnique(chips, imbalance.stacked ? "Stacked sell imbalance" : "Sell imbalance");
    if (!candle.absorption_high && bearScore > bullScore) {
      headline = imbalance.stacked ? "Initiative selling stepped in" : "Sellers won the cluster battle";
      detail = imbalance.stacked
        ? "Multiple adjacent bid-side imbalances show aggressive sellers pressing through nearby prices."
        : "Bid-side volume dominated the bar, which points to aggressive sellers.";
    }
  }

  if (candle.exhaustion_low) {
    bullScore += 2;
    pushUnique(chips, "Seller exhaustion");
    if (bullScore >= bearScore && !candle.absorption_low) {
      headline = "Sellers look exhausted near the low";
      detail = "Price pushed lower but the selling effort dried up, which can support a bounce if context agrees.";
    }
  }

  if (candle.exhaustion_high) {
    bearScore += 2;
    pushUnique(chips, "Buyer exhaustion");
    if (bearScore > bullScore && !candle.absorption_high) {
      headline = "Buyers look exhausted near the high";
      detail = "Price pushed higher but the buying effort faded, which can support a rejection if context agrees.";
    }
  }

  if (candle.delta_divergence_bull) {
    bullScore += 2;
    pushUnique(chips, "Bullish divergence");
    if (bullScore >= bearScore && !candle.absorption_low && !candle.exhaustion_low) {
      headline = "Bullish delta divergence";
      detail = "Price closed weakly, but the orderflow underneath was stronger than price suggests.";
    }
  }

  if (candle.delta_divergence_bear) {
    bearScore += 2;
    pushUnique(chips, "Bearish divergence");
    if (bearScore > bullScore && !candle.absorption_high && !candle.exhaustion_high) {
      headline = "Bearish delta divergence";
      detail = "Price closed strongly, but the orderflow underneath was weaker than price suggests.";
    }
  }

  if (candle.sweep_buy) {
    bullScore += 2;
    pushUnique(chips, "Buy sweep");
  }

  if (candle.sweep_sell) {
    bearScore += 2;
    pushUnique(chips, "Sell sweep");
  }

  if (candle.unfinished_low) {
    pushUnique(chips, "Unfinished low");
  }

  if (candle.unfinished_high) {
    pushUnique(chips, "Unfinished high");
  }

  if (Math.abs((Number(candle.candle_delta) || 0)) > 0) {
    if ((Number(candle.candle_delta) || 0) > 0) {
      bullScore += 1;
    } else {
      bearScore += 1;
    }
  }

  if (participation) {
    if (participation.score > 0) {
      bullScore += participation.score;
    } else if (participation.score < 0) {
      bearScore += Math.abs(participation.score);
    }

    participation.chips.forEach((chip) => pushUnique(chips, chip));

    const barHasStructuralSignal = Boolean(
      candle.absorption_low
      || candle.absorption_high
      || candle.exhaustion_low
      || candle.exhaustion_high
      || candle.delta_divergence_bull
      || candle.delta_divergence_bear,
    );

    if (!barHasStructuralSignal || Math.abs(participation.score) >= Math.max(bullScore, bearScore) / 2) {
      headline = participation.headline;
      detail = participation.detail;
    } else {
      detail = appendSentence(detail, participation.shortDetail);
    }
  }

  if (liquidity) {
    if (liquidity.bias > 0) bullScore += 1;
    if (liquidity.bias < 0) bearScore += 1;
    liquidity.chips.forEach((chip) => pushUnique(chips, chip));

    if (!participation && Math.abs(bullScore - bearScore) <= 1 && Math.abs(liquidity.bias) > 0) {
      headline = liquidity.headline;
      detail = liquidity.detail;
    } else if (liquidity.shortDetail && !detail.includes(liquidity.shortDetail)) {
      detail = appendSentence(detail, liquidity.shortDetail);
    }
  }

  const score = bullScore - bearScore;
  const tone = score > 1 ? "bullish" : score < -1 ? "bearish" : "neutral";

  if (tone === "neutral" && chips.length === 0) {
    chips.push("No standout signal");
  }

  return {
    tone,
    headline,
    detail,
    chips: chips.slice(0, 6),
    rows: rows.slice(0, 3),
    score,
  };
}
