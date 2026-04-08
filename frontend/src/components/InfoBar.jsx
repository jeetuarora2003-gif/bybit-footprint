import "./InfoBar.css";

function fmt(value, digits = 1) {
  if (value == null || value === 0) return "-";
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPrice(value) {
  if (!value) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
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
  const current = candle;

  return (
    <div className="info-bar">
      <div className="ib-group">
        <span className="ib-label">O</span>
        <span className="ib-val">{current ? fmtPrice(current.open) : "-"}</span>
        <span className="ib-label">H</span>
        <span className="ib-val ib-green">{current ? fmtPrice(current.high) : "-"}</span>
        <span className="ib-label">L</span>
        <span className="ib-val ib-red">{current ? fmtPrice(current.low) : "-"}</span>
        <span className="ib-label">C</span>
        <span className="ib-val">{current ? fmtPrice(current.close) : "-"}</span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Vol:</span>
        <span className="ib-val">{current ? fmt(current.total_volume, 3) : "-"}</span>
        <span className="ib-label">Delta:</span>
        <span className="ib-val" style={{ color: current?.candle_delta >= 0 ? "var(--green)" : "var(--red)" }}>
          {current ? fmt(current.candle_delta, 3) : "-"}
        </span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Trades</span>
        <span className="ib-val ib-green">b:{current?.buy_trades ?? 0}</span>
        <span className="ib-val ib-red">s:{current?.sell_trades ?? 0}</span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">OI:</span>
        <span className="ib-val">{current?.oi ? fmt(current.oi, 1) : "-"}</span>
        <span className="ib-label">OI d:</span>
        <span className="ib-val" style={{ color: current?.oi_delta >= 0 ? "var(--green)" : "var(--red)" }}>
          {current?.oi_delta ? fmt(current.oi_delta, 2) : "-"}
        </span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Bid:</span>
        <span className="ib-val ib-green">
          {current?.best_bid ? `${fmtPrice(current.best_bid)} x ${fmt(current.best_bid_size, 3)}` : "-"}
        </span>
        <span className="ib-label">Ask:</span>
        <span className="ib-val ib-red">
          {current?.best_ask ? `${fmtPrice(current.best_ask)} x ${fmt(current.best_ask_size, 3)}` : "-"}
        </span>
      </div>

      <div className="ib-mode">
        {CLUSTER_LABELS[settings.clusterMode] ?? settings.clusterMode}
      </div>
    </div>
  );
}
