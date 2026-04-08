import { useRef, useEffect, useCallback } from "react";
import "./ChartCanvas.css";

const BG             = "#0e1117";
const GRID_COLOR     = "rgba(255,255,255,0.04)";
const TEXT_COLOR     = "#8b95a5";
const TEXT_BRIGHT    = "#c8d0dc";
const GREEN          = "#26a69a";
const RED            = "#ef5350";
const GREEN_FILL     = "rgba(38,166,154,0.25)";
const RED_FILL       = "rgba(239,83,80,0.25)";
const POC_COLOR      = "#ef5350";
const VA_COLOR       = "rgba(38,166,154,0.08)";
const CROSSHAIR      = "rgba(255,255,255,0.18)";
const PRICE_LABEL_BG = "#2563eb";

const ROW_SIZE     = 1.0;
const PRICE_AXIS_W = 75;
const TIME_AXIS_H  = 26;
const MIN_CANDLE_W = 6;
const MAX_CANDLE_W = 200;

export default function ChartCanvas({ candles, settings, activeFeatures, onCrosshairMove }) {
  const containerRef   = useRef(null);
  const canvasRef      = useRef(null);
  const goLiveBtnRef   = useRef(null);
  const rafRef         = useRef(null);

  // Always-fresh refs — no stale closure issues
  const candlesRef     = useRef(candles);
  const settingsRef    = useRef(settings);
  const featuresRef    = useRef(activeFeatures);
  const crosshairCbRef = useRef(onCrosshairMove);
  candlesRef.current     = candles;
  settingsRef.current    = settings;
  featuresRef.current    = activeFeatures;
  crosshairCbRef.current = onCrosshairMove;

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
    lastCanvasW: 0,
    lastCanvasH: 0,
  });

  // ── RAF loop (no broken hook calls inside) ──
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
        crosshairCbRef
      );
      // Show/hide Go Live button by direct DOM style — no React re-render needed
      const btn = goLiveBtnRef.current;
      if (btn) btn.style.display = stateRef.current.autoScroll ? "none" : "flex";
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, []);

  // ── Native wheel (passive:false so preventDefault works) ──
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const s = stateRef.current;
      const r = el.getBoundingClientRect();
      const mouseX = e.clientX - r.left;
      if (mouseX > r.width - PRICE_AXIS_W) return;
      const zoomFactor    = e.deltaY > 0 ? 0.9 : 1.1;
      const idxUnderMouse = (s.offsetX + mouseX) / s.candleW;
      s.candleW   = Math.max(MIN_CANDLE_W, Math.min(MAX_CANDLE_W, s.candleW * zoomFactor));
      s.offsetX   = idxUnderMouse * s.candleW - mouseX;
      s.autoScroll = false;
      s.velocityX  = 0;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ── Pointer handlers ──
  const onMove = useCallback((e) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    const s = stateRef.current;
    s.mouse.x = e.clientX - r.left;
    s.mouse.y = e.clientY - r.top;

    if (s.isDraggingY) {
      const dy        = s.mouse.y - s.yDragStart;
      const zoomFac   = Math.exp(dy * 0.003);
      const range     = s.yDragMax - s.yDragMin;
      const newRange  = range * zoomFac;
      const rel       = (s.anchorPrice - s.yDragMin) / range;
      s.priceMin = s.anchorPrice - rel * newRange;
      s.priceMax = s.anchorPrice + (1 - rel) * newRange;
    } else if (s.dragging) {
      const now        = performance.now();
      const dt         = now - s.lastDragTime;
      const newOffsetX = s.dragStartOffset - (e.clientX - s.dragStartX);
      if (dt > 0) s.velocityX = (newOffsetX - s.offsetX) / dt;
      s.offsetX      = newOffsetX;
      s.lastDragTime = now;
      s.autoScroll   = false;
    }

    if (crosshairCbRef.current && s.hoveredCandle) {
      crosshairCbRef.current(s.hoveredCandle);
    }
  }, []);

  const onDown = useCallback((e) => {
    const el = canvasRef.current;
    const r  = el?.getBoundingClientRect();
    if (!r) return;
    el.setPointerCapture(e.pointerId);
    const s  = stateRef.current;
    const x  = e.clientX - r.left;
    const y  = e.clientY - r.top;

    if (x >= r.width - PRICE_AXIS_W) {
      s.isDraggingY = true;
      s.autoScaleY  = false;
      s.yDragStart  = y;
      s.yDragMin    = s.priceMin;
      s.yDragMax    = s.priceMax;
      const chartH  = r.height - TIME_AXIS_H;
      const t       = 1 - y / chartH;
      s.anchorPrice = s.priceMin + t * (s.priceMax - s.priceMin);
    } else {
      s.dragging       = true;
      s.dragStartX     = e.clientX;
      s.dragStartOffset = s.offsetX;
      s.lastDragTime   = performance.now();
      s.velocityX      = 0;
    }
  }, []);

  const onUp = useCallback((e) => {
    stateRef.current.dragging    = false;
    stateRef.current.isDraggingY = false;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  const onDoubleClick = useCallback((e) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    if (e.clientX - r.left >= r.width - PRICE_AXIS_W) {
      stateRef.current.autoScaleY = true;
    } else {
      stateRef.current.autoScroll = true;
    }
  }, []);

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
      {/* Go Live button — visibility toggled directly via ref in RAF loop */}
      <button
        ref={goLiveBtnRef}
        style={{
          display:      "none",
          position:     "absolute",
          bottom:       TIME_AXIS_H + 8,
          right:        PRICE_AXIS_W + 8,
          background:   "#2563eb",
          color:        "#fff",
          border:       "none",
          borderRadius: 4,
          padding:      "4px 10px",
          fontSize:     11,
          cursor:       "pointer",
          alignItems:   "center",
          gap:          4,
          fontFamily:   "'JetBrains Mono', monospace",
          zIndex:       10,
        }}
        onClick={() => {
          stateRef.current.autoScroll = true;
          stateRef.current.velocityX  = 0;
        }}
      >
        ▶ Live
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Core render
   ═══════════════════════════════════════════════════════ */

function drawFrame(canvas, container, state, candles, settings, activeFeatures, crosshairCbRef) {
  if (!canvas || !container || !candles || candles.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const w   = container.clientWidth;
  const h   = container.clientHeight;
  if (w === 0 || h === 0) return;

  // Only resize when container dims change
  if (w !== state.lastCanvasW || h !== state.lastCanvasH) {
    canvas.width        = w * dpr;
    canvas.height       = h * dpr;
    canvas.style.width  = w + "px";
    canvas.style.height = h + "px";
    state.lastCanvasW   = w;
    state.lastCanvasH   = h;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const chartW = w - PRICE_AXIS_W;
  const chartH = h - TIME_AXIS_H;

  const totalW     = candles.length * state.candleW;
  const liveEdgeMax = Math.max(0, totalW - chartW);

  // Kinetic inertia
  if (!state.dragging && Math.abs(state.velocityX) > 0.05) {
    state.offsetX   += state.velocityX * 16;
    state.velocityX *= 0.90;
    if (Math.abs(state.velocityX) < 0.05) state.velocityX = 0;
  }

  if (state.autoScroll) {
    state.offsetX = Math.max(0, totalW - chartW + 120);
  } else if (!state.dragging && state.offsetX >= liveEdgeMax + 100) {
    state.autoScroll = true;
    state.velocityX  = 0;
  }

  if (!state.dragging) {
    if (state.offsetX > totalW + chartW * 2) { state.offsetX = totalW + chartW * 2; state.velocityX = 0; }
    if (state.offsetX < -chartW * 0.8)       { state.offsetX = -chartW * 0.8;       state.velocityX = 0; }
  }

  // VWAP — resets at UTC midnight
  let cumPV = 0, cumVol = 0, lastVwapDay = -1;
  for (let i = 0; i < candles.length; i++) {
    const c   = candles[i];
    const day = new Date(c.candle_open_time).getUTCDate();
    if (day !== lastVwapDay) { cumPV = 0; cumVol = 0; lastVwapDay = day; }
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.total_volume || 0;
    cumPV  += tp * vol;
    cumVol += vol;
    c.vwap  = cumVol > 0 ? cumPV / cumVol : null;
  }

  const startIdx  = Math.floor(state.offsetX / state.candleW);
  const endIdx    = Math.ceil((state.offsetX + chartW) / state.candleW);
  const safeStart = Math.max(0, startIdx);
  const safeEnd   = Math.max(0, Math.min(candles.length, endIdx));
  const visible   = safeStart < safeEnd ? candles.slice(safeStart, safeEnd) : [];
  const rightPad  = totalW < chartW ? chartW - totalW : 0;

  // Visible price range
  let pMin = Infinity, pMax = -Infinity;
  if (visible.length > 0) {
    for (const c of visible) {
      if (c.low  < pMin) pMin = c.low;
      if (c.high > pMax) pMax = c.high;
      if (c.clusters) for (const cl of c.clusters) {
        if (cl.price            < pMin) pMin = cl.price;
        if (cl.price + ROW_SIZE > pMax) pMax = cl.price + ROW_SIZE;
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
  const priceRange = pMax - pMin;

  const p2y = (p) => chartH - ((p - pMin) / priceRange) * chartH;
  const i2x = (i) => rightPad + (i - startIdx) * state.candleW - (state.offsetX % state.candleW) + state.candleW / 2;

  // Update hovered candle for crosshair callback
  const mx = state.mouse.x;
  if (mx > 0 && mx < chartW && visible.length > 0) {
    const hIdx    = Math.floor((state.offsetX + mx - rightPad) / state.candleW);
    const clamped = Math.max(0, Math.min(candles.length - 1, hIdx));
    state.hoveredCandle = candles[clamped] || null;
  } else {
    state.hoveredCandle = null;
  }

  // ── Background ──
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  // ── Grid ──
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth   = 1;
  const pStep = niceStep(priceRange);
  for (let p = Math.ceil(pMin / pStep) * pStep; p <= pMax; p += pStep) {
    const y = Math.round(p2y(p)) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
  }

  // Adaptive shading globals
  let gMaxV = 0.001, gMaxD = 0.001;
  for (const c of visible) {
    if (c.clusters) for (const cl of c.clusters) {
      if (cl.totalVol        > gMaxV) gMaxV = cl.totalVol;
      if (Math.abs(cl.delta) > gMaxD) gMaxD = Math.abs(cl.delta);
    }
  }

  // ── Candles + clusters ──
  for (let vi = 0; vi < visible.length; vi++) {
    drawCandle(
      ctx, visible[vi], i2x(startIdx + vi),
      Math.max(state.candleW * 0.6, 2),
      p2y, chartH, state.candleW, settings, gMaxV, gMaxD
    );
  }

  // ── VWAP ──
  if (activeFeatures && activeFeatures.has("vwap")) {
    drawVWAP(ctx, visible, startIdx, p2y, i2x);
  }

  // ── Price axis ──
  drawPriceAxis(ctx, chartW, chartH, PRICE_AXIS_W, pMin, pMax, pStep, p2y, visible);

  // ── DOM ──
  const lastC = visible[visible.length - 1];
  if (settings.showDOM && lastC?.bids?.length) {
    drawDOM(ctx, lastC.bids, lastC.asks, chartW, chartH, p2y);
  }

  // ── Time axis ──
  drawTimeAxis(ctx, visible, startIdx, chartW, chartH, state, i2x);

  // ── Crosshair ──
  drawCrosshair(ctx, state, chartW, chartH, pMin, priceRange, PRICE_AXIS_W);
}

/* ─────────────────────────────────────────────────────
   Price axis
───────────────────────────────────────────────────── */
function drawPriceAxis(ctx, chartW, chartH, axisW, pMin, pMax, pStep, p2y, visible) {
  ctx.fillStyle = "#0c0f15";
  ctx.fillRect(chartW, 0, axisW, chartH);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(chartW, 0); ctx.lineTo(chartW, chartH); ctx.stroke();

  ctx.fillStyle    = TEXT_COLOR;
  ctx.font         = "10px 'JetBrains Mono',monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  for (let p = Math.ceil(pMin / pStep) * pStep; p <= pMax; p += pStep) {
    const y = p2y(p);
    if (y > 8 && y < chartH - 8) ctx.fillText(p.toFixed(1), chartW + axisW / 2, y);
  }

  if (visible.length) {
    const last = visible[visible.length - 1];
    const y    = p2y(last.close);
    const col  = last.close >= last.open ? GREEN : RED;
    ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.fillRect(chartW, y - 9, axisW, 18);
    ctx.fillStyle    = "#fff";
    ctx.font         = "bold 10px 'JetBrains Mono',monospace";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(last.close.toFixed(1), chartW + axisW / 2, y);
  }
}

/* ─────────────────────────────────────────────────────
   Time axis
───────────────────────────────────────────────────── */
function drawTimeAxis(ctx, visible, startIdx, chartW, chartH, state, i2x) {
  ctx.fillStyle = "#0c0f15";
  ctx.fillRect(0, chartH, chartW + PRICE_AXIS_W, TIME_AXIS_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(0, chartH); ctx.lineTo(chartW + PRICE_AXIS_W, chartH); ctx.stroke();

  ctx.fillStyle    = TEXT_COLOR;
  ctx.font         = "9px 'JetBrains Mono',monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  const step = Math.max(1, Math.floor(90 / state.candleW));
  for (let vi = 0; vi < visible.length; vi += step) {
    const x = i2x(startIdx + vi);
    if (x > 30 && x < chartW - 30) {
      const d = new Date(visible[vi].candle_open_time);
      ctx.fillText(
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        x, chartH + TIME_AXIS_H / 2
      );
    }
  }
}

/* ─────────────────────────────────────────────────────
   Crosshair
───────────────────────────────────────────────────── */
function drawCrosshair(ctx, state, chartW, chartH, pMin, priceRange, axisW) {
  const { mouse } = state;
  if (mouse.x <= 0 || mouse.x >= chartW || mouse.y <= 0 || mouse.y >= chartH) return;

  ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(mouse.x, 0);     ctx.lineTo(mouse.x, chartH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, mouse.y);     ctx.lineTo(chartW, mouse.y); ctx.stroke();
  ctx.setLineDash([]);

  const hp = pMin + (1 - mouse.y / chartH) * priceRange;
  ctx.fillStyle    = PRICE_LABEL_BG;
  ctx.fillRect(chartW, mouse.y - 9, axisW, 18);
  ctx.fillStyle    = "#fff";
  ctx.font         = "10px 'JetBrains Mono',monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(hp.toFixed(1), chartW + axisW / 2, mouse.y);
}

/* ─────────────────────────────────────────────────────
   Single candle + clusters
───────────────────────────────────────────────────── */
function drawCandle(ctx, candle, cx, bodyW, p2y, chartH, candleW, settings, gMaxV, gMaxD) {
  const { open, high, low, close, clusters } = candle;
  const up  = close >= open;
  const col = up ? GREEN : RED;
  const st  = settings.candleStyle;

  const yO   = p2y(open), yC = p2y(close), yH = p2y(high), yL = p2y(low);
  const yTop = Math.min(yO, yC);
  const yBot = Math.max(yO, yC);
  const bH   = Math.max(yBot - yTop, 1);

  if (st !== "none") {
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, yH); ctx.lineTo(cx, yL); ctx.stroke();

    if (st === "ohlc") {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - bodyW / 3, yO); ctx.lineTo(cx, yO);
      ctx.moveTo(cx, yC);             ctx.lineTo(cx + bodyW / 3, yC);
      ctx.stroke();
    } else if (st === "embed") {
      ctx.fillStyle = col; ctx.globalAlpha = 0.15;
      ctx.fillRect(cx - candleW / 2, yTop, candleW, bH);
      ctx.globalAlpha = 1;
    } else if (st === "borderedCandle") {
      ctx.fillStyle = BG;
      ctx.fillRect(cx - bodyW / 2, yTop, bodyW, bH);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.strokeRect(cx - bodyW / 2, yTop, bodyW, bH);
    } else if (st === "monoCandle" || st === "monoBox" || st === "flatCandle") {
      ctx.fillStyle = up ? "rgba(180,180,180,0.25)" : "rgba(180,180,180,0.12)";
      ctx.fillRect(cx - bodyW / 2, yTop, bodyW, bH);
    } else if (st === "colorBox") {
      ctx.fillStyle = up ? GREEN_FILL : RED_FILL;
      ctx.fillRect(cx - candleW / 2 + 1, yTop, candleW - 2, bH);
    } else if (st === "hl") {
      /* wick only — drawn above */
    } else if (st === "oc") {
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, yO); ctx.lineTo(cx, yC); ctx.stroke();
    } else {
      // colorCandle (default)
      ctx.fillStyle = up ? GREEN_FILL : RED_FILL;
      ctx.fillRect(cx - bodyW / 2, yTop, bodyW, bH);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.strokeRect(cx - bodyW / 2, yTop, bodyW, bH);
    }
  }

  if (!clusters || !clusters.length || settings.clusterMode === "void") return;

  const maxV = settings.shadingMode === "adaptive"
    ? gMaxV
    : Math.max(0.001, ...clusters.map(c => c.totalVol));
  const maxD = settings.shadingMode === "adaptive"
    ? gMaxD
    : Math.max(0.001, ...clusters.map(c => Math.abs(c.delta)));

  // POC
  let pocPrice = clusters[0]?.price ?? 0, pocVol = 0;
  for (const cl of clusters) if (cl.totalVol > pocVol) { pocVol = cl.totalVol; pocPrice = cl.price; }

  // Value Area
  const totalV   = clusters.reduce((s, c) => s + c.totalVol, 0);
  const vaTarget = totalV * ((settings.vaPercent || 70) / 100);
  const sorted   = [...clusters].sort((a, b) => b.totalVol - a.totalVol);
  let vaAcc = 0;
  const vaSet = new Set();
  for (const c of sorted) { vaAcc += c.totalVol; vaSet.add(c.price); if (vaAcc >= vaTarget) break; }

  const barMax = candleW * 0.45;
  const mode   = settings.clusterMode;

  for (const cl of clusters) {
    const yRT  = p2y(cl.price + ROW_SIZE);
    const yRB  = p2y(cl.price);
    const rH   = Math.abs(yRB - yRT);
    const rTop = Math.min(yRT, yRB);
    if (rTop > chartH || rTop + rH < 0) continue;

    // Value Area background
    if (settings.showVA && vaSet.has(cl.price)) {
      ctx.fillStyle = VA_COLOR;
      ctx.fillRect(cx - candleW / 2, rTop, candleW, rH);
    }

    // Cluster shading
    if (mode === "volumeProfile") {
      const f = cl.totalVol / maxV;
      ctx.fillStyle = vaSet.has(cl.price) ? "rgba(38,166,154,0.4)" : "rgba(100,110,130,0.3)";
      ctx.fillRect(cx - f * barMax, rTop, f * barMax * 2, Math.max(rH - 0.5, 1));
    } else if (mode === "deltaProfile") {
      const f = Math.abs(cl.delta) / maxD;
      ctx.fillStyle = cl.delta >= 0 ? GREEN_FILL : RED_FILL;
      ctx.fillRect(cx - f * barMax, rTop, f * barMax * 2, Math.max(rH - 0.5, 1));
    } else if (mode === "bidAskProfile") {
      const sF = cl.sellVol / maxV, bF = cl.buyVol / maxV;
      ctx.fillStyle = RED_FILL;
      ctx.fillRect(cx - sF * barMax, rTop, sF * barMax, Math.max(rH - 0.5, 1));
      ctx.fillStyle = GREEN_FILL;
      ctx.fillRect(cx, rTop, bF * barMax, Math.max(rH - 0.5, 1));
    } else if (mode === "volumeCluster") {
      const intensity = Math.min(cl.totalVol / maxV, 1);
      ctx.fillStyle = `rgba(100,149,237,${0.06 + intensity * 0.5})`;
      ctx.fillRect(cx - candleW / 2 + 1, rTop, candleW - 2, Math.max(rH - 0.5, 1));
    } else if (mode === "deltaCluster") {
      const intensity = Math.min(Math.abs(cl.delta) / maxD, 1);
      ctx.fillStyle = cl.delta >= 0
        ? `rgba(38,166,154,${0.06 + intensity * 0.5})`
        : `rgba(239,83,80,${0.06 + intensity * 0.5})`;
      ctx.fillRect(cx - candleW / 2 + 1, rTop, candleW - 2, Math.max(rH - 0.5, 1));
    } else if (mode === "deltaLadder") {
      const half = (candleW - 4) / 2;
      ctx.fillStyle = `rgba(239,83,80,${0.06 + Math.min(cl.sellVol / maxV, 1) * 0.45})`;
      ctx.fillRect(cx - half - 1, rTop, half, Math.max(rH - 0.5, 1));
      ctx.fillStyle = `rgba(38,166,154,${0.06 + Math.min(cl.buyVol / maxV, 1) * 0.45})`;
      ctx.fillRect(cx + 1, rTop, half, Math.max(rH - 0.5, 1));
    }

    // Data text
    const minFont  = 6, maxFont = 11;
    const fontSize = Math.min(maxFont, Math.max(minFont, rH - 1));
    if (rH >= minFont && candleW >= 20 && settings.dataView !== "none") {
      ctx.font         = `${fontSize}px 'JetBrains Mono',monospace`;
      ctx.textBaseline = "middle";
      const yM = rTop + rH / 2;
      const dv = settings.dataView;

      if (dv === "volume") {
        ctx.fillStyle = TEXT_BRIGHT; ctx.textAlign = "center";
        ctx.fillText(fmtV(cl.totalVol), cx, yM);
      } else if (dv === "delta") {
        ctx.fillStyle = cl.delta >= 0 ? GREEN : RED; ctx.textAlign = "center";
        ctx.fillText(fmtV(cl.delta), cx, yM);
      } else if (dv === "bidAsk") {
        ctx.fillStyle = RED;    ctx.textAlign = "right"; ctx.fillText(fmtV(cl.sellVol), cx - 2, yM);
        ctx.fillStyle = "#555"; ctx.textAlign = "center"; ctx.fillText("×", cx, yM);
        ctx.fillStyle = GREEN;  ctx.textAlign = "left";  ctx.fillText(fmtV(cl.buyVol),  cx + 2, yM);
      } else if (dv === "imbalance") {
        const ratio = cl.buyVol > 0 && cl.sellVol > 0
          ? Math.max(cl.buyVol / cl.sellVol, cl.sellVol / cl.buyVol) : 0;
        if (ratio >= 3) {
          ctx.fillStyle   = cl.buyVol > cl.sellVol ? GREEN : RED;
          ctx.globalAlpha = 0.18;
          ctx.fillRect(cx - candleW / 2 + 1, rTop, candleW - 2, rH);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = RED;   ctx.textAlign = "right"; ctx.fillText(fmtV(cl.sellVol), cx - 2, yM);
        ctx.fillStyle = GREEN; ctx.textAlign = "left";  ctx.fillText(fmtV(cl.buyVol),  cx + 2, yM);
      }
    }

    // Row separator line
    if (rH >= 3) {
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - candleW / 2, rTop + rH);
      ctx.lineTo(cx + candleW / 2, rTop + rH);
      ctx.stroke();
    }
  }

  // POC line
  if (settings.showPOC) {
    const y = p2y(pocPrice + ROW_SIZE / 2);
    ctx.strokeStyle = POC_COLOR; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - candleW / 2, y); ctx.lineTo(cx + candleW / 2, y); ctx.stroke();
  }
}

/* ─────────────────────────────────────────────────────
   DOM Ladder
───────────────────────────────────────────────────── */
function drawDOM(ctx, bids, asks, chartW, chartH, p2y) {
  let maxS = 0;
  for (const b of bids) if (b.size > maxS) maxS = b.size;
  for (const a of asks) if (a.size > maxS) maxS = a.size;
  if (maxS === 0) return;

  const maxBarW = 120;
  const rh      = Math.abs(p2y(0) - p2y(ROW_SIZE));
  const bh      = Math.max(rh - 0.5, 2);

  ctx.fillStyle = "rgba(239,83,80,0.18)";
  for (const a of asks) {
    const y = p2y(a.price);
    if (y < 0 || y > chartH) continue;
    ctx.fillRect(chartW - (a.size / maxS) * maxBarW, y - Math.max(1, rh / 2), (a.size / maxS) * maxBarW, bh);
  }
  ctx.fillStyle = "rgba(38,166,154,0.18)";
  for (const b of bids) {
    const y = p2y(b.price);
    if (y < 0 || y > chartH) continue;
    ctx.fillRect(chartW - (b.size / maxS) * maxBarW, y - Math.max(1, rh / 2), (b.size / maxS) * maxBarW, bh);
  }
}

/* ─────────────────────────────────────────────────────
   VWAP Line
───────────────────────────────────────────────────── */
function drawVWAP(ctx, visible, startIdx, p2y, i2x) {
  ctx.strokeStyle = "#ffca28";
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  let started = false;
  for (let vi = 0; vi < visible.length; vi++) {
    const c = visible[vi];
    if (c.vwap != null) {
      const x = i2x(startIdx + vi);
      const y = p2y(c.vwap);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else            ctx.lineTo(x, y);
    }
  }
  if (started) ctx.stroke();
}

/* ─────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────── */
function niceStep(range) {
  const r = range / 8;
  const m = Math.pow(10, Math.floor(Math.log10(r)));
  const n = r / m;
  if (n <= 1) return m;
  if (n <= 2) return 2 * m;
  if (n <= 5) return 5 * m;
  return 10 * m;
}

function fmtV(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(1) + "k";
  if (a >= 100)  return v.toFixed(0);
  if (a >= 10)   return v.toFixed(1);
  if (a >= 1)    return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  return v.toFixed(4);
}
