import "./Toolbar.css";
import { MODE_PRESETS } from "./chart/modeRules";

const CLUSTER_MODES = [
  { value: "void", label: "Void" },
  { value: "volumeProfile", label: "Volume Profile" },
  { value: "deltaProfile", label: "Delta Profile" },
  { value: "bidAskProfile", label: "Bid-Ask Profile" },
  { value: "volumeCluster", label: "Volume Cluster" },
  { value: "deltaCluster", label: "Delta Cluster" },
  { value: "deltaLadder", label: "Delta Ladder" },
];

const DATA_VIEWS = [
  { value: "none", label: "None" },
  { value: "volume", label: "Volume" },
  { value: "delta", label: "Delta" },
  { value: "bidAsk", label: "Bid-Ask" },
  { value: "imbalance", label: "Imbalance" },
];

const CANDLE_STYLES = [
  { value: "none", label: "None" },
  { value: "monoCandle", label: "Mono Candle" },
  { value: "monoBox", label: "Mono Box" },
  { value: "colorCandle", label: "Color Candle" },
  { value: "colorBox", label: "Color Box" },
  { value: "borderedCandle", label: "Bordered Candle" },
  { value: "flatCandle", label: "Flat Candle" },
  { value: "ohlc", label: "OHLC" },
  { value: "oc", label: "OC" },
  { value: "hl", label: "HL" },
  { value: "embed", label: "Embed" },
];

const TIMEFRAMES = [
  { value: "1m", label: "1 minute" },
  { value: "2m", label: "2 minutes" },
  { value: "3m", label: "3 minutes" },
  { value: "5m", label: "5 minutes" },
  { value: "10m", label: "10 minutes" },
  { value: "15m", label: "15 minutes" },
  { value: "30m", label: "30 minutes" },
];

const TICK_SIZES = [
  { value: "1", label: "Tick x 1" },
  { value: "5", label: "Tick x 5" },
  { value: "10", label: "Tick x 10" },
  { value: "25", label: "Tick x 25" },
  { value: "50", label: "Tick x 50" },
  { value: "100", label: "Tick x 100" },
];

const SHADING_MODES = [
  { value: "current", label: "Current Rotation" },
  { value: "adaptive", label: "Adaptive" },
];

const FEATURE_TABS = [
  { key: "vol", label: "Vol", supported: true },
  { key: "tcount", label: "TCount", supported: true },
  { key: "rekt", label: "Rekt", supported: false },
  { key: "fpbs", label: "FPBS", supported: true },
  { key: "tsize", label: "TSize", supported: true },
  { key: "cs", label: "CS", supported: true },
  { key: "dbars", label: "DBars", supported: true },
  { key: "oi", label: "OI", supported: true },
  { key: "hl", label: "HL", supported: true },
  { key: "ns", label: "NS", supported: false },
  { key: "vwap", label: "VWAP", supported: true },
];

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="tb-select">
      {label && <span className="tb-select-label">{label}</span>}
      <select
        className="tb-select-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Toolbar({
  settings,
  updateSetting,
  status,
  instrument,
  captureStats,
  activeFeatureArr,
  toggleFeature,
  onApplyPreset,
  onResetWorkspace,
  replay,
  onStartReplay,
  onStopReplay,
  onToggleReplayPlayback,
  onStepReplay,
  onCycleReplaySpeed,
}) {
  const tickOptions = (instrument?.defaultTicks || [1, 5, 10, 25, 50, 100]).map((value) => ({
    value: String(value),
    label: `Tick x ${value}`,
  }));

  const applyClusterMode = (value) => {
    updateSetting("clusterMode", value);
    const preset = MODE_PRESETS[value];
    if (preset) {
      Object.entries(preset).forEach(([key, presetValue]) => {
        updateSetting(key, presetValue);
      });
    }
  };

  const editSymbol = () => {
    const nextSymbol = window.prompt("Enter a Bybit linear symbol", settings.symbol || instrument?.symbol || "BTCUSDT");
    if (!nextSymbol) return;
    updateSetting("symbol", nextSymbol.trim().toUpperCase());
  };

  return (
    <div className="toolbar">
      <div className="tb-left">
        <button type="button" className="tb-btn tb-btn--accent" onClick={onApplyPreset}>Classic</button>
        <button type="button" className="tb-btn" onClick={onResetWorkspace}>Reset</button>
        <div className="tb-sep" />

        <button type="button" className="tb-btn" onClick={editSymbol} title="Change symbol">
          <span className="tb-exchange">Bybit:</span> {settings.symbol || instrument?.symbol || "BTCUSDT"}
        </button>
        <div className="tb-sep" />

        <SelectField
          value={settings.timeframe || "1m"}
          options={TIMEFRAMES}
          onChange={(value) => updateSetting("timeframe", value)}
        />
        <div className="tb-sep" />

        <SelectField
          value={settings.tickSize || "1"}
          options={tickOptions.length ? tickOptions : TICK_SIZES}
          onChange={(value) => updateSetting("tickSize", value)}
        />
        <div className="tb-sep" />

        <SelectField
          label="Cluster"
          value={settings.clusterMode}
          options={CLUSTER_MODES}
          onChange={applyClusterMode}
        />
        <SelectField
          label="Shading"
          value={settings.shadingMode || "current"}
          options={SHADING_MODES}
          onChange={(value) => updateSetting("shadingMode", value)}
        />
        <SelectField
          label="Text"
          value={settings.dataView}
          options={DATA_VIEWS}
          onChange={(value) => updateSetting("dataView", value)}
        />
        <SelectField
          label="Candle"
          value={settings.candleStyle}
          options={CANDLE_STYLES}
          onChange={(value) => updateSetting("candleStyle", value)}
        />
      </div>

      <div className="tb-center">
        {FEATURE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={[
              "tb-tab",
              activeFeatureArr.includes(tab.key) ? "tb-tab--active" : "",
              !tab.supported ? "tb-tab--disabled" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => tab.supported && toggleFeature(tab.key)}
            disabled={!tab.supported}
            title={tab.supported ? tab.label : `${tab.label} requires data not wired yet`}
          >
            {tab.label}
          </button>
        ))}
        <div className="tb-sep" style={{ margin: "0 4px" }} />
        <button
          type="button"
          className={`tb-tab${settings.showDOM ? " tb-tab--active" : ""}`}
          onClick={() => updateSetting("showDOM", !settings.showDOM)}
        >
          DOM
        </button>
        <button
          type="button"
          className={`tb-tab${settings.showHeatmap ? " tb-tab--active" : ""}`}
          onClick={() => updateSetting("showHeatmap", !settings.showHeatmap)}
        >
          Heat
        </button>
        <button
          type="button"
          className={`tb-tab${settings.shortNumbers ? " tb-tab--active" : ""}`}
          onClick={() => updateSetting("shortNumbers", !settings.shortNumbers)}
          title="Short numbers for footprint text"
        >
          Short#
        </button>
      </div>

      <div className="tb-right">
        <button
          type="button"
          className={`tb-btn tb-btn--lens${settings.decisionLens ? " tb-btn--active" : ""}`}
          onClick={() => updateSetting("decisionLens", !settings.decisionLens)}
          title="Decision Lens toggle"
        >
          Decision Lens
        </button>
        <div className="tb-sep" />
        {replay?.enabled ? (
          <>
            <button type="button" className="tb-btn tb-btn--accent" onClick={onStopReplay}>Exit Replay</button>
            <button type="button" className="tb-btn tb-btn--icon" onClick={() => onStepReplay(-1)}>{"<"}</button>
            <button type="button" className="tb-btn tb-btn--icon" onClick={onToggleReplayPlayback}>
              {replay.playing ? "Pause" : "Play"}
            </button>
            <button type="button" className="tb-btn tb-btn--icon" onClick={() => onStepReplay(1)}>{">"}</button>
            <button type="button" className="tb-btn" onClick={onCycleReplaySpeed}>{replay.speed}x</button>
            <div className="tb-sep" />
          </>
        ) : (
          <>
            <button
              type="button"
              className="tb-btn"
              onClick={onStartReplay}
              disabled={!replay?.available}
              title={replay?.available ? "Replay recent raw market events" : "Replay unlocks after enough raw events are cached"}
            >
              Replay
            </button>
            <div className="tb-sep" />
          </>
        )}
        <span
          className="tb-btn tb-btn--static mono"
          title={`Tick ${instrument?.tickSize || settings.baseRowSize} | trades ${captureStats?.tradeEvents || 0} | depth events ${captureStats?.depthEvents || 0}`}
        >
          {instrument?.tickSize ? `tick ${instrument.tickSize}` : "tick ?"}
        </span>
        <span className="tb-btn tb-btn--static mono">
          {settings.clusterMode}
        </span>
        <div
          className={`tb-status-dot ${status === "connected" ? "on" : "off"}`}
          title={status === "connected" ? "Connected" : "Disconnected"}
        />
      </div>
    </div>
  );
}
