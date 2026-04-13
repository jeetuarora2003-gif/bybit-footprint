import { formatCompactValue, formatPrice as formatChartPrice } from "../../utils/exoFormat";
import { buildProfileLevels } from "../../utils/marketContext";
import {
  BG,
  BUY,
  CROSSHAIR,
  DOM_MAX_W,
  DOM_PRICE_COL_W,
  DOM_SIDE_W,
  GRID_COLOR,
  GREEN,
  POC_COLOR,
  PRICE_LABEL_BG,
  PROFILE_COLOR,
  PROFILE_MAX_W,
  PROFILE_POC,
  RED,
  TIME_AXIS_H,
  TEXT_BRIGHT,
  TEXT_COLOR,
  clamp,
  frameDurationMs,
  frameOpenTimeForTimeframe,
} from "./shared";

export function applyVWAP(candles, settings = {}) {
  let cumPV = 0;
  let cumVol = 0;
  let lastKey = "";

  for (const candle of candles) {
    const key = resolveVWAPKey(candle.candle_open_time, settings.vwapMode, settings.sessionMode);
    if (key !== lastKey) {
      cumPV = 0;
      cumVol = 0;
      lastKey = key;
    }
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.total_volume || 0;
    cumPV += typicalPrice * volume;
    cumVol += volume;
    candle.vwap = cumVol > 0 ? cumPV / cumVol : null;
  }
}

function resolveVWAPKey(timestamp, vwapMode, sessionMode) {
  const date = new Date(timestamp);
  if (vwapMode === "composite") return "composite";
  if (vwapMode === "daily") {
    return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
  }
  if (sessionMode === "asia") return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-asia`;
  if (sessionMode === "london") return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-london`;
  if (sessionMode === "newyork") return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-newyork`;
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

export function drawGrid(ctx, chartW, pMin, pMax, pStep, p2y) {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let price = Math.ceil(pMin / pStep) * pStep; price <= pMax; price += pStep) {
    const y = Math.round(p2y(price)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartW, y);
    ctx.stroke();
  }
}

export function drawPriceAxis(ctx, chartW, chartH, axisW, pMin, pMax, pStep, p2y, visible, modeFlags, symbol = "BTCUSD") {
  ctx.fillStyle = "#0c0f15";
  ctx.fillRect(chartW, 0, axisW, chartH);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartW, 0);
  ctx.lineTo(chartW, chartH);
  ctx.stroke();

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `${modeFlags?.axisFontSize ?? 10}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let price = Math.ceil(pMin / pStep) * pStep; price <= pMax; price += pStep) {
    const y = p2y(price);
    if (y > 8 && y < chartH - 8) {
      ctx.beginPath();
      ctx.moveTo(chartW, y + 0.5);
      ctx.lineTo(chartW + 5, y + 0.5);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.stroke();
      ctx.fillText(formatChartPrice(price), chartW + axisW - 8, y);
    }
  }

  if (visible.length === 0) return;

  const last = visible.at(-1);
  const y = p2y(last.close);
  const color = last.close >= last.open ? GREEN : RED;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(chartW, y);
  ctx.stroke();
  if ((modeFlags?.currentPriceLabel ?? "split") === "split") {
    ctx.font = "bold 11px 'JetBrains Mono', monospace";
    const symbolW = Math.max(46, Math.min(axisW - 22, ctx.measureText(symbol).width + 14));
    ctx.fillStyle = "rgba(10,14,20,0.96)";
    ctx.fillRect(chartW, y - 10, symbolW, 20);
    ctx.fillStyle = color;
    ctx.fillRect(chartW + symbolW, y - 10, axisW - symbolW, 20);
    ctx.fillStyle = color;
    ctx.font = "bold 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(symbol, chartW + symbolW / 2, y);
    ctx.fillStyle = "#0b0e14";
    ctx.fillText(formatChartPrice(last.close), chartW + symbolW + (axisW - symbolW) / 2, y);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(chartW, y - 9, axisW, 18);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(formatChartPrice(last.close), chartW + axisW / 2, y);
  }
}

export function drawTimeAxis(ctx, visible, startIdx, chartW, chartH, state, i2x, axisW, modeFlags) {
  ctx.fillStyle = "#0c0f15";
  ctx.fillRect(0, chartH, chartW + axisW, TIME_AXIS_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, chartH);
  ctx.lineTo(chartW + axisW, chartH);
  ctx.stroke();

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `${modeFlags?.timeAxisFontSize ?? 9}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const step = Math.max(1, Math.floor(90 / state.candleW));
  for (let vi = 0; vi < visible.length; vi += step) {
    const x = i2x(startIdx + vi);
    if (x <= 30 || x >= chartW - 30) continue;
    const date = new Date(visible[vi].candle_open_time);
    ctx.fillText(
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      x,
      chartH + TIME_AXIS_H / 2,
    );
  }
}

export function drawCrosshair(ctx, state, chartW, chartH, pMin, priceRange, axisW) {
  const { mouse } = state;
  if (mouse.x <= 0 || mouse.x >= chartW || mouse.y <= 0 || mouse.y >= chartH) return;

  ctx.strokeStyle = CROSSHAIR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(mouse.x, 0);
  ctx.lineTo(mouse.x, chartH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, mouse.y);
  ctx.lineTo(chartW, mouse.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const hoveredPrice = pMin + (1 - mouse.y / chartH) * priceRange;
  ctx.fillStyle = PRICE_LABEL_BG;
  ctx.fillRect(chartW, mouse.y - 9, axisW, 18);
  ctx.fillStyle = "#fff";
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatChartPrice(hoveredPrice), chartW + axisW / 2, mouse.y);
}

export function drawProfileStudy(ctx, sourceCandles, chartH, p2y, rowSize, valueAreaPercent = 70, showPOC = true, showVA = true) {
  const profile = new Map();
  for (const candle of sourceCandles) {
    const clusters = candle.clusters || [];
    if (clusters.length > 0) {
      for (const cluster of clusters) {
        profile.set(cluster.price, (profile.get(cluster.price) || 0) + (cluster.totalVol || 0));
      }
      continue;
    }
    const fallbackPrice = Math.floor((Number(candle.close) || 0) / rowSize) * rowSize;
    if (fallbackPrice > 0 && (candle.total_volume || 0) > 0) {
      profile.set(fallbackPrice, (profile.get(fallbackPrice) || 0) + (candle.total_volume || 0));
    }
  }

  if (profile.size === 0) return;

  let maxVol = 0;
  let pocPrice = 0;
  for (const [price, volume] of profile.entries()) {
    if (volume > maxVol) {
      maxVol = volume;
      pocPrice = price;
    }
  }
  if (maxVol <= 0) return;

  for (const [price, volume] of profile.entries()) {
    const yTop = p2y(price + rowSize);
    const yBottom = p2y(price);
    const rowH = Math.abs(yBottom - yTop);
    const rowTop = Math.min(yTop, yBottom);
    const width = (volume / maxVol) * PROFILE_MAX_W;
    ctx.fillStyle = price === pocPrice ? PROFILE_POC : PROFILE_COLOR;
    ctx.fillRect(0, rowTop, width, Math.max(1, rowH - 0.5));
  }

  const stats = buildProfileLevels(sourceCandles, rowSize, valueAreaPercent);
  if (!stats) return;

  if (showVA) {
    drawHorizontalLevel(ctx, stats.vah, p2y, chartH, "rgba(38,166,154,0.55)");
    drawHorizontalLevel(ctx, stats.val, p2y, chartH, "rgba(38,166,154,0.55)");
  }
  if (showPOC) {
    drawHorizontalLevel(ctx, stats.poc, p2y, chartH, "rgba(239,83,80,0.75)");
  }
}

export function selectProfileSource(allCandles, visible, profileStudy) {
  if (!visible?.length) return [];
  if (profileStudy === "composite") {
    return allCandles;
  }
  if (profileStudy === "session") {
    const lastVisible = visible.at(-1);
    const lastDate = new Date(lastVisible.candle_open_time);
    return allCandles.filter((candle) => {
      const date = new Date(candle.candle_open_time);
      return date.getUTCFullYear() === lastDate.getUTCFullYear()
        && date.getUTCMonth() === lastDate.getUTCMonth()
        && date.getUTCDate() === lastDate.getUTCDate();
    });
  }
  return visible;
}

export function drawLiquidityHeatmap(ctx, visible, startIdx, i2x, p2y, candleW, fallbackRowSize, chartH, maxLadderSize) {
  if (!maxLadderSize || maxLadderSize <= 0) return;

  for (let index = 0; index < visible.length; index += 1) {
    const candle = visible[index];
    const centerX = i2x(startIdx + index);
    const left = centerX - candleW / 2;
    const width = Math.max(2, candleW - 2);
    const rowSize = Number(candle.row_size) || fallbackRowSize;

    drawHeatmapSide(ctx, candle.bids || [], maxLadderSize, left, width, p2y, rowSize, chartH, false);
    drawHeatmapSide(ctx, candle.asks || [], maxLadderSize, left, width, p2y, rowSize, chartH, true);
  }
}

function drawHeatmapSide(ctx, levels, maxLadderSize, left, width, p2y, rowSize, chartH, isAsk) {
  for (const level of levels) {
    const rowTopY = p2y(level.price + rowSize);
    const rowBottomY = p2y(level.price);
    const rowTop = Math.min(rowTopY, rowBottomY);
    const rowH = Math.max(1, Math.abs(rowBottomY - rowTopY) - 0.5);
    if (rowTop > chartH || rowTop + rowH < 0) continue;

    const intensity = Math.min((level.size || 0) / maxLadderSize, 1);
    const alpha = 0.03 + intensity * 0.22;
    ctx.fillStyle = isAsk ? `rgba(239,83,80,${alpha})` : `rgba(66,165,245,${alpha})`;
    ctx.fillRect(left + 1, rowTop, width, rowH);

    if (intensity >= 0.75) {
      ctx.strokeStyle = isAsk ? "rgba(239,83,80,0.22)" : "rgba(66,165,245,0.22)";
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 1.5, rowTop + 0.5, Math.max(1, width - 1), Math.max(1, rowH - 1));
    }
  }
}

export function drawDepthHistoryHeatmap(ctx, depthHistory, visible, startIdx, i2x, p2y, candleW, chartH, timeframe, fallbackRowSize) {
  if (!depthHistory?.length || !visible?.length) return;

  const firstVisible = visible[0];
  const lastVisible = visible.at(-1);
  const visibleStart = Number(firstVisible?.candle_open_time) || 0;
  const lastOpen = Number(lastVisible?.candle_open_time) || visibleStart;
  const visibleEnd = lastOpen + frameDurationMs(timeframe, lastOpen);
  const candleIndexByOpen = new Map();
  visible.forEach((candle, index) => {
    candleIndexByOpen.set(Number(candle.candle_open_time), startIdx + index);
  });

  const relevant = depthHistory.filter((snapshot) => {
    const ts = Number(snapshot.timestamp) || 0;
    return ts >= visibleStart && ts < visibleEnd;
  });
  if (relevant.length === 0) return;

  let maxDepthSize = 0;
  for (const snapshot of relevant) {
    for (const bid of snapshot.bids || []) maxDepthSize = Math.max(maxDepthSize, Number(bid.size) || 0);
    for (const ask of snapshot.asks || []) maxDepthSize = Math.max(maxDepthSize, Number(ask.size) || 0);
  }
  if (maxDepthSize <= 0) return;

  for (const snapshot of relevant) {
    const frameOpen = frameOpenTimeForTimeframe(Number(snapshot.timestamp), timeframe);
    const candleIndex = candleIndexByOpen.get(frameOpen);
    if (candleIndex == null) continue;

    const frameMs = frameDurationMs(timeframe, frameOpen);
    const progress = clamp((Number(snapshot.timestamp) - frameOpen) / frameMs, 0, 0.999);
    const candleCenter = i2x(candleIndex);
    const columnWidth = Math.max(1, Math.min(3, candleW / 14));
    const left = candleCenter - candleW / 2 + progress * candleW;
    const rowSize = Number(snapshot.row_size) || fallbackRowSize;

    drawSnapshotHeatColumn(ctx, snapshot.bids || [], maxDepthSize, left, columnWidth, p2y, rowSize, chartH, false);
    drawSnapshotHeatColumn(ctx, snapshot.asks || [], maxDepthSize, left, columnWidth, p2y, rowSize, chartH, true);
  }
}

function drawSnapshotHeatColumn(ctx, levels, maxDepthSize, left, width, p2y, rowSize, chartH, isAsk) {
  for (const level of levels) {
    const rowTopY = p2y(level.price + rowSize);
    const rowBottomY = p2y(level.price);
    const rowTop = Math.min(rowTopY, rowBottomY);
    const rowH = Math.max(1, Math.abs(rowBottomY - rowTopY) - 0.5);
    if (rowTop > chartH || rowTop + rowH < 0) continue;

    const intensity = Math.min((Number(level.size) || 0) / maxDepthSize, 1);
    const alpha = 0.035 + intensity * 0.24;
    ctx.fillStyle = isAsk ? `rgba(239,83,80,${alpha})` : `rgba(66,165,245,${alpha})`;
    ctx.fillRect(left, rowTop, width, rowH);
  }
}

export function drawDOM(ctx, candle, chartW, chartH, p2y, rowSize) {
  const bids = candle.bids || [];
  const asks = candle.asks || [];
  let maxSize = 0;
  for (const bid of bids) if (bid.size > maxSize) maxSize = bid.size;
  for (const ask of asks) if (ask.size > maxSize) maxSize = ask.size;
  if (maxSize === 0) return;

  const domRowSize = Number(candle.row_size) || rowSize;
  const rowH = Math.max(Math.abs(p2y(0) - p2y(domRowSize)) - 0.5, 2);
  const domLeft = chartW - DOM_MAX_W;
  const bidRight = domLeft + DOM_SIDE_W;
  const priceLeft = bidRight;
  const askLeft = priceLeft + DOM_PRICE_COL_W;

  ctx.fillStyle = "rgba(12,15,21,0.60)";
  ctx.fillRect(domLeft, 0, DOM_MAX_W, chartH);
  ctx.fillStyle = "rgba(7,10,15,0.88)";
  ctx.fillRect(priceLeft, 0, DOM_PRICE_COL_W, chartH);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(domLeft, 0);
  ctx.lineTo(domLeft, chartH);
  ctx.moveTo(priceLeft, 0);
  ctx.lineTo(priceLeft, chartH);
  ctx.moveTo(askLeft, 0);
  ctx.lineTo(askLeft, chartH);
  ctx.stroke();

  drawDOMPriceColumn(ctx, bids, asks, candle, priceLeft, chartH, p2y, rowH, domRowSize);
  drawDOMSide(ctx, bids, maxSize, domLeft, bidRight, chartH, p2y, rowH, domRowSize, BUY, false);
  drawDOMSide(ctx, asks, maxSize, askLeft, chartW, chartH, p2y, rowH, domRowSize, RED, true);
}

function drawDOMPriceColumn(ctx, bids, asks, candle, priceLeft, chartH, p2y, rowH, rowSize) {
  const prices = new Set();
  bids.forEach((level) => prices.add(level.price));
  asks.forEach((level) => prices.add(level.price));

  const sortedPrices = [...prices].sort((a, b) => b - a);
  for (const price of sortedPrices) {
    const y = p2y(price + rowSize / 2);
    if (y < -rowH || y > chartH + rowH) continue;

    const isBestBid = price === candle.best_bid;
    const isBestAsk = price === candle.best_ask;
    const isTradePrice = Math.abs(price - candle.close) < rowSize / 2;

    if (isTradePrice) {
      ctx.fillStyle = "rgba(37,99,235,0.16)";
      ctx.fillRect(priceLeft + 1, y - rowH / 2, DOM_PRICE_COL_W - 2, rowH);
    } else if (isBestBid || isBestAsk) {
      ctx.fillStyle = isBestBid ? "rgba(66,165,245,0.12)" : "rgba(239,83,80,0.12)";
      ctx.fillRect(priceLeft + 1, y - rowH / 2, DOM_PRICE_COL_W - 2, rowH);
    }

    ctx.fillStyle = isTradePrice ? "#ffffff" : TEXT_BRIGHT;
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(formatChartPrice(price), priceLeft + DOM_PRICE_COL_W / 2, y);
  }
}

function drawDOMSide(ctx, levels, maxSize, colLeft, colRight, chartH, p2y, rowH, rowSize, color, isAsk) {
  for (const level of levels) {
    const y = p2y(level.price + rowSize / 2);
    if (y < 0 || y > chartH) continue;
    const columnWidth = colRight - colLeft - 6;
    const width = (level.size / maxSize) * columnWidth;
    ctx.fillStyle = isAsk ? "rgba(239,83,80,0.20)" : "rgba(66,165,245,0.20)";
    const x = isAsk ? colLeft + 3 : colRight - width - 3;
    ctx.fillRect(x, y - rowH / 2, width, rowH);
    ctx.fillStyle = color;
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = isAsk ? "left" : "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatCompactValue(level.size), isAsk ? colLeft + 4 : colRight - 4, y);
  }
}

export function drawVWAP(ctx, visible, startIdx, p2y, i2x) {
  ctx.strokeStyle = "#ffca28";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let index = 0; index < visible.length; index += 1) {
    const candle = visible[index];
    if (candle.vwap == null) continue;
    const x = i2x(startIdx + index);
    const y = p2y(candle.vwap);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (started) ctx.stroke();
}

function drawHorizontalLevel(ctx, price, p2y, chartH, color) {
  const y = p2y(price);
  if (y < 0 || y > chartH) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(ctx.canvas.clientWidth || ctx.canvas.width, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawSetupAnnotations(ctx, annotations, visible, startIdx, i2x, p2y, chartW, chartH, rowSize) {
  if (!annotations?.length || !visible?.length) return;
  const indexByOpenTime = new Map();
  visible.forEach((candle, index) => {
    indexByOpenTime.set(Number(candle?.candle_open_time), startIdx + index);
  });

  for (const annotation of annotations) {
    const candleIndex = indexByOpenTime.get(Number(annotation?.candle_open_time));
    if (candleIndex == null) continue;

    const x = i2x(candleIndex);
    if (x < 0 || x > chartW) continue;
    const basePrice = Number(annotation?.price) || 0;
    const y = p2y(basePrice + (annotation.direction === "short" ? rowSize * 2 : -rowSize * 2));
    const boxY = annotation.direction === "short" ? Math.max(4, y - 20) : Math.min(chartH - 20, y + 6);
    const label = `${annotation.gradeLabel.split(" ")[0]} ${annotation.label}`;
    ctx.font = "bold 10px 'JetBrains Mono', monospace";
    const textWidth = Math.min(190, ctx.measureText(label).width + 12);
    const boxX = clamp(x - textWidth / 2, 4, chartW - textWidth - 4);
    ctx.fillStyle = annotation.direction === "short" ? "rgba(239,83,80,0.88)" : "rgba(66,165,245,0.86)";
    ctx.fillRect(boxX, boxY, textWidth, 16);
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, boxX + textWidth / 2, boxY + 8);
  }
}

export function drawHoveredCandleHighlight(ctx, hoveredIndex, startIdx, chartW, chartH, candleW, i2x) {
  if (hoveredIndex < startIdx) return;
  const centerX = i2x(hoveredIndex);
  const left = centerX - candleW / 2;
  if (left > chartW || left + candleW < 0) return;

  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(left, 0, candleW, chartH);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, 0.5, Math.max(1, candleW - 1), Math.max(1, chartH - 1));
}

export function drawDetectorEvents(ctx, detectorEvents, chartW, chartH, p2y) {
  if (!detectorEvents?.length) return;

  ctx.save();
  ctx.font = "bold 10px 'JetBrains Mono', monospace";
  ctx.textBaseline = "middle";

  for (const event of detectorEvents) {
    const price = Number(event?.swept_level) || 0;
    if (price <= 0) continue;

    const y = p2y(price);
    if (y < 0 || y > chartH) continue;

    const isFailedSweepUp = event.type === "FAILED_SWEEP_UP";
    const baseColor = isFailedSweepUp ? RED : GREEN;
    const outcome = String(event?.outcome || "PENDING").toUpperCase();
    const strength = String(event?.strength || "MEDIUM").toUpperCase();
    const lineOpacity = outcome === "FAILED"
      ? 0.2
      : strength === "HIGH"
        ? 1
        : 0.6;

    ctx.strokeStyle = alphaColor(baseColor, lineOpacity);
    ctx.lineWidth = strength === "HIGH" ? 2 : 1.5;
    ctx.setLineDash(outcome === "PARTIAL" ? [8, 4] : []);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const label = `${isFailedSweepUp ? "FAILED SWEEP UP" : "FAILED SWEEP DOWN"} - ${strength}`;
    const labelPaddingX = 8;
    const labelWidth = Math.min(220, ctx.measureText(label).width + labelPaddingX * 2);
    const labelX = Math.max(6, chartW - labelWidth - 8);
    const labelY = clamp(y - 10, 6, chartH - 22);

    ctx.fillStyle = alphaColor("#0b1220", Math.max(0.72, lineOpacity));
    ctx.fillRect(labelX, labelY, labelWidth, 18);
    ctx.strokeStyle = alphaColor(baseColor, Math.min(1, lineOpacity + 0.1));
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX + 0.5, labelY + 0.5, labelWidth - 1, 17);

    ctx.fillStyle = alphaColor(TEXT_BRIGHT, Math.max(0.7, lineOpacity));
    ctx.textAlign = "left";
    ctx.fillText(label, labelX + labelPaddingX, labelY + 9);

    if (outcome === "SUCCESS") {
      ctx.fillStyle = alphaColor(baseColor, 1);
      ctx.textAlign = "center";
      ctx.fillText("✓", Math.max(12, labelX - 10), y);
    }
  }

  ctx.restore();
}

function alphaColor(hex, alpha = 1) {
  const normalized = String(hex || "").replace("#", "");
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}
