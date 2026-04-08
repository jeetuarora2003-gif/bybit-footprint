import "./StatusBar.css";

function fmt(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(1);
}

export default function StatusBar({ crosshairData, status, liveCandle }) {
  const now = new Date();
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="status-bar">
      <div className="stb-left">
        {crosshairData ? (
          <span className="stb-info mono">
            Price: {crosshairData.price?.toFixed(1)}
          </span>
        ) : (
          <span className="stb-info">Crosshair</span>
        )}
        <span className="stb-sep">|</span>
        <span className="stb-info">
          CVD: <span style={{ color: liveCandle?.cvd >= 0 ? "var(--green)" : "var(--red)" }}>
            {liveCandle ? fmt(liveCandle.cvd) : "—"}
          </span>
        </span>
        <span className="stb-sep">|</span>
        <span className="stb-info">
          OI: {liveCandle?.oi ? fmt(liveCandle.oi) : "—"}
        </span>
      </div>

      <div className="stb-right">
        <span className="stb-dot" style={{ background: status === "connected" ? "var(--green)" : "var(--red)" }} />
        <span className="stb-info">{status}</span>
        <span className="stb-sep">|</span>
        <span className="stb-label">Reset</span>
        <span className="stb-label">Zoom On</span>
        <span className="stb-clock mono">{clock}</span>
      </div>
    </div>
  );
}
