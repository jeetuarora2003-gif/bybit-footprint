import "./InfoBar.css";

function fmt(n, d = 1) {
  if (n == null || n === 0) return "—";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPrice(n) {
  if (!n) return "—";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const CLUSTER_LABELS = {
  void: "Void",
  volumeProfile: "Volume Profile",
  deltaProfile: "Delta Profile",
  bidAskProfile: "Bid-Ask Profile",
  volumeCluster: "Volume Cluster",
  deltaCluster: "Delta Cluster",
  deltaLadder: "Delta Ladder",
};

export default function InfoBar({ candle, settings }) {
  const c = candle;

  return (
    <div className="info-bar">
      {/* OHLC */}
      <div className="ib-group">
        <span className="ib-label">O</span>
        <span className="ib-val">{c ? fmtPrice(c.open) : "—"}</span>
        <span className="ib-label">H</span>
        <span className="ib-val ib-green">{c ? fmtPrice(c.high) : "—"}</span>
        <span className="ib-label">L</span>
        <span className="ib-val ib-red">{c ? fmtPrice(c.low) : "—"}</span>
        <span className="ib-label">C</span>
        <span className="ib-val">{c ? fmtPrice(c.close) : "—"}</span>
      </div>

      <div className="ib-sep" />

      {/* Volume + Delta */}
      <div className="ib-group">
        <span className="ib-label">Vol:</span>
        <span className="ib-val">{c ? fmt(c.total_volume, 3) : "—"}</span>
        <span className="ib-label">Δ:</span>
        <span className="ib-val" style={{ color: c?.candle_delta >= 0 ? "var(--green)" : "var(--red)" }}>
          {c ? fmt(c.candle_delta, 3) : "—"}
        </span>
      </div>

      <div className="ib-sep" />

      {/* Trade counts */}
      <div className="ib-group">
        <span className="ib-label">Trades</span>
        <span className="ib-val ib-green">b:{c?.buy_trades ?? 0}</span>
        <span className="ib-val ib-red">a:{c?.sell_trades ?? 0}</span>
      </div>

      <div className="ib-sep" />

      {/* OI */}
      <div className="ib-group">
        <span className="ib-label">OI:</span>
        <span className="ib-val">{c?.oi ? fmt(c.oi, 1) : "—"}</span>
        <span className="ib-label">ΔOI:</span>
        <span className="ib-val" style={{ color: c?.oi_delta >= 0 ? "var(--green)" : "var(--red)" }}>
          {c?.oi_delta ? fmt(c.oi_delta, 2) : "—"}
        </span>
      </div>

      <div className="ib-sep" />

      {/* Best bid/ask */}
      <div className="ib-group">
        <span className="ib-label">Bid:</span>
        <span className="ib-val ib-green">{c?.best_bid ? fmtPrice(c.best_bid) : "—"}</span>
        <span className="ib-label">Ask:</span>
        <span className="ib-val ib-red">{c?.best_ask ? fmtPrice(c.best_ask) : "—"}</span>
      </div>

      {/* Mode label */}
      <div className="ib-mode">
        {CLUSTER_LABELS[settings.clusterMode] ?? settings.clusterMode}
      </div>
    </div>
  );
}
