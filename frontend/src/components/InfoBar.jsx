import "./InfoBar.css";
import {
  formatCompactValue,
  formatPrice,
  formatRange,
  formatSignedCompactValue,
} from "../utils/exoFormat";

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
        <span className="ib-val">{current ? formatPrice(current.open) : "-"}</span>
        <span className="ib-label">H</span>
        <span className="ib-val ib-green">{current ? formatPrice(current.high) : "-"}</span>
        <span className="ib-label">L</span>
        <span className="ib-val ib-red">{current ? formatPrice(current.low) : "-"}</span>
        <span className="ib-label">C</span>
        <span className="ib-val">{current ? formatPrice(current.close) : "-"}</span>
        <span className="ib-label">R</span>
        <span className="ib-val">{current ? formatRange(current.low, current.high) : "-"}</span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Vol:</span>
        <span className="ib-val">{current ? formatCompactValue(current.total_volume, 2) : "-"}</span>
        <span className="ib-label">Delta:</span>
        <span className="ib-val" style={{ color: current?.candle_delta >= 0 ? "#42a5f5" : "var(--red)" }}>
          {current ? formatSignedCompactValue(current.candle_delta, 2) : "-"}
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
        <span className="ib-val">{current?.oi ? formatCompactValue(current.oi, 1) : "-"}</span>
        <span className="ib-label">OI d:</span>
        <span className="ib-val" style={{ color: current?.oi_delta >= 0 ? "#42a5f5" : "var(--red)" }}>
          {current?.oi_delta ? formatSignedCompactValue(current.oi_delta, 2) : "-"}
        </span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Bid:</span>
        <span className="ib-val" style={{ color: "#42a5f5" }}>
          {current?.best_bid ? `${formatPrice(current.best_bid)} x ${formatCompactValue(current.best_bid_size, 2)}` : "-"}
        </span>
        <span className="ib-label">Ask:</span>
        <span className="ib-val ib-red">
          {current?.best_ask ? `${formatPrice(current.best_ask)} x ${formatCompactValue(current.best_ask_size, 2)}` : "-"}
        </span>
      </div>

      <div className="ib-mode">
        {CLUSTER_LABELS[settings.clusterMode] ?? settings.clusterMode}
      </div>
    </div>
  );
}
