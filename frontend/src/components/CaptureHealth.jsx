import { useEffect, useMemo, useState } from "react";
import "./CaptureHealth.css";

function formatAge(timestamp, now) {
  const numeric = Number(timestamp) || 0;
  if (!numeric) return "n/a";

  const delta = Math.max(0, now - numeric);
  if (delta < 1000) return `${delta}ms`;
  if (delta < 10_000) return `${(delta / 1000).toFixed(1)}s`;
  if (delta < 60_000) return `${Math.round(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  return `${Math.round(delta / 3_600_000)}h`;
}

function resolveHealthTone(status, captureStats, now) {
  if (status !== "connected") return "down";

  const tradeAge = now - (Number(captureStats?.lastTradeTimestamp) || 0);
  const depthAge = now - (Number(captureStats?.lastDepthTimestamp) || 0);
  const oiAge = now - (Number(captureStats?.lastTickerTimestamp) || 0);

  if (!Number(captureStats?.lastTradeTimestamp) || tradeAge > 6_000) return "stale";
  if (!Number(captureStats?.lastDepthTimestamp) || depthAge > 12_000) return "stale";
  if (!Number(captureStats?.lastTickerTimestamp) || oiAge > 20_000) return "stale";
  return "live";
}

function formatCompact(value) {
  const numeric = Number(value) || 0;
  return numeric.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

export default function CaptureHealth({ status, captureStats, liveCandle }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const tone = resolveHealthTone(status, captureStats, now);
  const coverage = useMemo(() => {
    const numeric = Number(liveCandle?.orderflow_coverage);
    if (!Number.isFinite(numeric)) return "n/a";
    return `${(numeric * 100).toFixed(1)}%`;
  }, [liveCandle?.orderflow_coverage]);

  return (
    <div className={`capture-health capture-health--${tone}`}>
      <div className="capture-health__summary">
        <span className="capture-health__kicker">Capture Health</span>
        <span className={`capture-health__badge capture-health__badge--${tone}`}>
          {tone === "live" ? "Feed healthy" : tone === "stale" ? "Feed stale" : "Feed disconnected"}
        </span>
        <span className="capture-health__text">
          Tape {formatAge(captureStats?.lastTradeTimestamp, now)} | Book {formatAge(captureStats?.lastDepthTimestamp, now)} | OI {formatAge(captureStats?.lastTickerTimestamp, now)}
        </span>
      </div>

      <div className="capture-health__metrics">
        <span className="capture-health__metric">Coverage {coverage}</span>
        <span className="capture-health__metric">Trades {formatCompact(captureStats?.tradeEvents)}</span>
        <span className="capture-health__metric">Depth events {formatCompact(captureStats?.depthEvents)}</span>
        <span className="capture-health__metric">Depth snaps {formatCompact(captureStats?.depthSnapshots)}</span>
        <span className="capture-health__metric">Reconnects {Number(captureStats?.reconnectCount) || 0}</span>
      </div>
    </div>
  );
}
