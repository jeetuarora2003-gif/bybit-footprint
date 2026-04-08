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
