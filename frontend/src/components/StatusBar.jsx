import "./StatusBar.css";
import {
  formatFootprintValue,
  formatOriginalValue,
  formatPrice,
  formatSignedOriginalValue,
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
  replay,
  onStartReplay,
  onStopReplay,
  onToggleReplayPlayback,
  onStepReplay,
  onCycleReplaySpeed,
}) {
  const now = new Date();
  const clock = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const hoveredPrice = crosshairData?.hoveredPrice ?? crosshairData?.close ?? crosshairData?.best_bid ?? crosshairData?.best_ask ?? null;
  const hoveredCluster = crosshairData?.hoveredCluster ?? null;
  const referenceCandle = crosshairData ?? liveCandle;
  const replayTime = replay?.enabled && liveCandle?.candle_open_time
    ? new Date(Number(liveCandle.candle_open_time)).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    : null;

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
              Ask/Bid: <span style={{ color: "var(--red)" }}>{formatFootprintValue(hoveredCluster.buyVol, { shortNumbers: settings?.shortNumbers }) || "0"}</span>
              {" x "}
              <span style={{ color: "#42a5f5" }}>{formatFootprintValue(hoveredCluster.sellVol, { shortNumbers: settings?.shortNumbers }) || "0"}</span>
            </span>
            <span className="stb-sep">|</span>
            <span className="stb-info">
              Delta: <span style={{ color: hoveredCluster.delta >= 0 ? "#42a5f5" : "var(--red)" }}>
                {formatSignedOriginalValue(hoveredCluster.delta, 3)}
              </span>
            </span>
          </>
        )}
        <span className="stb-sep">|</span>
        <span className="stb-info">
          CVD: <span style={{ color: referenceCandle?.cvd >= 0 ? "#42a5f5" : "var(--red)" }}>
            {referenceCandle ? formatSignedOriginalValue(referenceCandle.cvd, 3) : "-"}
          </span>
        </span>
        <span className="stb-sep">|</span>
        <span className="stb-info">
          OI: {referenceCandle?.oi != null ? formatOriginalValue(referenceCandle.oi, 3) : "-"}
        </span>
        <span className="stb-sep">|</span>
        <span className="stb-info">
          Mode: {CLUSTER_LABELS[settings.clusterMode] ?? settings.clusterMode}
        </span>
        {replay?.enabled && (
          <>
            <span className="stb-sep">|</span>
            <span className="stb-info">Replay: {replay.playing ? "playing" : "paused"} {replayTime ? `@ ${replayTime}` : ""}</span>
          </>
        )}
      </div>

      <div className="stb-right">
        <span className="stb-dot" style={{ background: status === "connected" ? "var(--green)" : "var(--red)" }} />
        <span className="stb-info">{status}</span>
        <span className="stb-sep">|</span>
        {replay?.enabled ? (
          <>
            <button className="stb-action" onClick={onStopReplay}>Exit Replay</button>
            <button className="stb-action" onClick={() => onStepReplay(-1)}>{"<"}</button>
            <button className="stb-action" onClick={onToggleReplayPlayback}>
              {replay.playing ? "Pause" : "Play"}
            </button>
            <button className="stb-action" onClick={() => onStepReplay(1)}>{">"}</button>
            <button className="stb-action" onClick={onCycleReplaySpeed}>{replay.speed}x</button>
            <span className="stb-sep">|</span>
          </>
        ) : (
          <>
            <button className="stb-action" onClick={onStartReplay}>Replay</button>
            <span className="stb-sep">|</span>
          </>
        )}
        <button className="stb-action" onClick={onResetView}>Reset View</button>
        <button className="stb-action" onClick={onAutoFitView}>Fit Y</button>
        <span className="stb-clock mono">{clock}</span>
      </div>
    </div>
  );
}
