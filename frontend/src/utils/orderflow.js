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

export function buildOrderflowReading(candle) {
  if (!candle) {
    return {
      tone: "neutral",
      headline: "No candle selected",
      detail: "Hover a footprint bar or wait for live flow to read absorption, imbalance, and exhaustion.",
      chips: [],
      score: 0,
    };
  }

  const reliable = Number(candle.orderflow_coverage ?? 0) >= 0.999;
  if (!reliable) {
    return {
      tone: "muted",
      headline: "Backfilled bar",
      detail: "This candle is historical OHLC/OI backfill, so absorption and imbalance reads are not fully reliable.",
      chips: ["History only"],
      score: 0,
    };
  }

  const imbalance = summarizeCandleImbalance(candle);
  const chips = [];
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

  const score = bullScore - bearScore;
  const tone = score > 1 ? "bullish" : score < -1 ? "bearish" : "neutral";

  if (tone === "neutral" && chips.length === 0) {
    chips.push("No standout signal");
  }

  return {
    tone,
    headline,
    detail,
    chips: chips.slice(0, 5),
    score,
  };
}
