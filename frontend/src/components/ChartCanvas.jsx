import { useCallback, useEffect, useRef } from "react";
import "./ChartCanvas.css";
import { drawCandle } from "./chart/candleLayer";
import {
  applyVWAP,
  drawCrosshair,
  drawDetectorEvents,
  drawDOM,
  drawDepthHistoryHeatmap,
  drawGrid,
  drawHoveredCandleHighlight,
  drawSetupAnnotations,
  drawLiquidityHeatmap,
  drawProfileStudy,
  drawPriceAxis,
  selectProfileSource,
  drawTimeAxis,
  drawVWAP,
} from "./chart/overlayLayer";
import { deriveModeFlags } from "./chart/modeRules";
import {
  BG,
  MAX_CANDLE_W,
  MIN_CANDLE_W,
  PRICE_AXIS_W,
  TIME_AXIS_H,
  clamp,
  clearHoverState,
  getRowSize,
  niceStep,
  recommendedCandleWidth,
  updateHoverState,
  zoomPriceRange,
} from "./chart/shared";

function markForRedraw(state) {
  if (state) state.needsRedraw = true;
}

export default function ChartCanvas({
  candles,
  depthHistory = [],
  detectorEvents = [],
  settings,
  activeFeatures,
  annotations = [],
  onCrosshairMove,
  viewCommand,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const goLiveBtnRef = useRef(null);
  const rafRef = useRef(null);

  const candlesRef = useRef(candles);
  const depthHistoryRef = useRef(depthHistory);
  const detectorEventsRef = useRef(detectorEvents);
  const settingsRef = useRef(settings);
  const featuresRef = useRef(activeFeatures);
  const annotationsRef = useRef(annotations);
  const crosshairCbRef = useRef(onCrosshairMove);

  useEffect(() => {
    candlesRef.current = candles;
    depthHistoryRef.current = depthHistory;
    detectorEventsRef.current = detectorEvents;
    settingsRef.current = settings;
    featuresRef.current = activeFeatures;
    annotationsRef.current = annotations;
    crosshairCbRef.current = onCrosshairMove;
    markForRedraw(stateRef.current);
  }, [candles, depthHistory, detectorEvents, settings, activeFeatures, annotations, onCrosshairMove]);

  /* eslint-disable react-hooks/immutability */
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
    markForRedraw(state);
  }, [viewCommand]);
  /* eslint-enable react-hooks/immutability */

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const state = stateRef.current;
    const nextModeFlags = deriveModeFlags(settings, activeFeatures);
    if (state.dragging || state.isDraggingY) return;
    if (state.autoScroll) {
      state.candleW = recommendedCandleWidth(settings, nextModeFlags);
    }
    markForRedraw(state);
  }, [activeFeatures, settings]);
  /* eslint-enable react-hooks/immutability */

  const stateRef = useRef({
    offsetX: 0,
    candleW: 60,
    mouse: { x: -1, y: -1 },
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffset: 0,
    dragPriceMin: 0,
    dragPriceMax: 100,
    dragChartH: 0,
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
    hoveredIndex: null,
    hoveredPrice: null,
    hoveredCluster: null,
    lastCanvasW: 0,
    lastCanvasH: 0,
    lastGoLiveVisible: null,
    needsRedraw: true,
  });

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      markForRedraw(stateRef.current);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      const state = stateRef.current;
      const shouldDraw = state.needsRedraw
        || state.dragging
        || state.isDraggingY
        || Math.abs(state.velocityX) > 0.05;

      if (shouldDraw) {
        drawFrame(
          canvasRef.current,
          containerRef.current,
          state,
          candlesRef.current,
          depthHistoryRef.current,
          detectorEventsRef.current,
          settingsRef.current,
          featuresRef.current,
          annotationsRef.current,
        );
      }
      const button = goLiveBtnRef.current;
      const shouldShowGoLive = !state.autoScroll;
      if (button && state.lastGoLiveVisible !== shouldShowGoLive) {
        button.style.display = shouldShowGoLive ? "flex" : "none";
        state.lastGoLiveVisible = shouldShowGoLive;
      }
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
    if (!canvas) return undefined;

    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const state = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const chartH = rect.height - TIME_AXIS_H;
      const overPriceAxis = mouseX >= rect.width - PRICE_AXIS_W;
      const overTimeAxis = mouseY >= chartH;

      if (event.shiftKey) {
        state.offsetX += event.deltaY * 0.6;
        state.autoScroll = false;
        state.velocityX = 0;
        markForRedraw(state);
        return;
      }

      if ((overPriceAxis || event.ctrlKey) && mouseY >= 0 && mouseY <= chartH) {
        const zoomFactor = event.deltaY > 0 ? 1.08 : 0.92;
        zoomPriceRange(state, chartH, mouseY, zoomFactor);
        markForRedraw(state);
        return;
      }

      if (overTimeAxis || mouseX <= rect.width - PRICE_AXIS_W) {
        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        const idxUnderMouse = (state.offsetX + mouseX) / state.candleW;
        state.candleW = clamp(state.candleW * zoomFactor, MIN_CANDLE_W, MAX_CANDLE_W);
        state.offsetX = idxUnderMouse * state.candleW - mouseX;
        state.autoScroll = false;
        state.velocityX = 0;
        markForRedraw(state);
      }
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
      const dy = event.clientY - state.dragStartY;
      if (Math.abs(dy) > 2 && state.dragChartH > 0) {
        const range = state.dragPriceMax - state.dragPriceMin;
        const shift = (dy / state.dragChartH) * range;
        state.priceMin = state.dragPriceMin + shift;
        state.priceMax = state.dragPriceMax + shift;
        state.autoScaleY = false;
      }
      state.lastDragTime = now;
      state.autoScroll = false;
    }
    markForRedraw(state);

    const chartW = rect.width - PRICE_AXIS_W;
    const chartH = rect.height - TIME_AXIS_H;
    const totalW = candlesRef.current.length * state.candleW;
    const rightPad = totalW < chartW ? chartW - totalW : 0;
    const priceRange = (state.priceMax - state.priceMin) || 1;
    updateHoverState(
      state,
      candlesRef.current,
      chartW,
      chartH,
      rightPad,
      priceRange,
      state.priceMin,
      getRowSize(settingsRef.current),
    );

    if (crosshairCbRef.current && state.hoveredCandle) {
      crosshairCbRef.current({
        ...state.hoveredCandle,
        hoveredPrice: state.hoveredPrice,
        hoveredCluster: state.hoveredCluster,
      });
    } else if (crosshairCbRef.current) {
      crosshairCbRef.current(null);
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
      markForRedraw(state);
      return;
    }

    state.dragging = true;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragStartOffset = state.offsetX;
    state.dragPriceMin = state.priceMin;
    state.dragPriceMax = state.priceMax;
    state.dragChartH = rect.height - TIME_AXIS_H;
    state.lastDragTime = performance.now();
    state.velocityX = 0;
    markForRedraw(state);
  }, []);

  const onUp = useCallback((event) => {
    stateRef.current.dragging = false;
    stateRef.current.isDraggingY = false;
    markForRedraw(stateRef.current);
    canvasRef.current?.releasePointerCapture(event.pointerId);
  }, []);

  const onLeave = useCallback(() => {
    const state = stateRef.current;
    clearHoverState(state);
    state.mouse.x = -1;
    state.mouse.y = -1;
    markForRedraw(state);
    if (crosshairCbRef.current) {
      crosshairCbRef.current(null);
    }
  }, []);

  const onDoubleClick = useCallback((event) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (event.clientX - rect.left >= rect.width - PRICE_AXIS_W) {
      stateRef.current.autoScaleY = true;
      markForRedraw(stateRef.current);
      return;
    }
    stateRef.current.autoScroll = true;
    markForRedraw(stateRef.current);
  }, []);

  const onGoLive = useCallback(() => {
    stateRef.current.autoScroll = true;
    stateRef.current.velocityX = 0;
    markForRedraw(stateRef.current);
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
        onPointerLeave={onLeave}
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

function drawFrame(canvas, container, state, candles, depthHistory, detectorEvents, settings, activeFeatures, annotations) {
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
  const modeFlags = deriveModeFlags(settings, activeFeatures);

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

  applyVWAP(candles, settings);

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

  updateHoverState(state, candles, chartW, chartH, rightPad, priceRange, pMin, rowSize);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, chartW, pMin, pMax, niceStep(priceRange), p2y);

  if (state.hoveredIndex != null) {
    drawHoveredCandleHighlight(ctx, state.hoveredIndex, startIdx, chartW, chartH, state.candleW, i2x);
  }

  let maxClusterVol = 0.001;
  let maxClusterDelta = 0.001;
  let maxLadderSize = 0.001;
  for (const candle of visible) {
    for (const cluster of candle.clusters || []) {
      if (cluster.totalVol > maxClusterVol) maxClusterVol = cluster.totalVol;
      if (Math.abs(cluster.delta) > maxClusterDelta) maxClusterDelta = Math.abs(cluster.delta);
    }
    for (const bid of candle.bids || []) {
      if ((bid.size || 0) > maxLadderSize) maxLadderSize = bid.size;
    }
    for (const ask of candle.asks || []) {
      if ((ask.size || 0) > maxLadderSize) maxLadderSize = ask.size;
    }
  }

  if (modeFlags.showHeatmap && visible.length > 0) {
    if (depthHistory?.length) {
      drawDepthHistoryHeatmap(ctx, depthHistory, visible, startIdx, i2x, p2y, state.candleW, chartH, settings.timeframe, rowSize);
    } else {
      drawLiquidityHeatmap(ctx, visible, startIdx, i2x, p2y, state.candleW, rowSize, chartH, maxLadderSize);
    }
  }

  if (modeFlags.showProfileStudy) {
    const profileSource = selectProfileSource(candles, visible, modeFlags.profileStudy);
    drawProfileStudy(
      ctx,
      profileSource,
      chartH,
      p2y,
      rowSize,
      settings?.vaPercent,
      modeFlags.showPointOfControl,
      modeFlags.showValueArea,
    );
  }

  for (let vi = 0; vi < visible.length; vi += 1) {
    drawCandle(
      ctx,
      visible[vi],
      i2x(startIdx + vi),
      Math.max(state.candleW * (0.6 * (modeFlags.barWidthScale ?? 1)), 2),
      p2y,
      chartH,
      state.candleW,
      settings,
      maxClusterVol,
      maxClusterDelta,
      rowSize,
      modeFlags,
    );
  }

  if (activeFeatures?.has?.("vwap")) {
    drawVWAP(ctx, visible, startIdx, p2y, i2x);
  }

  if (settings.showCallouts && annotations?.length) {
    drawSetupAnnotations(ctx, annotations, visible, startIdx, i2x, p2y, chartW, chartH, rowSize);
  }

  if (detectorEvents?.length) {
    drawDetectorEvents(ctx, detectorEvents, chartW, chartH, p2y);
  }

  drawPriceAxis(ctx, chartW, chartH, PRICE_AXIS_W, pMin, pMax, niceStep(priceRange), p2y, visible, modeFlags, settings.symbol);

  const lastVisible = visible.at(-1);
  if (modeFlags.showDOM && lastVisible?.bids?.length) {
    drawDOM(ctx, lastVisible, chartW, chartH, p2y, rowSize);
  }

  drawTimeAxis(ctx, visible, startIdx, chartW, chartH, state, i2x, PRICE_AXIS_W, modeFlags);
  drawCrosshair(ctx, state, chartW, chartH, pMin, priceRange, PRICE_AXIS_W);
  state.needsRedraw = false;
}
