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
        strongest = { value, side: "ask" };
      }
    }

    if (cluster.imbalance_sell) {
      count += 1;
      stacked = stacked || Boolean(cluster.stacked_sell);
      const value = Number(cluster.sellVol) || 0;
      if (!strongest || value > strongest.value) {
        strongest = { value, side: "bid" };
      }
    }
  }

  return strongest ? { ...strongest, count, stacked } : null;
}

export function candleHasImbalance(candle) {
  return Boolean(summarizeCandleImbalance(candle));
}
