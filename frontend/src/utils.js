import { useMemo } from "react";

/**
 * Formats a number to a fixed decimal string, stripping trailing zeroes.
 */
export function fmt(n, decimals = 4) {
  if (n == null) return "—";
  return Number(n).toFixed(decimals).replace(/\.?0+$/, "");
}

/**
 * Formats a millisecond timestamp into HH:MM.
 */
export function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Returns a color for a delta value: green for positive, red for negative.
 */
export function deltaColor(delta) {
  if (delta > 0) return "var(--green)";
  if (delta < 0) return "var(--red)";
  return "var(--text-muted)";
}

/**
 * Returns the max totalVol across all clusters – used for bar width scaling.
 */
export function useMaxVol(clusters) {
  return useMemo(() => {
    if (!clusters || clusters.length === 0) return 1;
    return Math.max(...clusters.map((c) => c.totalVol), 0.001);
  }, [clusters]);
}
