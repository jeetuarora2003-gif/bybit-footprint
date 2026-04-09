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

  const series = candles.map((candle) => {
    const reliable = Number(candle?.orderflow_coverage ?? 0) >= 0.999;
    const value = Number(candle?.cvd);
    return reliable && Number.isFinite(value) ? value : null;
  });
  const validValues = series.filter((value) => Number.isFinite(value));
  const firstReliableIndex = series.findIndex((value) => Number.isFinite(value));

  if (validValues.length < 2) {
    drawPanelMessage(ctx, chartW, height, "CVD starts after live trade capture");
    return;
  }

  let min = Math.min(...validValues);
  let max = Math.max(...validValues);
  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.002, 1);
    min -= padding;
    max += padding;
  }
  const range = max - min;
  const barW = Math.max(2, chartW / candles.length);

  if (firstReliableIndex > 0) {
    ctx.fillStyle = "rgba(107, 114, 128, 0.12)";
    ctx.fillRect(0, 0, firstReliableIndex * barW, height);
    ctx.fillStyle = TEXT;
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("history backfill", 6, height - 4);
  }

  if (min < 0 && max > 0) {
    const zeroY = height - ((0 - min) / range) * height;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(chartW, zeroY);
    ctx.stroke();
  }

  drawGappedSeries(ctx, series, {
    barW,
    height,
    min,
    range,
    color: BLUE,
  });

  ctx.fillStyle = TEXT;
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fmtAxis(validValues.at(-1) ?? 0), chartW + 4, 2);
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
  const series = buildOISeries(candles);
  const values = series.filter((value) => Number.isFinite(value));
  const firstObservedIndex = series.findIndex((value) => Number.isFinite(value));
  if (values.length < 2) {
    drawPanelMessage(ctx, chartW, height, "Waiting for OI samples");
    return;
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.0005, 1);
    min -= padding;
    max += padding;
  }
  const range = max - min;
  const barW = chartW / candles.length;

  if (firstObservedIndex > 0) {
    ctx.fillStyle = "rgba(107, 114, 128, 0.12)";
    ctx.fillRect(0, 0, firstObservedIndex * barW, height);
  }

  drawGappedSeries(ctx, series, {
    barW,
    height,
    min,
    range,
    color: YELLOW,
  });

  ctx.fillStyle = TEXT;
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fmtAxis(values.at(-1) ?? 0), chartW + 4, 2);
}

function buildOISeries(candles) {
  let lastKnown = null;
  return candles.map((candle) => {
    const value = Number(candle?.oi);
    if (Number.isFinite(value) && value > 0) {
      lastKnown = value;
    }
    return lastKnown;
  });
}

function drawGappedSeries(ctx, values, { barW, height, min, range, color }) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();

  let drawing = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      drawing = false;
      continue;
    }

    const x = (index + 0.5) * barW;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    if (!drawing) {
      ctx.moveTo(x, y);
      drawing = true;
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

function drawPanelMessage(ctx, chartW, height, text) {
  ctx.fillStyle = TEXT;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, chartW / 2, height / 2);
}

function fmtAxis(value) {
  const numeric = Number(value) || 0;
  if (numeric > 0) return formatShortOriginalValue(numeric, 1);
  if (numeric < 0) return formatSignedShortOriginalValue(numeric, 1);
  return "0";
}
