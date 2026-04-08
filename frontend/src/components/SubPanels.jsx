import { useRef, useEffect } from "react";
import "./SubPanels.css";

/* ═══════════════════════════════════════════════════════
   Sub-panels: CVD line + Delta bars + OI line
   Pure canvas, synced with main chart
   ═══════════════════════════════════════════════════════ */

const BG = "#0b0e14";
const GRID = "rgba(255,255,255,0.03)";
const GREEN = "#26a69a";
const RED = "#ef5350";
const BLUE = "#42a5f5";
const YELLOW = "#ffca28";
const TEXT = "#6b7280";
const AXIS_W = 75; // match main chart

export default function SubPanels({ candles, activeFeatures }) {
  const cvdRef = useRef(null);
  const deltaRef = useRef(null);
  const oiRef = useRef(null);

  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  const showCVD = true; // always show
  const showDelta = true;
  const showOI = activeFeatures?.has?.("oi");

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      const c = candlesRef.current;
      if (c.length > 0) {
        if (showCVD) drawCVDPanel(cvdRef.current, c);
        if (showDelta) drawDeltaPanel(deltaRef.current, c);
        if (showOI) drawOIPanel(oiRef.current, c);
      }
      requestAnimationFrame(loop);
    };
    loop();
    return () => { running = false; };
  }, [showCVD, showDelta, showOI]);

  return (
    <div className="sub-panels">
      {showCVD && (
        <div className="sub-panel" style={{ height: 60 }}>
          <span className="sub-label">CVD</span>
          <canvas ref={cvdRef} className="sub-canvas" />
        </div>
      )}
      {showDelta && (
        <div className="sub-panel" style={{ height: 50 }}>
          <span className="sub-label">Δ Vol</span>
          <canvas ref={deltaRef} className="sub-canvas" />
        </div>
      )}
      {showOI && (
        <div className="sub-panel" style={{ height: 50 }}>
          <span className="sub-label">OI</span>
          <canvas ref={oiRef} className="sub-canvas" />
        </div>
      )}
    </div>
  );
}

/* ── CVD line chart ────────────────────────────────── */
function drawCVDPanel(canvas, candles) {
  if (!canvas) return;
  const p = canvas.parentElement;
  const w = p.clientWidth; const h = p.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);

  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);

  const chartW = w - AXIS_W;
  if (candles.length < 2) return;

  // CVD values
  const vals = candles.map(c => c.cvd ?? 0);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;

  const barW = Math.max(2, chartW / candles.length);

  // Grid + zero line
  const zeroY = h - ((0 - min) / range) * h;
  ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(chartW, zeroY); ctx.stroke();

  // Line
  ctx.strokeStyle = BLUE; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < candles.length; i++) {
    const x = (i + 0.5) * barW;
    const y = h - ((vals[i] - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Axis label
  ctx.fillStyle = TEXT; ctx.font = "9px 'JetBrains Mono',monospace";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(fmtAxis(vals[vals.length - 1]), chartW + 4, 2);
}

/* ── Delta histogram ───────────────────────────────── */
function drawDeltaPanel(canvas, candles) {
  if (!canvas) return;
  const p = canvas.parentElement;
  const w = p.clientWidth; const h = p.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);

  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);

  const chartW = w - AXIS_W;
  if (candles.length === 0) return;

  const deltas = candles.map(c => c.candle_delta ?? 0);
  const absMax = Math.max(1, ...deltas.map(Math.abs));
  const barW = Math.max(2, chartW / candles.length);
  const midY = h / 2;

  // Zero line
  ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(chartW, midY); ctx.stroke();

  for (let i = 0; i < candles.length; i++) {
    const d = deltas[i];
    const barH = (Math.abs(d) / absMax) * (midY - 2);
    const x = i * barW + 1;
    const bw = Math.max(1, barW - 2);

    ctx.fillStyle = d >= 0 ? GREEN : RED;
    if (d >= 0) {
      ctx.fillRect(x, midY - barH, bw, barH);
    } else {
      ctx.fillRect(x, midY, bw, barH);
    }
  }

  // Axis label
  ctx.fillStyle = TEXT; ctx.font = "9px 'JetBrains Mono',monospace";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  const last = deltas[deltas.length - 1] ?? 0;
  ctx.fillText(fmtAxis(last), chartW + 4, 2);
}

/* ── OI line chart ─────────────────────────────────── */
function drawOIPanel(canvas, candles) {
  if (!canvas) return;
  const p = canvas.parentElement;
  const w = p.clientWidth; const h = p.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);

  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);

  const chartW = w - AXIS_W;
  const vals = candles.map(c => c.oi ?? 0).filter(v => v > 0);
  if (vals.length < 2) return;

  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;

  const barW = chartW / vals.length;

  ctx.strokeStyle = YELLOW; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < vals.length; i++) {
    const x = (i + 0.5) * barW;
    const y = h - ((vals[i] - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = TEXT; ctx.font = "9px 'JetBrains Mono',monospace";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(fmtAxis(vals[vals.length - 1]), chartW + 4, 2);
}

function fmtAxis(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(3);
}
