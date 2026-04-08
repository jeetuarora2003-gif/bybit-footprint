import { formatFootprintValue as formatFootprintCell } from "../../utils/exoFormat";

export const BG = "#0e1117";
export const GRID_COLOR = "rgba(255,255,255,0.04)";
export const TEXT_COLOR = "#8b95a5";
export const TEXT_BRIGHT = "#c8d0dc";
export const GREEN = "#26a69a";
export const RED = "#ef5350";
export const BUY = "#42a5f5";
export const GREEN_FILL = "rgba(38,166,154,0.25)";
export const RED_FILL = "rgba(239,83,80,0.25)";
export const BUY_FILL = "rgba(66,165,245,0.25)";
export const POC_COLOR = "#ef5350";
export const VA_COLOR = "rgba(38,166,154,0.08)";
export const CROSSHAIR = "rgba(255,255,255,0.18)";
export const PRICE_LABEL_BG = "#2563eb";
export const PROFILE_COLOR = "rgba(59,130,246,0.16)";
export const PROFILE_POC = "rgba(244,114,182,0.40)";
export const AUCTION_COLOR = "#facc15";

export const BASE_TICK_SIZE = 0.1;
export const PRICE_AXIS_W = 75;
export const TIME_AXIS_H = 26;
export const MIN_CANDLE_W = 6;
export const MAX_CANDLE_W = 200;
export const PROFILE_MAX_W = 80;
export const DOM_MAX_W = 156;
export const DOM_PRICE_COL_W = 46;
export const DOM_SIDE_W = (DOM_MAX_W - DOM_PRICE_COL_W) / 2;
export const CHART_TF_MS = {
  "1m": 60000,
  "2m": 120000,
  "3m": 180000,
  "5m": 300000,
  "10m": 600000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
  "2h": 7200000,
  "4h": 14400000,
  "6h": 21600000,
  "8h": 28800000,
  "12h": 43200000,
  D: 86400000,
  W: 604800000,
  M: 2592000000,
};

export function getRowSize(settings) {
  const multiplier = Number.parseFloat(settings?.tickSize);
  return BASE_TICK_SIZE * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
}

export function frameDurationMs(timeframe, frameOpen) {
  if (timeframe === "M") {
    const date = new Date(frameOpen);
    const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    return next - frameOpen;
  }
  return CHART_TF_MS[timeframe] ?? CHART_TF_MS["1m"];
}

export function frameOpenTimeForTimeframe(timestamp, timeframe) {
  const date = new Date(timestamp);

  if (timeframe === "D") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  if (timeframe === "W") {
    const day = date.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday);
  }

  if (timeframe === "M") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }

  const tfMs = frameDurationMs(timeframe, timestamp);
  return timestamp - (timestamp % tfMs);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function niceStep(range) {
  const r = range / 8;
  const magnitude = Math.pow(10, Math.floor(Math.log10(r)));
  const normalized = r / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export function fmtFootprintValue(value, options = {}) {
  return formatFootprintCell(value, options);
}

export function getClusterFontSize(rowH, candleW, text, dataView) {
  const minFont = 6;
  const maxFont = 11;
  if (!text) return maxFont;

  const charCount = Math.max(1, text.length);
  const widthBudget = dataView === "bidAsk" || dataView === "imbalance"
    ? (candleW / 2) - 8
    : candleW - 8;
  const widthLimited = widthBudget / (charCount * 0.62);
  const heightLimited = rowH - 1;
  return Math.min(maxFont, Math.max(minFont, Math.min(widthLimited, heightLimited)));
}

export function shouldRenderClusterText(dataView, rowH, candleW, clusterIndex, clusterCount) {
  if (dataView === "none") return false;
  if (dataView === "bidAsk" || dataView === "imbalance") {
    if (rowH < 9 || candleW < 38) return false;
  } else if (rowH < 7 || candleW < 28) {
    return false;
  }

  const stride = getClusterTextStride(rowH, candleW, dataView, clusterCount);
  return clusterIndex % stride === 0;
}

function getClusterTextStride(rowH, candleW, dataView, clusterCount) {
  if (dataView === "bidAsk" || dataView === "imbalance") {
    if (rowH < 12 || candleW < 52) return 3;
    if (rowH < 16 || candleW < 64) return 2;
  } else if (rowH < 10 || candleW < 42) {
    return 2;
  }

  if (clusterCount > 28 && rowH < 18) return 2;
  return 1;
}

export function clearHoverState(state) {
  state.hoveredCandle = null;
  state.hoveredIndex = null;
  state.hoveredPrice = null;
  state.hoveredCluster = null;
}

export function updateHoverState(state, candles, chartW, chartH, rightPad, priceRange, pMin, rowSize) {
  const mouseX = state.mouse.x;
  if (mouseX <= 0 || mouseX >= chartW || candles.length === 0) {
    clearHoverState(state);
    return;
  }

  const hoverIdx = Math.floor((state.offsetX + mouseX - rightPad) / state.candleW);
  const clampedIndex = Math.max(0, Math.min(candles.length - 1, hoverIdx));
  state.hoveredIndex = clampedIndex;
  state.hoveredCandle = candles[clampedIndex] || null;

  if (state.mouse.y > 0 && state.mouse.y < chartH) {
    state.hoveredPrice = pMin + (1 - state.mouse.y / chartH) * priceRange;
    state.hoveredCluster = findHoveredCluster(state.hoveredCandle, state.hoveredPrice, rowSize);
    return;
  }

  state.hoveredPrice = null;
  state.hoveredCluster = null;
}

function findHoveredCluster(candle, hoveredPrice, defaultRowSize) {
  if (!candle?.clusters?.length || hoveredPrice == null) return null;
  const rowSize = Number(candle.row_size) || defaultRowSize;
  const bucketPrice = Math.floor((hoveredPrice + Number.EPSILON) / rowSize) * rowSize;
  return candle.clusters.find((cluster) => Math.abs(cluster.price - bucketPrice) < rowSize / 10) ?? null;
}

export function zoomPriceRange(state, chartH, mouseY, zoomFactor) {
  const range = (state.priceMax - state.priceMin) || 1;
  const clampedY = clamp(mouseY, 0, chartH);
  const anchorRatio = 1 - (clampedY / chartH);
  const anchorPrice = state.priceMin + anchorRatio * range;
  const nextRange = range * zoomFactor;
  state.priceMin = anchorPrice - anchorRatio * nextRange;
  state.priceMax = anchorPrice + (1 - anchorRatio) * nextRange;
  state.autoScaleY = false;
}
