import { summarizeCandleImbalance } from "../../utils/orderflow";
import {
  AUCTION_COLOR,
  BG,
  BUY,
  BUY_FILL,
  GREEN,
  GREEN_FILL,
  POC_COLOR,
  RED,
  RED_FILL,
  TEXT_BRIGHT,
  VA_COLOR,
  fmtFootprintValue,
  getClusterFontSize,
  shouldRenderClusterText,
} from "./shared";

export function drawCandle(
  ctx,
  candle,
  centerX,
  bodyW,
  p2y,
  chartH,
  candleW,
  settings,
  gMaxV,
  gMaxD,
  rowSize,
  modeFlags,
) {
  const { open, high, low, close, clusters } = candle;
  const directionalValue = modeFlags.showDeltaBars ? (candle.candle_delta ?? 0) : close - open;
  const up = directionalValue >= 0;
  const color = up ? GREEN : RED;
  const style = settings.candleStyle;

  const yOpen = p2y(open);
  const yClose = p2y(close);
  const yHigh = p2y(high);
  const yLow = p2y(low);
  const yTop = Math.min(yOpen, yClose);
  const yBottom = Math.max(yOpen, yClose);
  const bodyH = Math.max(yBottom - yTop, 1);

  if (style !== "none") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, yHigh);
    ctx.lineTo(centerX, yLow);
    ctx.stroke();

    if (style === "ohlc") {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX - bodyW / 3, yOpen);
      ctx.lineTo(centerX, yOpen);
      ctx.moveTo(centerX, yClose);
      ctx.lineTo(centerX + bodyW / 3, yClose);
      ctx.stroke();
    } else if (style === "embed") {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(centerX - candleW / 2, yTop, candleW, bodyH);
      ctx.globalAlpha = 1;
    } else if (style === "borderedCandle") {
      ctx.fillStyle = BG;
      ctx.fillRect(centerX - bodyW / 2, yTop, bodyW, bodyH);
      ctx.strokeRect(centerX - bodyW / 2, yTop, bodyW, bodyH);
    } else if (style === "monoCandle" || style === "monoBox" || style === "flatCandle") {
      ctx.fillStyle = up ? "rgba(180,180,180,0.25)" : "rgba(180,180,180,0.12)";
      ctx.fillRect(centerX - bodyW / 2, yTop, bodyW, bodyH);
    } else if (style === "colorBox") {
      ctx.fillStyle = up ? GREEN_FILL : RED_FILL;
      ctx.fillRect(centerX - candleW / 2 + 1, yTop, candleW - 2, bodyH);
    } else if (style === "oc") {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, yOpen);
      ctx.lineTo(centerX, yClose);
      ctx.stroke();
    } else if (style !== "hl") {
      ctx.fillStyle = up ? GREEN_FILL : RED_FILL;
      ctx.fillRect(centerX - bodyW / 2, yTop, bodyW, bodyH);
      ctx.strokeRect(centerX - bodyW / 2, yTop, bodyW, bodyH);
    }
  }

  if (!clusters?.length || settings.clusterMode === "void") return;

  const candleRowSize = Number(candle.row_size) || rowSize;
  const maxV = settings.shadingMode === "adaptive"
    ? gMaxV
    : Math.max(0.001, ...clusters.map((cluster) => cluster.totalVol));
  const maxD = settings.shadingMode === "adaptive"
    ? gMaxD
    : Math.max(0.001, ...clusters.map((cluster) => Math.abs(cluster.delta)));

  let pocPrice = clusters[0]?.price ?? 0;
  let pocVol = 0;
  for (const cluster of clusters) {
    if (cluster.totalVol > pocVol) {
      pocVol = cluster.totalVol;
      pocPrice = cluster.price;
    }
  }

  const totalVol = clusters.reduce((sum, cluster) => sum + cluster.totalVol, 0);
  const vaTarget = totalVol * ((settings.vaPercent || 70) / 100);
  const sortedByVol = [...clusters].sort((a, b) => b.totalVol - a.totalVol);
  let vaAcc = 0;
  const vaSet = new Set();
  for (const cluster of sortedByVol) {
    vaAcc += cluster.totalVol;
    vaSet.add(cluster.price);
    if (vaAcc >= vaTarget) break;
  }

  const barMax = candleW * (modeFlags.minimalProfileMode ? 0.34 : 0.45);

  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
    const cluster = clusters[clusterIndex];
    const yRowTop = p2y(cluster.price + candleRowSize);
    const yRowBottom = p2y(cluster.price);
    const rowH = Math.abs(yRowBottom - yRowTop);
    const rowTop = Math.min(yRowTop, yRowBottom);
    if (rowTop > chartH || rowTop + rowH < 0) continue;

    if (modeFlags.showValueArea && vaSet.has(cluster.price)) {
      ctx.fillStyle = VA_COLOR;
      ctx.fillRect(centerX - candleW / 2, rowTop, candleW, rowH);
    }

    if (settings.clusterMode === "volumeProfile") {
      const f = cluster.totalVol / maxV;
      ctx.fillStyle = vaSet.has(cluster.price) ? "rgba(38,166,154,0.4)" : "rgba(100,110,130,0.3)";
      ctx.fillRect(centerX - f * barMax, rowTop, f * barMax * 2, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "deltaProfile") {
      const f = Math.abs(cluster.delta) / maxD;
      ctx.fillStyle = cluster.delta >= 0 ? BUY_FILL : RED_FILL;
      ctx.fillRect(centerX - f * barMax, rowTop, f * barMax * 2, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "bidAskProfile") {
      drawBidAskProfileRow(ctx, cluster, centerX, rowTop, rowH, barMax, maxV, modeFlags.exoImbalanceProfile);
    } else if (settings.clusterMode === "volumeCluster") {
      const intensity = Math.min(cluster.totalVol / maxV, 1);
      ctx.fillStyle = `rgba(100,149,237,${0.06 + intensity * 0.5})`;
      ctx.fillRect(centerX - candleW / 2 + 1, rowTop, candleW - 2, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "deltaCluster") {
      const intensity = Math.min(Math.abs(cluster.delta) / maxD, 1);
      ctx.fillStyle = cluster.delta >= 0
        ? `rgba(66,165,245,${0.06 + intensity * 0.5})`
        : `rgba(239,83,80,${0.06 + intensity * 0.5})`;
      ctx.fillRect(centerX - candleW / 2 + 1, rowTop, candleW - 2, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "deltaLadder") {
      const half = (candleW - 4) / 2;
      if (cluster.buyVol >= cluster.sellVol) {
        ctx.fillStyle = `rgba(66,165,245,${0.06 + Math.min(cluster.buyVol / maxV, 1) * 0.45})`;
        ctx.fillRect(centerX + 1, rowTop, half, Math.max(rowH - 0.5, 1));
      } else {
        ctx.fillStyle = `rgba(239,83,80,${0.06 + Math.min(cluster.sellVol / maxV, 1) * 0.45})`;
        ctx.fillRect(centerX - half - 1, rowTop, half, Math.max(rowH - 0.5, 1));
      }
    }

    drawClusterText(
      ctx,
      settings.dataView,
      cluster,
      centerX,
      rowTop,
      rowH,
      candleW,
      settings.shortNumbers,
      clusterIndex,
      clusters.length,
    );

    if (modeFlags.showImbalanceMarkers && !modeFlags.exoImbalanceProfile) {
      drawImbalanceMarker(ctx, cluster, centerX, candleW, rowTop, rowH);
    }

    if (modeFlags.showProfileRowSeparators && rowH >= 3) {
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(centerX - candleW / 2, rowTop + rowH);
      ctx.lineTo(centerX + candleW / 2, rowTop + rowH);
      ctx.stroke();
    }
  }

  if (modeFlags.showPointOfControl) {
    const pocTop = p2y(pocPrice + candleRowSize);
    const pocBottom = p2y(pocPrice);
    const pocRowTop = Math.min(pocTop, pocBottom);
    const pocRowHeight = Math.max(1, Math.abs(pocBottom - pocTop) - 0.5);
    ctx.fillStyle = "rgba(239,83,80,0.08)";
    ctx.fillRect(centerX - candleW / 2, pocRowTop, candleW, pocRowHeight);
    ctx.strokeStyle = POC_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX - candleW / 2 + 0.5, pocRowTop + 0.5, candleW - 1, Math.max(1, pocRowHeight - 1));
  }

  if (modeFlags.showAuctionOverlay) {
    drawUnfinishedAuction(ctx, candle, clusters, centerX, candleW, candleRowSize, p2y);
  }

  if (modeFlags.showCandleBadges && modeFlags.showImbalanceMarkers) {
    drawCandleImbalanceBadge(ctx, candle, centerX, yHigh, yTop, candleW, bodyW, settings.shortNumbers);
  }

  if (modeFlags.showCandleMetaOverlay && (modeFlags.showTradeCount || modeFlags.showTradeSize || modeFlags.showCandleStats)) {
    drawCandleMeta(ctx, candle, centerX, yTop, yBottom, candleW, modeFlags, settings.shortNumbers);
  }
}

function drawClusterText(ctx, dataView, cluster, centerX, rowTop, rowH, candleW, shortNumbers, clusterIndex, clusterCount) {
  if (!shouldRenderClusterText(dataView, rowH, candleW, clusterIndex, clusterCount)) return;

  const leftText = fmtFootprintValue(cluster.buyVol, { shortNumbers });
  const rightText = fmtFootprintValue(cluster.sellVol, { shortNumbers });
  const primaryText = dataView === "volume"
    ? fmtFootprintValue(cluster.totalVol, { shortNumbers })
    : dataView === "delta"
      ? fmtFootprintValue(cluster.delta, { signed: true, shortNumbers })
      : leftText.length >= rightText.length ? leftText : rightText;
  const fontSize = getClusterFontSize(rowH, candleW, primaryText, dataView);
  if (fontSize < 6) return;

  ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
  ctx.textBaseline = "middle";
  const yMid = rowTop + rowH / 2;

  if (dataView === "volume") {
    ctx.fillStyle = TEXT_BRIGHT;
    ctx.textAlign = "center";
    if (primaryText) ctx.fillText(primaryText, centerX, yMid);
    return;
  }

  if (dataView === "delta") {
    ctx.fillStyle = cluster.delta >= 0 ? BUY : RED;
    ctx.textAlign = "center";
    if (primaryText) ctx.fillText(primaryText, centerX, yMid);
    return;
  }

  if (dataView === "bidAsk") {
    drawFootprintMidline(ctx, centerX, rowTop, rowH);
    ctx.fillStyle = RED;
    ctx.textAlign = "right";
    if (leftText) ctx.fillText(leftText, centerX - 3, yMid);
    ctx.fillStyle = GREEN;
    ctx.textAlign = "left";
    if (rightText) ctx.fillText(rightText, centerX + 3, yMid);
    return;
  }

  if (dataView === "imbalance") {
    drawFootprintMidline(ctx, centerX, rowTop, rowH);
    ctx.fillStyle = RED;
    ctx.textAlign = "right";
    drawImbalanceTextCell(ctx, {
      text: leftText,
      align: "right",
      x: centerX - 3,
      y: yMid,
      rowTop,
      rowH,
      side: "ask",
      active: cluster.imbalance_buy,
      stacked: cluster.stacked_buy,
      candleW,
      fontSize,
    });
    ctx.fillStyle = GREEN;
    ctx.textAlign = "left";
    drawImbalanceTextCell(ctx, {
      text: rightText,
      align: "left",
      x: centerX + 3,
      y: yMid,
      rowTop,
      rowH,
      side: "bid",
      active: cluster.imbalance_sell,
      stacked: cluster.stacked_sell,
      candleW,
      fontSize,
    });
  }
}

function drawImbalanceTextCell(ctx, {
  text,
  align,
  x,
  y,
  rowTop,
  rowH,
  side,
  active,
  stacked,
  candleW,
  fontSize,
}) {
  if (!text) return;

  const color = side === "bid" ? (active ? "#bfd2ff" : GREEN) : RED;
  const width = Math.min(candleW / 2 - 4, Math.max(14, text.length * (fontSize * 0.62)));
  const boxX = align === "right" ? x - width - 2 : x - 2;

  ctx.fillStyle = active
    ? (stacked ? "rgba(0,0,0,0.9)" : "rgba(0,0,0,0.82)")
    : "rgba(0,0,0,0.56)";
  ctx.fillRect(boxX, rowTop + 1, width + 4, Math.max(2, rowH - 2));
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function drawBidAskProfileRow(ctx, cluster, centerX, rowTop, rowH, barMax, maxV, emphasizeImbalance) {
  const askWidth = (cluster.buyVol / maxV) * barMax;
  const bidWidth = (cluster.sellVol / maxV) * barMax;
  const innerHeight = Math.max(rowH - 0.5, 1);
  const baseAskColor = emphasizeImbalance ? "rgba(255,136,136,0.78)" : RED_FILL;
  const baseBidColor = emphasizeImbalance ? "rgba(102,255,120,0.78)" : BUY_FILL;

  if (askWidth > 0) {
    ctx.fillStyle = baseAskColor;
    ctx.fillRect(centerX - askWidth, rowTop, askWidth, innerHeight);
  }
  if (bidWidth > 0) {
    ctx.fillStyle = baseBidColor;
    ctx.fillRect(centerX, rowTop, bidWidth, innerHeight);
  }

  if (!emphasizeImbalance) return;

  const yMid = rowTop + rowH / 2;
  if (cluster.imbalance_buy) {
    const lineWidth = Math.max(askWidth, barMax * 0.55);
    ctx.strokeStyle = cluster.stacked_buy ? "rgba(255,45,45,0.98)" : "rgba(255,45,45,0.86)";
    ctx.lineWidth = Math.max(1.2, rowH * 0.34);
    ctx.beginPath();
    ctx.moveTo(centerX - lineWidth, yMid);
    ctx.lineTo(centerX, yMid);
    ctx.stroke();
  }
  if (cluster.imbalance_sell) {
    const lineWidth = Math.max(bidWidth, barMax * 0.55);
    ctx.strokeStyle = cluster.stacked_sell ? "rgba(143,170,255,0.98)" : "rgba(143,170,255,0.86)";
    ctx.lineWidth = Math.max(1.2, rowH * 0.34);
    ctx.beginPath();
    ctx.moveTo(centerX, yMid);
    ctx.lineTo(centerX + lineWidth, yMid);
    ctx.stroke();
  }
}

function drawFootprintMidline(ctx, centerX, rowTop, rowH) {
  if (rowH < 4) return;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX + 0.5, rowTop + 1);
  ctx.lineTo(centerX + 0.5, rowTop + rowH - 1);
  ctx.stroke();
}

function drawImbalanceMarker(ctx, cluster, centerX, candleW, rowTop, rowH) {
  if (cluster.imbalance_buy) {
    ctx.fillStyle = cluster.stacked_buy ? "rgba(239,83,80,0.95)" : "rgba(239,83,80,0.55)";
    ctx.fillRect(centerX - candleW / 2 + 1, rowTop + 1, 3, Math.max(2, rowH - 2));
  }
  if (cluster.imbalance_sell) {
    ctx.fillStyle = cluster.stacked_sell ? "rgba(66,165,245,0.95)" : "rgba(66,165,245,0.55)";
    ctx.fillRect(centerX + candleW / 2 - 4, rowTop + 1, 3, Math.max(2, rowH - 2));
  }
}

function drawCandleImbalanceBadge(ctx, candle, centerX, yHigh, yTop, candleW, bodyW, shortNumbers) {
  const imbalance = summarizeCandleImbalance(candle);
  if (!imbalance) return;

  const color = imbalance.stacked ? "rgba(239,83,80,0.98)" : "rgba(239,83,80,0.88)";
  ctx.strokeStyle = color;
  ctx.lineWidth = candleW >= 18 ? 1.25 : 1;
  ctx.strokeRect(centerX - bodyW / 2 - 1.5, yTop - 1.5, bodyW + 3, Math.max(4, Math.abs(yTop - yHigh) + 3));

  if (candleW < 16) {
    ctx.fillStyle = color;
    ctx.fillRect(centerX - 2, Math.max(2, yHigh - 7), 4, 4);
    return;
  }

  const label = candleW >= 26
    ? fmtFootprintValue(imbalance.value, { shortNumbers }) || "IMB"
    : "IMB";
  const fontSize = candleW >= 42 ? 9 : 8;
  ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
  const paddingX = 4;
  const boxWidth = Math.max(18, Math.min(candleW + 10, ctx.measureText(label).width + paddingX * 2));
  const boxX = centerX - boxWidth / 2;
  const boxY = Math.max(2, yHigh - 14);

  ctx.fillStyle = "rgba(14,17,23,0.9)";
  ctx.fillRect(boxX, boxY, boxWidth, 12);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, 11);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, centerX, boxY + 6);
}

function drawUnfinishedAuction(ctx, candle, clusters, centerX, candleW, rowSize, p2y) {
  const lowRow = clusters[0];
  const highRow = clusters.at(-1);
  if (!lowRow || !highRow) return;

  ctx.fillStyle = AUCTION_COLOR;
  if (candle.unfinished_low ?? (lowRow.buyVol > 0 && lowRow.sellVol > 0)) {
    const y = p2y(lowRow.price + rowSize / 2);
    ctx.beginPath();
    ctx.arc(centerX - candleW / 2 - 4, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (candle.unfinished_high ?? (highRow.buyVol > 0 && highRow.sellVol > 0)) {
    const y = p2y(highRow.price + rowSize / 2);
    ctx.beginPath();
    ctx.arc(centerX + candleW / 2 + 4, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCandleMeta(ctx, candle, centerX, yTop, yBottom, candleW, modeFlags, shortNumbers) {
  if (candleW < 26) return;

  const totalTrades = (candle.buy_trades ?? 0) + (candle.sell_trades ?? 0);
  const avgTradeSize = totalTrades > 0 ? (candle.total_volume ?? 0) / totalTrades : 0;
  const statsFont = candleW >= 68 ? 9 : 8;

  ctx.font = `${statsFont}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(255,255,255,0.78)";

  if (modeFlags.showCandleStats && candleW >= 48) {
    const volText = fmtFootprintValue(candle.total_volume ?? 0, { shortNumbers });
    const deltaText = fmtFootprintValue(candle.candle_delta ?? 0, { signed: true, shortNumbers });
    if (volText) {
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.fillText(volText, centerX, yTop - 14);
    }
    if (deltaText) {
      ctx.fillStyle = (candle.candle_delta ?? 0) >= 0 ? BUY : RED;
      ctx.fillText(deltaText, centerX, yTop - 3);
    }
  } else if (modeFlags.showTradeCount && totalTrades > 0) {
    ctx.fillText(`${totalTrades}t`, centerX, yTop - 3);
  }

  if (!modeFlags.showCandleStats && modeFlags.showTradeCount && totalTrades > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillText(`${totalTrades}t`, centerX, yTop - 3);
  }

  if (modeFlags.showTradeSize && avgTradeSize > 0) {
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(148,163,184,0.82)";
    ctx.fillText(fmtFootprintValue(avgTradeSize, { shortNumbers }), centerX, yBottom + 3);
  }
}
