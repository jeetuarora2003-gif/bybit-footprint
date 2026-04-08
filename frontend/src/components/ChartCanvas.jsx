import { useCallback, useEffect, useRef } from "react";
import "./ChartCanvas.css";

const BG = "#0e1117";
const GRID_COLOR = "rgba(255,255,255,0.04)";
const TEXT_COLOR = "#8b95a5";
const TEXT_BRIGHT = "#c8d0dc";
const GREEN = "#26a69a";
const RED = "#ef5350";
const GREEN_FILL = "rgba(38,166,154,0.25)";
const RED_FILL = "rgba(239,83,80,0.25)";
const POC_COLOR = "#ef5350";
const VA_COLOR = "rgba(38,166,154,0.08)";
const CROSSHAIR = "rgba(255,255,255,0.18)";
const PRICE_LABEL_BG = "#2563eb";
const PROFILE_COLOR = "rgba(59,130,246,0.16)";
const PROFILE_POC = "rgba(244,114,182,0.40)";
const AUCTION_COLOR = "#facc15";

const BASE_TICK_SIZE = 0.1;
const PRICE_AXIS_W = 75;
const TIME_AXIS_H = 26;
const MIN_CANDLE_W = 6;
const MAX_CANDLE_W = 200;
const PROFILE_MAX_W = 80;
const DOM_MAX_W = 128;

export default function ChartCanvas({ candles, settings, activeFeatures, onCrosshairMove, viewCommand }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const goLiveBtnRef = useRef(null);
  const rafRef = useRef(null);

  const candlesRef = useRef(candles);
  const settingsRef = useRef(settings);
  const featuresRef = useRef(activeFeatures);
  const crosshairCbRef = useRef(onCrosshairMove);

  useEffect(() => {
    candlesRef.current = candles;
    settingsRef.current = settings;
    featuresRef.current = activeFeatures;
    crosshairCbRef.current = onCrosshairMove;
  }, [candles, settings, activeFeatures, onCrosshairMove]);

  useEffect(() => {
    if (!viewCommand) return;
    const state = stateRef.current;
    if (viewCommand.type === "reset") {
      state.autoScroll = true;
      state.autoScaleY = true;
      state.velocityX = 0;
    } else if (viewCommand.type === "fit") {
      state.autoScaleY = true;
      state.velocityX = 0;
    }
  }, [viewCommand]);

  const stateRef = useRef({
    offsetX: 0,
    candleW: 60,
    mouse: { x: -1, y: -1 },
    dragging: false,
    dragStartX: 0,
    dragStartOffset: 0,
    autoScroll: true,
    autoScaleY: true,
    priceMin: 0,
    priceMax: 100,
    isDraggingY: false,
    yDragStart: 0,
    yDragMin: 0,
    yDragMax: 0,
    anchorPrice: 0,
    velocityX: 0,
    lastDragTime: 0,
    hoveredCandle: null,
    hoveredPrice: null,
    lastCanvasW: 0,
    lastCanvasH: 0,
  });

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      drawFrame(
        canvasRef.current,
        containerRef.current,
        stateRef.current,
        candlesRef.current,
        settingsRef.current,
        featuresRef.current,
      );
      const button = goLiveBtnRef.current;
      if (button) button.style.display = stateRef.current.autoScroll ? "none" : "flex";
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const state = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      if (mouseX > rect.width - PRICE_AXIS_W) return;
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      const idxUnderMouse = (state.offsetX + mouseX) / state.candleW;
      state.candleW = clamp(state.candleW * zoomFactor, MIN_CANDLE_W, MAX_CANDLE_W);
      state.offsetX = idxUnderMouse * state.candleW - mouseX;
      state.autoScroll = false;
      state.velocityX = 0;
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  /* eslint-disable react-hooks/immutability */
  const onMove = useCallback((event) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const state = stateRef.current;
    state.mouse.x = event.clientX - rect.left;
    state.mouse.y = event.clientY - rect.top;

    if (state.isDraggingY) {
      const dy = state.mouse.y - state.yDragStart;
      const zoomFactor = Math.exp(dy * 0.003);
      const range = state.yDragMax - state.yDragMin;
      const nextRange = range * zoomFactor;
      const rel = range === 0 ? 0.5 : (state.anchorPrice - state.yDragMin) / range;
      state.priceMin = state.anchorPrice - rel * nextRange;
      state.priceMax = state.anchorPrice + (1 - rel) * nextRange;
    } else if (state.dragging) {
      const now = performance.now();
      const dt = now - state.lastDragTime;
      const newOffsetX = state.dragStartOffset - (event.clientX - state.dragStartX);
      if (dt > 0) state.velocityX = (newOffsetX - state.offsetX) / dt;
      state.offsetX = newOffsetX;
      state.lastDragTime = now;
      state.autoScroll = false;
    }

    if (crosshairCbRef.current && state.hoveredCandle) {
      crosshairCbRef.current({
        ...state.hoveredCandle,
        hoveredPrice: state.hoveredPrice,
      });
    }
  }, []);

  const onDown = useCallback((event) => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return;

    canvas.setPointerCapture(event.pointerId);
    const state = stateRef.current;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (x >= rect.width - PRICE_AXIS_W) {
      state.isDraggingY = true;
      state.autoScaleY = false;
      state.yDragStart = y;
      state.yDragMin = state.priceMin;
      state.yDragMax = state.priceMax;
      const chartH = rect.height - TIME_AXIS_H;
      const t = clamp(1 - y / chartH, 0, 1);
      state.anchorPrice = state.priceMin + t * (state.priceMax - state.priceMin);
      return;
    }

    state.dragging = true;
    state.dragStartX = event.clientX;
    state.dragStartOffset = state.offsetX;
    state.lastDragTime = performance.now();
    state.velocityX = 0;
  }, []);

  const onUp = useCallback((event) => {
    stateRef.current.dragging = false;
    stateRef.current.isDraggingY = false;
    canvasRef.current?.releasePointerCapture(event.pointerId);
  }, []);

  const onDoubleClick = useCallback((event) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (event.clientX - rect.left >= rect.width - PRICE_AXIS_W) {
      stateRef.current.autoScaleY = true;
      return;
    }
    stateRef.current.autoScroll = true;
  }, []);

  const onGoLive = useCallback(() => {
    stateRef.current.autoScroll = true;
    stateRef.current.velocityX = 0;
  }, []);
  /* eslint-enable react-hooks/immutability */

  return (
    <div className="chart-canvas-container" ref={containerRef} style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        className="chart-canvas"
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={onDoubleClick}
      />
      <button
        ref={goLiveBtnRef}
        style={{
          display: "none",
          position: "absolute",
          bottom: TIME_AXIS_H + 8,
          right: PRICE_AXIS_W + 8,
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          padding: "4px 10px",
          fontSize: 11,
          cursor: "pointer",
          alignItems: "center",
          gap: 4,
          fontFamily: "'JetBrains Mono', monospace",
          zIndex: 10,
        }}
        onClick={onGoLive}
      >
        Live
      </button>
    </div>
  );
}

function getRowSize(settings) {
  const multiplier = Number.parseFloat(settings?.tickSize);
  return BASE_TICK_SIZE * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
}

function drawFrame(canvas, container, state, candles, settings, activeFeatures) {
  if (!canvas || !container || !candles?.length) return;

  const dpr = window.devicePixelRatio || 1;
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0 || height === 0) return;

  if (width !== state.lastCanvasW || height !== state.lastCanvasH) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    state.lastCanvasW = width;
    state.lastCanvasH = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const chartW = width - PRICE_AXIS_W;
  const chartH = height - TIME_AXIS_H;
  const rowSize = getRowSize(settings);
  const featureFlags = {
    showSessionProfile: activeFeatures?.has?.("vol"),
    showTradeCount: activeFeatures?.has?.("tcount"),
    showImbalanceMarkers: activeFeatures?.has?.("fpbs") || settings.dataView === "imbalance",
    showTradeSize: activeFeatures?.has?.("tsize"),
    showDeltaBars: activeFeatures?.has?.("dbars"),
    showAuctionMarkers: activeFeatures?.has?.("hl"),
  };

  const totalW = candles.length * state.candleW;
  const liveEdgeMax = Math.max(0, totalW - chartW);

  if (!state.dragging && Math.abs(state.velocityX) > 0.05) {
    state.offsetX += state.velocityX * 16;
    state.velocityX *= 0.90;
    if (Math.abs(state.velocityX) < 0.05) state.velocityX = 0;
  }

  if (state.autoScroll) {
    state.offsetX = Math.max(0, totalW - chartW + 120);
  } else if (!state.dragging && state.offsetX >= liveEdgeMax + 100) {
    state.autoScroll = true;
    state.velocityX = 0;
  }

  if (!state.dragging) {
    if (state.offsetX > totalW + chartW * 2) {
      state.offsetX = totalW + chartW * 2;
      state.velocityX = 0;
    }
    if (state.offsetX < -chartW * 0.8) {
      state.offsetX = -chartW * 0.8;
      state.velocityX = 0;
    }
  }

  applyVWAP(candles);

  const startIdx = Math.floor(state.offsetX / state.candleW);
  const endIdx = Math.ceil((state.offsetX + chartW) / state.candleW);
  const safeStart = Math.max(0, startIdx);
  const safeEnd = Math.max(0, Math.min(candles.length, endIdx));
  const visible = safeStart < safeEnd ? candles.slice(safeStart, safeEnd) : [];
  const rightPad = totalW < chartW ? chartW - totalW : 0;

  let pMin = Infinity;
  let pMax = -Infinity;
  if (visible.length > 0) {
    for (const candle of visible) {
      if (candle.low < pMin) pMin = candle.low;
      if (candle.high > pMax) pMax = candle.high;
      for (const cluster of candle.clusters || []) {
        if (cluster.price < pMin) pMin = cluster.price;
        if (cluster.price + rowSize > pMax) pMax = cluster.price + rowSize;
      }
    }
  } else {
    pMin = state.priceMin || 0;
    pMax = state.priceMax || 100;
  }

  const pr = (pMax - pMin) || 1;
  if (state.autoScaleY) {
    pMin -= pr * 0.05;
    pMax += pr * 0.05;
    state.priceMin = pMin;
    state.priceMax = pMax;
  } else {
    pMin = state.priceMin;
    pMax = state.priceMax;
  }

  const priceRange = (pMax - pMin) || 1;
  const p2y = (price) => chartH - ((price - pMin) / priceRange) * chartH;
  const i2x = (index) => rightPad + (index - startIdx) * state.candleW - (state.offsetX % state.candleW) + state.candleW / 2;

  const mouseX = state.mouse.x;
  if (mouseX > 0 && mouseX < chartW && visible.length > 0) {
    const hoverIdx = Math.floor((state.offsetX + mouseX - rightPad) / state.candleW);
    const clamped = Math.max(0, Math.min(candles.length - 1, hoverIdx));
    state.hoveredCandle = candles[clamped] || null;
    if (state.mouse.y > 0 && state.mouse.y < chartH) {
      state.hoveredPrice = pMin + (1 - state.mouse.y / chartH) * priceRange;
    }
  } else {
    state.hoveredCandle = null;
    state.hoveredPrice = null;
  }

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, chartW, pMin, pMax, niceStep(priceRange), p2y);

  let maxClusterVol = 0.001;
  let maxClusterDelta = 0.001;
  for (const candle of visible) {
    for (const cluster of candle.clusters || []) {
      if (cluster.totalVol > maxClusterVol) maxClusterVol = cluster.totalVol;
      if (Math.abs(cluster.delta) > maxClusterDelta) maxClusterDelta = Math.abs(cluster.delta);
    }
  }

  if (featureFlags.showSessionProfile) {
    drawSessionProfile(ctx, visible, chartH, p2y, rowSize);
  }

  for (let vi = 0; vi < visible.length; vi += 1) {
    drawCandle(
      ctx,
      visible[vi],
      i2x(startIdx + vi),
      Math.max(state.candleW * 0.6, 2),
      p2y,
      chartH,
      state.candleW,
      settings,
      maxClusterVol,
      maxClusterDelta,
      rowSize,
      featureFlags,
    );
  }

  if (activeFeatures?.has?.("vwap")) {
    drawVWAP(ctx, visible, startIdx, p2y, i2x);
  }

  drawPriceAxis(ctx, chartW, chartH, PRICE_AXIS_W, pMin, pMax, niceStep(priceRange), p2y, visible);

  const lastVisible = visible.at(-1);
  if (settings.showDOM && lastVisible?.bids?.length) {
    drawDOM(ctx, lastVisible.bids, lastVisible.asks, chartW, chartH, p2y, rowSize);
  }

  drawTimeAxis(ctx, visible, startIdx, chartW, chartH, state, i2x);
  drawCrosshair(ctx, state, chartW, chartH, pMin, priceRange, PRICE_AXIS_W);
}

function applyVWAP(candles) {
  let cumPV = 0;
  let cumVol = 0;
  let lastVwapDay = -1;

  for (const candle of candles) {
    const day = new Date(candle.candle_open_time).getUTCDate();
    if (day !== lastVwapDay) {
      cumPV = 0;
      cumVol = 0;
      lastVwapDay = day;
    }
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.total_volume || 0;
    cumPV += typicalPrice * volume;
    cumVol += volume;
    candle.vwap = cumVol > 0 ? cumPV / cumVol : null;
  }
}

function drawGrid(ctx, chartW, pMin, pMax, pStep, p2y) {
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

function drawPriceAxis(ctx, chartW, chartH, axisW, pMin, pMax, pStep, p2y, visible) {
  ctx.fillStyle = "#0c0f15";
  ctx.fillRect(chartW, 0, axisW, chartH);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartW, 0);
  ctx.lineTo(chartW, chartH);
  ctx.stroke();

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let price = Math.ceil(pMin / pStep) * pStep; price <= pMax; price += pStep) {
    const y = p2y(price);
    if (y > 8 && y < chartH - 8) ctx.fillText(price.toFixed(1), chartW + axisW / 2, y);
  }

  if (visible.length === 0) return;

  const last = visible.at(-1);
  const y = p2y(last.close);
  const color = last.close >= last.open ? GREEN : RED;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(chartW, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.fillRect(chartW, y - 9, axisW, 18);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 10px 'JetBrains Mono', monospace";
  ctx.fillText(last.close.toFixed(1), chartW + axisW / 2, y);
}

function drawTimeAxis(ctx, visible, startIdx, chartW, chartH, state, i2x) {
  ctx.fillStyle = "#0c0f15";
  ctx.fillRect(0, chartH, chartW + PRICE_AXIS_W, TIME_AXIS_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, chartH);
  ctx.lineTo(chartW + PRICE_AXIS_W, chartH);
  ctx.stroke();

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "9px 'JetBrains Mono', monospace";
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

function drawCrosshair(ctx, state, chartW, chartH, pMin, priceRange, axisW) {
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
  ctx.fillText(hoveredPrice.toFixed(1), chartW + axisW / 2, mouse.y);
}

function drawCandle(
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
  featureFlags,
) {
  const { open, high, low, close, clusters } = candle;
  const directionalValue = featureFlags.showDeltaBars ? (candle.candle_delta ?? 0) : close - open;
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

  const barMax = candleW * 0.45;

  for (const cluster of clusters) {
    const yRowTop = p2y(cluster.price + candleRowSize);
    const yRowBottom = p2y(cluster.price);
    const rowH = Math.abs(yRowBottom - yRowTop);
    const rowTop = Math.min(yRowTop, yRowBottom);
    if (rowTop > chartH || rowTop + rowH < 0) continue;

    if (settings.showVA && vaSet.has(cluster.price)) {
      ctx.fillStyle = VA_COLOR;
      ctx.fillRect(centerX - candleW / 2, rowTop, candleW, rowH);
    }

    if (settings.clusterMode === "volumeProfile") {
      const f = cluster.totalVol / maxV;
      ctx.fillStyle = vaSet.has(cluster.price) ? "rgba(38,166,154,0.4)" : "rgba(100,110,130,0.3)";
      ctx.fillRect(centerX - f * barMax, rowTop, f * barMax * 2, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "deltaProfile") {
      const f = Math.abs(cluster.delta) / maxD;
      ctx.fillStyle = cluster.delta >= 0 ? GREEN_FILL : RED_FILL;
      ctx.fillRect(centerX - f * barMax, rowTop, f * barMax * 2, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "bidAskProfile") {
      const sellF = cluster.sellVol / maxV;
      const buyF = cluster.buyVol / maxV;
      ctx.fillStyle = RED_FILL;
      ctx.fillRect(centerX - sellF * barMax, rowTop, sellF * barMax, Math.max(rowH - 0.5, 1));
      ctx.fillStyle = GREEN_FILL;
      ctx.fillRect(centerX, rowTop, buyF * barMax, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "volumeCluster") {
      const intensity = Math.min(cluster.totalVol / maxV, 1);
      ctx.fillStyle = `rgba(100,149,237,${0.06 + intensity * 0.5})`;
      ctx.fillRect(centerX - candleW / 2 + 1, rowTop, candleW - 2, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "deltaCluster") {
      const intensity = Math.min(Math.abs(cluster.delta) / maxD, 1);
      ctx.fillStyle = cluster.delta >= 0
        ? `rgba(38,166,154,${0.06 + intensity * 0.5})`
        : `rgba(239,83,80,${0.06 + intensity * 0.5})`;
      ctx.fillRect(centerX - candleW / 2 + 1, rowTop, candleW - 2, Math.max(rowH - 0.5, 1));
    } else if (settings.clusterMode === "deltaLadder") {
      const half = (candleW - 4) / 2;
      ctx.fillStyle = `rgba(239,83,80,${0.06 + Math.min(cluster.sellVol / maxV, 1) * 0.45})`;
      ctx.fillRect(centerX - half - 1, rowTop, half, Math.max(rowH - 0.5, 1));
      ctx.fillStyle = `rgba(38,166,154,${0.06 + Math.min(cluster.buyVol / maxV, 1) * 0.45})`;
      ctx.fillRect(centerX + 1, rowTop, half, Math.max(rowH - 0.5, 1));
    }

    drawClusterText(ctx, settings.dataView, cluster, centerX, rowTop, rowH, candleW);

    if (featureFlags.showImbalanceMarkers) {
      drawImbalanceMarker(ctx, cluster, centerX, candleW, rowTop, rowH);
    }

    if (rowH >= 3) {
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(centerX - candleW / 2, rowTop + rowH);
      ctx.lineTo(centerX + candleW / 2, rowTop + rowH);
      ctx.stroke();
    }
  }

  if (settings.showPOC) {
    const y = p2y(pocPrice + candleRowSize / 2);
    ctx.strokeStyle = POC_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centerX - candleW / 2, y);
    ctx.lineTo(centerX + candleW / 2, y);
    ctx.stroke();
  }

  if (featureFlags.showAuctionMarkers) {
    drawUnfinishedAuction(ctx, candle, clusters, centerX, candleW, candleRowSize, p2y);
  }

  if (featureFlags.showTradeCount || featureFlags.showTradeSize) {
    drawCandleMeta(ctx, candle, centerX, yTop, yBottom, candleW, featureFlags);
  }
}

function drawClusterText(ctx, dataView, cluster, centerX, rowTop, rowH, candleW) {
  const minFont = 6;
  const maxFont = 11;
  const fontSize = Math.min(maxFont, Math.max(minFont, rowH - 1));
  if (rowH < minFont || candleW < 20 || dataView === "none") return;

  ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
  ctx.textBaseline = "middle";
  const yMid = rowTop + rowH / 2;

  if (dataView === "volume") {
    ctx.fillStyle = TEXT_BRIGHT;
    ctx.textAlign = "center";
    ctx.fillText(fmtV(cluster.totalVol), centerX, yMid);
    return;
  }

  if (dataView === "delta") {
    ctx.fillStyle = cluster.delta >= 0 ? GREEN : RED;
    ctx.textAlign = "center";
    ctx.fillText(fmtV(cluster.delta), centerX, yMid);
    return;
  }

  if (dataView === "bidAsk") {
    ctx.fillStyle = RED;
    ctx.textAlign = "right";
    ctx.fillText(fmtV(cluster.sellVol), centerX - 2, yMid);
    ctx.fillStyle = "#555";
    ctx.textAlign = "center";
    ctx.fillText("x", centerX, yMid);
    ctx.fillStyle = GREEN;
    ctx.textAlign = "left";
    ctx.fillText(fmtV(cluster.buyVol), centerX + 2, yMid);
    return;
  }

  if (dataView === "imbalance") {
    if (cluster.imbalance_buy || cluster.imbalance_sell) {
      ctx.fillStyle = cluster.imbalance_buy ? GREEN : RED;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(centerX - candleW / 2 + 1, rowTop, candleW - 2, rowH);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = RED;
    ctx.textAlign = "right";
    ctx.fillText(fmtV(cluster.sellVol), centerX - 2, yMid);
    ctx.fillStyle = GREEN;
    ctx.textAlign = "left";
    ctx.fillText(fmtV(cluster.buyVol), centerX + 2, yMid);
  }
}

function drawImbalanceMarker(ctx, cluster, centerX, candleW, rowTop, rowH) {
  if (cluster.imbalance_buy) {
    ctx.fillStyle = cluster.stacked_buy ? "rgba(16,185,129,0.95)" : "rgba(16,185,129,0.55)";
    ctx.fillRect(centerX + candleW / 2 - 4, rowTop + 1, 3, Math.max(2, rowH - 2));
  }
  if (cluster.imbalance_sell) {
    ctx.fillStyle = cluster.stacked_sell ? "rgba(239,68,68,0.95)" : "rgba(239,68,68,0.55)";
    ctx.fillRect(centerX - candleW / 2 + 1, rowTop + 1, 3, Math.max(2, rowH - 2));
  }
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

function drawCandleMeta(ctx, candle, centerX, yTop, yBottom, candleW, featureFlags) {
  if (candleW < 26) return;

  const totalTrades = (candle.buy_trades ?? 0) + (candle.sell_trades ?? 0);
  const avgTradeSize = totalTrades > 0 ? (candle.total_volume ?? 0) / totalTrades : 0;

  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(255,255,255,0.78)";

  if (featureFlags.showTradeCount && totalTrades > 0) {
    ctx.fillText(`${totalTrades}t`, centerX, yTop - 3);
  }

  if (featureFlags.showTradeSize && avgTradeSize > 0) {
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(148,163,184,0.82)";
    ctx.fillText(fmtV(avgTradeSize), centerX, yBottom + 3);
  }
}

function drawSessionProfile(ctx, visible, chartH, p2y, rowSize) {
  const profile = new Map();
  for (const candle of visible) {
    for (const cluster of candle.clusters || []) {
      profile.set(cluster.price, (profile.get(cluster.price) || 0) + (cluster.totalVol || 0));
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
}

function drawDOM(ctx, bids, asks, chartW, chartH, p2y, rowSize) {
  let maxSize = 0;
  for (const bid of bids) if (bid.size > maxSize) maxSize = bid.size;
  for (const ask of asks) if (ask.size > maxSize) maxSize = ask.size;
  if (maxSize === 0) return;

  const rowH = Math.max(Math.abs(p2y(0) - p2y(rowSize)) - 0.5, 2);
  const domLeft = chartW - DOM_MAX_W;

  ctx.fillStyle = "rgba(12,15,21,0.60)";
  ctx.fillRect(domLeft, 0, DOM_MAX_W, chartH);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(domLeft, 0);
  ctx.lineTo(domLeft, chartH);
  ctx.stroke();

  drawDOMSide(ctx, asks, maxSize, domLeft, chartW, chartH, p2y, rowH, RED);
  drawDOMSide(ctx, bids, maxSize, domLeft, chartW, chartH, p2y, rowH, GREEN);
}

function drawDOMSide(ctx, levels, maxSize, domLeft, chartW, chartH, p2y, rowH, color) {
  const isAsk = color === RED;
  for (const level of levels) {
    const y = p2y(level.price);
    if (y < 0 || y > chartH) continue;
    const width = (level.size / maxSize) * (DOM_MAX_W - 12);
    ctx.fillStyle = isAsk ? "rgba(239,83,80,0.20)" : "rgba(38,166,154,0.20)";
    ctx.fillRect(chartW - width, y - rowH / 2, width, rowH);
    ctx.fillStyle = color;
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(fmtV(level.size), chartW - 4, y);
  }
}

function drawVWAP(ctx, visible, startIdx, p2y, i2x) {
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function niceStep(range) {
  const r = range / 8;
  const magnitude = Math.pow(10, Math.floor(Math.log10(r)));
  const normalized = r / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function fmtV(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(3);
  return value.toFixed(4);
}
