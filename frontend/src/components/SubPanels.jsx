import { useEffect, useMemo, useRef, useState } from "react";
import "./SubPanels.css";
import {
  frameOpenTime,
  normalizeTimeframe,
  timeframeDurationMs,
} from "../market/aggregate";
import {
  formatShortOriginalValue,
  formatSignedShortOriginalValue,
} from "../utils/exoFormat";

const PANEL_BG = "#0c1118";
const PANEL_SHADE = "rgba(15, 23, 42, 0.52)";
const GRID = "rgba(148, 163, 184, 0.18)";
const GRID_SOFT = "rgba(148, 163, 184, 0.1)";
const TEXT = "#7b8494";
const BLUE = "#42a5f5";
const YELLOW = "#d89a00";
const VOLUME_BAR = "rgba(148, 163, 184, 0.34)";
const VOLUME_BAR_HIGHLIGHT = "rgba(203, 213, 225, 0.54)";
const CVD_AXIS_W = 80;
const OI_LEFT_AXIS_W = 86;
const OI_RIGHT_AXIS_W = 74;
const OI_TIMEFRAME_STORAGE_KEY = "bybit-footprint:oi-panel-timeframe:v1";
const REFERENCE_TIMESTAMP = Date.UTC(2026, 0, 15, 12, 0, 0);
const OI_TIMEFRAME_OPTIONS = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "12h", label: "12h" },
  { value: "D", label: "1D" },
];

export default function SubPanels({ candles, activeFeatures, timeframe = "1m" }) {
  const cvdRef = useRef(null);
  const oiRef = useRef(null);
  const showCVD = true;
  const showOI = Boolean(activeFeatures?.has?.("oi"));
  const [oiPanelTimeframe, setOiPanelTimeframe] = useState(loadStoredOITimeframe);

  const oiOptions = useMemo(
    () => OI_TIMEFRAME_OPTIONS.map((option) => ({
      ...option,
      disabled: !canAggregateToTimeframe(timeframe, option.value),
    })),
    [timeframe],
  );

  const resolvedOITimeframe = useMemo(
    () => resolveOITimeframe(oiPanelTimeframe, timeframe),
    [oiPanelTimeframe, timeframe],
  );

  const oiDataset = useMemo(
    () => buildOIPanelDataset(candles, timeframe, resolvedOITimeframe),
    [candles, timeframe, resolvedOITimeframe],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        OI_TIMEFRAME_STORAGE_KEY,
        JSON.stringify(resolvedOITimeframe),
      );
    } catch {
      // Panel preferences are best effort only.
    }
  }, [resolvedOITimeframe]);

  useEffect(() => {
    const redraw = () => {
      if (showCVD) drawCVDPanel(cvdRef.current, candles);
      if (showOI) drawOIPanel(oiRef.current, oiDataset);
    };

    redraw();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", redraw);
      return () => window.removeEventListener("resize", redraw);
    }
    return undefined;
  }, [candles, oiDataset, showCVD, showOI]);

  const latestOIRow = oiDataset.bars.at(-1);
  const oiSubtitle = latestOIRow
    ? `${resolvedOITimeframe === normalizeTimeframe(timeframe) ? "Live" : "Derived"} ${formatTimeframeLabel(resolvedOITimeframe)}`
      + ` | OI ${formatShortOriginalValue(latestOIRow.oi ?? 0, 2)}`
      + ` | Vol ${formatShortOriginalValue(latestOIRow.volume ?? 0, 1)}`
    : `${resolvedOITimeframe === normalizeTimeframe(timeframe) ? "Live" : "Derived"} ${formatTimeframeLabel(resolvedOITimeframe)} OI`;

  return (
    <div className="sub-panels">
      {showOI && (
        <section className="sub-panel sub-panel--oi" style={{ height: 232 }}>
          <div className="sub-panel-card">
            <div className="sub-panel-card-header">
              <div className="sub-panel-heading">
                <h3 className="sub-panel-title">Open interest</h3>
                <p className="sub-panel-subtitle">{oiSubtitle}</p>
              </div>
              <div className="sub-panel-pills" aria-label="Open interest timeframe">
                {oiOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={[
                      "sub-pill",
                      resolvedOITimeframe === option.value ? "sub-pill--active" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => !option.disabled && setOiPanelTimeframe(option.value)}
                    disabled={option.disabled}
                    title={option.disabled ? `Current ${formatTimeframeLabel(timeframe)} chart cannot derive ${option.label} cleanly` : `Show ${option.label} OI panel`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sub-panel-plot">
              <canvas ref={oiRef} className="sub-canvas" />
            </div>
          </div>
        </section>
      )}

      {showCVD && (
        <section className="sub-panel sub-panel--cvd" style={{ height: 74 }}>
          <div className="sub-panel-card sub-panel-card--compact">
            <div className="sub-panel-card-header sub-panel-card-header--compact">
              <div className="sub-panel-heading">
                <h3 className="sub-panel-title sub-panel-title--compact">CVD</h3>
              </div>
            </div>
            <div className="sub-panel-plot sub-panel-plot--compact">
              <canvas ref={cvdRef} className="sub-canvas" />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function drawCVDPanel(canvas, candles) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const width = parent?.clientWidth || 0;
  const height = parent?.clientHeight || 0;
  if (!width || !height) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(0, 0, width, height);

  const padding = {
    top: 8,
    right: CVD_AXIS_W,
    bottom: 10,
    left: 10,
  };
  const plot = {
    left: padding.left,
    top: padding.top,
    width: Math.max(20, width - padding.left - padding.right),
    height: Math.max(10, height - padding.top - padding.bottom),
  };

  if (candles.length < 2) {
    drawPanelMessage(ctx, plot, "CVD starts after live trade capture");
    return;
  }

  const series = candles.map((candle) => {
    const reliable = Number(candle?.orderflow_coverage ?? 0) >= 0.999;
    const value = Number(candle?.cvd);
    return reliable && Number.isFinite(value) ? value : null;
  });
  const validValues = series.filter((value) => Number.isFinite(value));
  const firstReliableIndex = series.findIndex((value) => Number.isFinite(value));

  if (validValues.length < 2) {
    drawPanelMessage(ctx, plot, "CVD starts after live trade capture");
    return;
  }

  let min = Math.min(...validValues);
  let max = Math.max(...validValues);
  if (min === max) {
    const paddingRange = Math.max(Math.abs(max) * 0.002, 1);
    min -= paddingRange;
    max += paddingRange;
  }
  const range = max - min || 1;
  const barW = plot.width / Math.max(1, candles.length);

  if (firstReliableIndex > 0) {
    ctx.fillStyle = PANEL_SHADE;
    ctx.fillRect(plot.left, plot.top, firstReliableIndex * barW, plot.height);
    ctx.fillStyle = TEXT;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("history backfill", plot.left + 6, plot.top + plot.height - 4);
  }

  drawCompactGrid(ctx, plot, 3);

  if (min < 0 && max > 0) {
    const zeroY = plot.top + plot.height - ((0 - min) / range) * plot.height;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.left, zeroY);
    ctx.lineTo(plot.left + plot.width, zeroY);
    ctx.stroke();
  }

  const points = [];
  for (let index = 0; index < series.length; index += 1) {
    const value = series[index];
    if (!Number.isFinite(value)) continue;
    points.push({
      x: plot.left + (index + 0.5) * barW,
      y: plot.top + plot.height - ((value - min) / range) * plot.height,
    });
  }

  drawSmoothSeries(ctx, points, BLUE, 1.5);

  ctx.fillStyle = TEXT;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fmtAxis(validValues.at(-1) ?? 0), plot.left + plot.width + 8, plot.top + 4);
}

function drawOIPanel(canvas, dataset) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const width = parent?.clientWidth || 0;
  const height = parent?.clientHeight || 0;
  if (!width || !height) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(0, 0, width, height);

  const padding = {
    top: 12,
    left: OI_LEFT_AXIS_W,
    right: OI_RIGHT_AXIS_W,
    bottom: 28,
  };
  const plot = {
    left: padding.left,
    top: padding.top,
    width: Math.max(24, width - padding.left - padding.right),
    height: Math.max(40, height - padding.top - padding.bottom),
  };

  const bars = dataset?.bars || [];
  if (bars.length < 2) {
    drawPanelMessage(ctx, plot, "Waiting for OI samples");
    return;
  }

  const oiValues = bars.map((bar) => bar.oi).filter((value) => Number.isFinite(value));
  if (oiValues.length < 2) {
    drawPanelMessage(ctx, plot, "Waiting for OI samples");
    return;
  }

  const firstObservedIndex = bars.findIndex((bar) => Number.isFinite(bar.oi));
  const volumes = bars.map((bar) => Math.max(0, Number(bar.volume) || 0));
  const maxVolume = Math.max(...volumes, 0);

  let minOI = Math.min(...oiValues);
  let maxOI = Math.max(...oiValues);
  if (minOI === maxOI) {
    const pad = Math.max(Math.abs(maxOI) * 0.0015, 1);
    minOI -= pad;
    maxOI += pad;
  }
  const oiRange = maxOI - minOI || 1;
  const volumeScaleMax = maxVolume > 0 ? maxVolume * 1.15 : 1;
  const barW = Math.max(3, Math.min(18, (plot.width / Math.max(1, bars.length)) * 0.74));

  if (firstObservedIndex > 0) {
    const missingWidth = (plot.width / bars.length) * firstObservedIndex;
    ctx.fillStyle = PANEL_SHADE;
    ctx.fillRect(plot.left, plot.top, missingWidth, plot.height);
  }

  drawOIGuides(ctx, plot, minOI, maxOI, volumeScaleMax);
  drawVolumeBars(ctx, plot, bars, barW, volumeScaleMax);

  const linePoints = [];
  bars.forEach((bar, index) => {
    if (!Number.isFinite(bar.oi)) return;
    linePoints.push({
      x: plot.left + (index / Math.max(1, bars.length - 1)) * plot.width,
      y: plot.top + plot.height - ((bar.oi - minOI) / oiRange) * plot.height,
    });
  });

  drawSmoothSeries(ctx, linePoints, YELLOW, 2);
  drawFinalPoint(ctx, linePoints.at(-1), YELLOW);
  drawTimeAxis(ctx, plot, bars, dataset.timeframe);
}

function buildOIPanelDataset(candles, chartTimeframe, panelTimeframe) {
  const resolvedTimeframe = resolveOITimeframe(panelTimeframe, chartTimeframe);
  const baseTimeframe = normalizeTimeframe(chartTimeframe);
  const sourceBars = resolvedTimeframe === baseTimeframe
    ? candles
    : aggregateOIBars(candles, resolvedTimeframe);

  let lastKnownOI = null;
  const bars = sourceBars.map((bar) => {
    const rawOI = Number(bar?.oi);
    if (Number.isFinite(rawOI) && rawOI > 0) {
      lastKnownOI = rawOI;
    }
    return {
      candle_open_time: Number(bar?.candle_open_time) || 0,
      oi: lastKnownOI,
      volume: Math.max(0, Number(bar?.total_volume) || 0),
    };
  }).filter((bar) => bar.candle_open_time > 0);

  return {
    timeframe: resolvedTimeframe,
    bars,
  };
}

function aggregateOIBars(candles, timeframe) {
  const normalizedTimeframe = normalizeTimeframe(timeframe);
  if (!candles?.length) return [];

  const frames = [];
  let current = null;

  for (const candle of candles) {
    const openTime = frameOpenTime(candle?.candle_open_time, normalizedTimeframe);
    if (!openTime) continue;

    if (!current || current.candle_open_time !== openTime) {
      current = {
        candle_open_time: openTime,
        oi: null,
        total_volume: 0,
      };
      frames.push(current);
    }

    current.total_volume += Math.max(0, Number(candle?.total_volume) || 0);
    const oi = Number(candle?.oi);
    if (Number.isFinite(oi) && oi > 0) {
      current.oi = oi;
    }
  }

  return frames;
}

function canAggregateToTimeframe(chartTimeframe, targetTimeframe) {
  const base = normalizeTimeframe(chartTimeframe);
  const target = normalizeTimeframe(targetTimeframe);
  if (base === target) return true;

  const baseMs = timeframeDurationMs(base, REFERENCE_TIMESTAMP);
  const targetMs = timeframeDurationMs(target, REFERENCE_TIMESTAMP);
  if (!Number.isFinite(baseMs) || !Number.isFinite(targetMs)) return false;
  if (targetMs < baseMs) return false;
  return targetMs % baseMs === 0;
}

function resolveOITimeframe(requestedTimeframe, chartTimeframe) {
  const requested = normalizeTimeframe(requestedTimeframe || "15m");
  if (canAggregateToTimeframe(chartTimeframe, requested)) {
    return requested;
  }
  const fallback = OI_TIMEFRAME_OPTIONS.find((option) => canAggregateToTimeframe(chartTimeframe, option.value));
  return fallback?.value || normalizeTimeframe(chartTimeframe);
}

function drawCompactGrid(ctx, plot, lines = 3) {
  ctx.save();
  ctx.strokeStyle = GRID_SOFT;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  for (let index = 0; index < lines; index += 1) {
    const y = plot.top + (plot.height / Math.max(1, lines - 1)) * index;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOIGuides(ctx, plot, minOI, maxOI, volumeScaleMax) {
  const guideCount = 4;
  ctx.save();
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  for (let index = 0; index < guideCount; index += 1) {
    const ratio = index / Math.max(1, guideCount - 1);
    const y = plot.top + plot.height * ratio;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.width, y);
    ctx.stroke();

    const oiValue = maxOI - (maxOI - minOI) * ratio;
    const volumeValue = volumeScaleMax * (1 - ratio);

    ctx.fillStyle = TEXT;
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatShortOriginalValue(oiValue, 2), plot.left - 10, y);

    ctx.textAlign = "left";
    ctx.fillText(index === guideCount - 1 ? "0" : formatShortOriginalValue(volumeValue, 2), plot.left + plot.width + 10, y);
  }

  ctx.restore();
}

function drawVolumeBars(ctx, plot, bars, barW, volumeScaleMax) {
  if (!bars.length || volumeScaleMax <= 0) return;

  const stepX = bars.length > 1 ? plot.width / (bars.length - 1) : plot.width;
  for (let index = 0; index < bars.length; index += 1) {
    const volume = Math.max(0, Number(bars[index]?.volume) || 0);
    if (volume <= 0) continue;
    const x = plot.left + stepX * index;
    const height = Math.max(2, (volume / volumeScaleMax) * plot.height);
    const y = plot.top + plot.height - height;
    ctx.fillStyle = index === bars.length - 1 ? VOLUME_BAR_HIGHLIGHT : VOLUME_BAR;
    ctx.fillRect(x - barW / 2, y, barW, height);
  }
}

function drawSmoothSeries(ctx, points, color, lineWidth) {
  if (!points?.length) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 1) {
    ctx.lineTo(points[0].x, points[0].y);
  } else if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  ctx.stroke();
  ctx.restore();
}

function drawFinalPoint(ctx, point, color) {
  if (!point) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTimeAxis(ctx, plot, bars, timeframe) {
  if (!bars.length) return;
  const labelSlots = Math.min(5, Math.max(2, Math.floor(plot.width / 130)));
  const used = new Set();

  ctx.save();
  ctx.fillStyle = TEXT;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let slot = 0; slot < labelSlots; slot += 1) {
    const index = Math.round((slot / Math.max(1, labelSlots - 1)) * (bars.length - 1));
    if (used.has(index)) continue;
    used.add(index);
    const bar = bars[index];
    const x = plot.left + (index / Math.max(1, bars.length - 1)) * plot.width;
    ctx.fillText(formatTimeAxisLabel(bar?.candle_open_time, timeframe), x, plot.top + plot.height + 8);
  }

  ctx.restore();
}

function drawPanelMessage(ctx, plot, text) {
  ctx.fillStyle = TEXT;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, plot.left + plot.width / 2, plot.top + plot.height / 2);
}

function formatTimeAxisLabel(timestamp, timeframe) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (timeframe === "D") {
    return date.toLocaleDateString([], { day: "2-digit", month: "short" });
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTimeframeLabel(timeframe) {
  const lookup = OI_TIMEFRAME_OPTIONS.find((option) => option.value === timeframe);
  if (lookup) return lookup.label;
  return String(timeframe || "");
}

function loadStoredOITimeframe() {
  if (typeof window === "undefined") return "15m";
  try {
    const raw = window.localStorage.getItem(OI_TIMEFRAME_STORAGE_KEY);
    if (!raw) return "15m";
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : "15m";
  } catch {
    return "15m";
  }
}

function fmtAxis(value) {
  const numeric = Number(value) || 0;
  if (numeric > 0) return formatShortOriginalValue(numeric, 1);
  if (numeric < 0) return formatSignedShortOriginalValue(numeric, 1);
  return "0";
}
