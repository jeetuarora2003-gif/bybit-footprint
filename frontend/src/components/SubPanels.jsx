import { useEffect, useRef } from "react";
import "./SubPanels.css";
import {
  formatShortOriginalValue,
  formatSignedShortOriginalValue,
} from "../utils/exoFormat";

const BG = "#0b0e14";
const GREEN = "#26a69a";
const RED = "#ef5350";
const BLUE = "#42a5f5";
const YELLOW = "#ffca28";
const TEXT = "#6b7280";
const AXIS_W = 75;

export default function SubPanels({ candles, activeFeatures }) {
  const cvdRef = useRef(null);
  const oiRef = useRef(null);

  const showCVD = true;
  const showOI = activeFeatures?.has?.("oi");

  useEffect(() => {
    if (!candles.length) return;
    if (showCVD) drawCVDPanel(cvdRef.current, candles);
    if (showOI) drawOIPanel(oiRef.current, candles);
  }, [candles, showCVD, showOI]);

  return (
    <div className="sub-panels">
      {showCVD && (
        <div className="sub-panel" style={{ height: 60 }}>
          <span className="sub-label">CVD</span>
          <canvas ref={cvdRef} className="sub-canvas" />
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
  const numeric = Number(value) || 0;
  if (numeric > 0) return formatShortOriginalValue(numeric, 1);
  if (numeric < 0) return formatSignedShortOriginalValue(numeric, 1);
  return "0";
}
