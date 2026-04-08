import "./StatusBar.css";
import {
  formatCompactValue,
  formatFootprintValue,
  formatPrice,
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
  const hoveredCluster = crosshairData?.hoveredCluster ?? null;

  return (
    <div className="status-bar">
      <div className="stb-left">
        {crosshairData ? (
          <span className="stb-info mono">
            Hover: {hoveredPrice != null ? formatPrice(hoveredPrice) : "-"}
          </span>
        ) : (
          <span className="stb-info">Crosshair</span>
        )}
        {hoveredCluster && (
          <>
            <span className="stb-sep">|</span>
            <span className="stb-info mono">
              Cell: <span style={{ color: "var(--red)" }}>{formatFootprintValue(hoveredCluster.sellVol) || "0"}</span>
              {" x "}
              <span style={{ color: "#42a5f5" }}>{formatFootprintValue(hoveredCluster.buyVol) || "0"}</span>
            </span>
            <span className="stb-sep">|</span>
            <span className="stb-info">
              Delta: <span style={{ color: hoveredCluster.delta >= 0 ? "#42a5f5" : "var(--red)" }}>
                {formatSignedCompactValue(hoveredCluster.delta, 2)}
              </span>
            </span>
          </>
        )}
        <span className="stb-sep">|</span>
        <span className="stb-info">
          CVD: <span style={{ color: liveCandle?.cvd >= 0 ? "#42a5f5" : "var(--red)" }}>
            {liveCandle ? formatSignedCompactValue(liveCandle.cvd, 2) : "-"}
          </span>
        </span>
        <span className="stb-sep">|</span>
        <span className="stb-info">
          OI: {liveCandle?.oi ? formatCompactValue(liveCandle.oi, 1) : "-"}
        </span>
        <span className="stb-sep">|</span>
        <span className="stb-info">
          Mode: {CLUSTER_LABELS[settings.clusterMode] ?? settings.clusterMode}
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
