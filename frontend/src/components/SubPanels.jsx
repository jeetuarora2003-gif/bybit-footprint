import { useEffect, useRef } from "react";
import "./SubPanels.css";

const BG = "#0b0e14";
const GREEN = "#26a69a";
const RED = "#ef5350";
const BLUE = "#42a5f5";
const YELLOW = "#ffca28";
const TEXT = "#6b7280";
const AXIS_W = 75;

export default function SubPanels({ candles, activeFeatures }) {
  const cvdRef = useRef(null);
  const deltaRef = useRef(null);
  const oiRef = useRef(null);
  const candlesRef = useRef(candles);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  const showCVD = true;
  const showDelta = true;
  const showOI = activeFeatures?.has?.("oi");

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      const current = candlesRef.current;
      if (current.length > 0) {
        if (showCVD) drawCVDPanel(cvdRef.current, current);
        if (showDelta) drawDeltaPanel(deltaRef.current, current);
        if (showOI) drawOIPanel(oiRef.current, current);
      }
      requestAnimationFrame(loop);
    };
    loop();
    return () => {
      running = false;
    };
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
          <span className="sub-label">Delta Vol</span>
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

function drawCVDPanel(canvas, candles) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const width = parent.clientWidth;
  const height = parent.clientHeight;
  if (!width || !height) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  const chartW = width - AXIS_W;
  if (candles.length < 2) return;

  const values = candles.map((candle) => candle.cvd ?? 0);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = max - min;
  const barW = Math.max(2, chartW / candles.length);
  const zeroY = height - ((0 - min) / range) * height;

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(chartW, zeroY);
  ctx.stroke();

  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let index = 0; index < candles.length; index += 1) {
    const x = (index + 0.5) * barW;
    const y = height - ((values[index] - min) / range) * (height - 4) - 2;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = TEXT;
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fmtAxis(values.at(-1) ?? 0), chartW + 4, 2);
}

function drawDeltaPanel(canvas, candles) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const width = parent.clientWidth;
  const height = parent.clientHeight;
  if (!width || !height) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  const chartW = width - AXIS_W;
  if (candles.length === 0) return;

  const deltas = candles.map((candle) => candle.candle_delta ?? 0);
  const absMax = Math.max(1, ...deltas.map(Math.abs));
  const barW = Math.max(2, chartW / candles.length);
  const midY = height / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(chartW, midY);
  ctx.stroke();

  for (let index = 0; index < candles.length; index += 1) {
    const delta = deltas[index];
    const barH = (Math.abs(delta) / absMax) * (midY - 2);
    const x = index * barW + 1;
    const bw = Math.max(1, barW - 2);

    ctx.fillStyle = delta >= 0 ? GREEN : RED;
    if (delta >= 0) ctx.fillRect(x, midY - barH, bw, barH);
    else ctx.fillRect(x, midY, bw, barH);
  }

  ctx.fillStyle = TEXT;
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fmtAxis(deltas.at(-1) ?? 0), chartW + 4, 2);
}

function drawOIPanel(canvas, candles) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const width = parent.clientWidth;
  const height = parent.clientHeight;
  if (!width || !height) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  const chartW = width - AXIS_W;
  const values = candles.map((candle) => candle.oi ?? 0).filter((value) => value > 0);
  if (values.length < 2) return;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = max - min;
  const barW = chartW / values.length;

  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let index = 0; index < values.length; index += 1) {
    const x = (index + 0.5) * barW;
    const y = height - ((values[index] - min) / range) * (height - 4) - 2;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = TEXT;
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fmtAxis(values.at(-1) ?? 0), chartW + 4, 2);
}

function fmtAxis(value) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  if (abs >= 1) return value.toFixed(1);
  return value.toFixed(3);
}
