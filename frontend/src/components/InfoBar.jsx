import "./InfoBar.css";
import {
  formatFootprintValue,
  formatOriginalValue,
  formatPrice,
  formatRange,
  formatSignedOriginalValue,
} from "../utils/exoFormat";
import { summarizeCandleImbalance } from "../utils/orderflow";

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
  const imbalance = summarizeCandleImbalance(current);

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
        <span className="ib-val">{current ? formatOriginalValue(current.total_volume, 3) : "-"}</span>
        <span className="ib-label">Delta:</span>
        <span className="ib-val" style={{ color: current?.candle_delta >= 0 ? "#42a5f5" : "var(--red)" }}>
          {current ? formatSignedOriginalValue(current.candle_delta, 3) : "-"}
        </span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Imb:</span>
        <span className="ib-val" style={{ color: imbalance ? "var(--red)" : "#6b7280" }}>
          {imbalance ? formatFootprintValue(imbalance.value, { shortNumbers: settings?.shortNumbers }) : "-"}
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
        <span className="ib-val">{current?.oi != null ? formatOriginalValue(current.oi, 3) : "-"}</span>
        <span className="ib-label">OI d:</span>
        <span className="ib-val" style={{ color: current?.oi_delta >= 0 ? "#42a5f5" : "var(--red)" }}>
          {current?.oi_delta != null ? formatSignedOriginalValue(current.oi_delta, 3) : "-"}
        </span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Bid:</span>
        <span className="ib-val" style={{ color: "#42a5f5" }}>
          {current?.best_bid ? `${formatPrice(current.best_bid)} x ${formatOriginalValue(current.best_bid_size, 3)}` : "-"}
        </span>
        <span className="ib-label">Ask:</span>
        <span className="ib-val ib-red">
          {current?.best_ask ? `${formatPrice(current.best_ask)} x ${formatOriginalValue(current.best_ask_size, 3)}` : "-"}
        </span>
      </div>

      <div className="ib-mode">
        {CLUSTER_LABELS[settings.clusterMode] ?? settings.clusterMode}
      </div>
    </div>
  );
}
