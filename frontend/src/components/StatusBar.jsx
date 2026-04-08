import "./StatusBar.css";

function fmt(value) {
  if (value == null) return "-";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(1);
}

export default function StatusBar({
  crosshairData,
  status,
  liveCandle,
  onResetView,
  onAutoFitView,
  settings,
}) {
  const now = new Date();
  const clock = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const hoveredPrice = crosshairData?.hoveredPrice ?? crosshairData?.close ?? crosshairData?.best_bid ?? crosshairData?.best_ask ?? null;

  return (
    <div className="status-bar">
      <div className="stb-left">
        {crosshairData ? (
          <span className="stb-info mono">
            Hover: {hoveredPrice != null ? hoveredPrice.toFixed(1) : "-"}
          </span>
        ) : (
          <span className="stb-info">Crosshair</span>
        )}
        <span className="stb-sep">|</span>
        <span className="stb-info">
          CVD: <span style={{ color: liveCandle?.cvd >= 0 ? "var(--green)" : "var(--red)" }}>
            {liveCandle ? fmt(liveCandle.cvd) : "-"}
          </span>
        </span>
        <span className="stb-sep">|</span>
        <span className="stb-info">
          OI: {liveCandle?.oi ? fmt(liveCandle.oi) : "-"}
        </span>
        <span className="stb-sep">|</span>
        <span className="stb-info">
          Mode: {settings.clusterMode}
        </span>
      </div>

      <div className="stb-right">
        <span className="stb-dot" style={{ background: status === "connected" ? "var(--green)" : "var(--red)" }} />
        <span className="stb-info">{status}</span>
        <span className="stb-sep">|</span>
        <button className="stb-action" onClick={onResetView}>Reset View</button>
        <button className="stb-action" onClick={onAutoFitView}>Fit Y</button>
        <span className="stb-clock mono">{clock}</span>
      </div>
    </div>
  );
}
