import "./InfoBar.css";
import {
  formatCompactValue,
  formatFootprintValue,
  formatPrice,
  formatSignedCompactValue,
  formatShortOriginalValue,
  formatSignedShortOriginalValue,
} from "../utils/exoFormat";
import { summarizeCandleImbalance, summarizeStudySignals } from "../utils/orderflow";

const CLUSTER_LABELS = {
  void: "Void",
  volumeProfile: "Volume Profile",
  deltaProfile: "Delta Profile",
  bidAskProfile: "Bid-Ask Profile",
  volumeCluster: "Volume Cluster",
  deltaCluster: "Delta Cluster",
  deltaLadder: "Delta Ladder",
};

export default function InfoBar({ candle, settings, instrument, marketContext }) {
  const current = candle;
  const hasReliableOrderflow = Number(current?.orderflow_coverage ?? 0) >= 0.999;
  const imbalance = hasReliableOrderflow ? summarizeCandleImbalance(current) : null;
  const studySignals = hasReliableOrderflow ? summarizeStudySignals(current).slice(0, 3) : [];
  const sessionQuality = marketContext?.session?.quality?.label || "-";

  return (
    <div className="info-bar">
      <div className="ib-group">
        <span className="ib-label">Sym</span>
        <span className="ib-val">{instrument?.symbol || settings.symbol || "-"}</span>
        <span className="ib-label">Tick</span>
        <span className="ib-val">{settings.baseRowSize || instrument?.tickSize || "-"}</span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">O</span>
        <span className="ib-val">{current ? formatPrice(current.open) : "-"}</span>
        <span className="ib-label">H</span>
        <span className="ib-val ib-green">{current ? formatPrice(current.high) : "-"}</span>
        <span className="ib-label">L</span>
        <span className="ib-val ib-red">{current ? formatPrice(current.low) : "-"}</span>
        <span className="ib-label">C</span>
        <span className="ib-val">{current ? formatPrice(current.close) : "-"}</span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Vol</span>
        <span className="ib-val">{current ? formatCompactValue(current.total_volume) : "-"}</span>
        <span className="ib-label">D</span>
        <span className="ib-val" style={{ color: current?.candle_delta >= 0 ? "#42a5f5" : "var(--red)" }}>
          {current ? (hasReliableOrderflow ? formatSignedCompactValue(current.candle_delta) : "-") : "-"}
        </span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Imb</span>
        <span className="ib-val" style={{ color: imbalance ? "var(--red)" : "#6b7280" }}>
          {imbalance ? formatFootprintValue(imbalance.value, { shortNumbers: settings?.shortNumbers }) : "-"}
        </span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Trades</span>
        <span className="ib-val ib-red">b:{current ? formatCompactValue(current.sell_volume ?? 0) : "-"}</span>
        <span className="ib-val ib-green">a:{current ? formatCompactValue(current.buy_volume ?? 0) : "-"}</span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">OI:</span>
        <span className="ib-val">{current?.oi != null ? formatShortOriginalValue(current.oi, 1) : "-"}</span>
        <span className="ib-label">OI d:</span>
        <span className="ib-val" style={{ color: current?.oi_delta >= 0 ? "#42a5f5" : "var(--red)" }}>
          {current?.oi_delta != null ? formatSignedShortOriginalValue(current.oi_delta, 1) : "-"}
        </span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Signals</span>
        <span className="ib-val">{studySignals.length ? studySignals.join(" ") : "-"}</span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Session</span>
        <span className="ib-val">{sessionQuality}</span>
      </div>

      <div className="ib-sep" />

      <div className="ib-group">
        <span className="ib-label">Bid:</span>
        <span className="ib-val" style={{ color: "#42a5f5" }}>
          {current?.best_bid ? `${formatPrice(current.best_bid)} x ${formatCompactValue(current.best_bid_size)}` : "-"}
        </span>
        <span className="ib-label">Ask:</span>
        <span className="ib-val ib-red">
          {current?.best_ask ? `${formatPrice(current.best_ask)} x ${formatCompactValue(current.best_ask_size)}` : "-"}
        </span>
      </div>

      <div className="ib-mode">
        {CLUSTER_LABELS[settings.clusterMode] ?? settings.clusterMode}
      </div>
    </div>
  );
}
