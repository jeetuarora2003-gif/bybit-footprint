import { useEffect, useRef, useState } from "react";
import "./Toolbar.css";

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
  { value: "1h", label: "1 hour" },
  { value: "2h", label: "2 hours" },
  { value: "4h", label: "4 hours" },
  { value: "6h", label: "6 hours" },
  { value: "8h", label: "8 hours" },
  { value: "12h", label: "12 hours" },
  { value: "D", label: "Daily" },
  { value: "W", label: "Weekly" },
  { value: "M", label: "Monthly" },
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
  { key: "vol", label: "Vol" },
  { key: "tcount", label: "TCount" },
  { key: "rekt", label: "Rekt" },
  { key: "fpbs", label: "FPBS" },
  { key: "tsize", label: "TSize" },
  { key: "cs", label: "CS" },
  { key: "dbars", label: "DBars" },
  { key: "oi", label: "OI" },
  { key: "hl", label: "HL" },
  { key: "ns", label: "NS" },
  { key: "vwap", label: "VWAP" },
];

function Dropdown({ label, value, options, onChange, wide }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = options.find((option) => option.value === value);

  return (
    <div className="tb-dropdown" ref={ref}>
      <button className="tb-dropdown-btn" onClick={() => setOpen((prev) => !prev)}>
        {label && <span className="tb-dropdown-label">{label}</span>}
        <span className="tb-dropdown-value">{current?.label ?? value}</span>
        <span className="tb-dropdown-arrow">v</span>
      </button>
      {open && (
        <div className={`tb-dropdown-menu${wide ? " tb-dropdown-menu--wide" : ""}`}>
          {options.map((option) => (
            <button
              key={option.value}
              className={`tb-dropdown-item${option.value === value ? " active" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Toolbar({
  settings, updateSetting, status,
  activeFeatureArr, toggleFeature,
}) {
  return (
    <div className="toolbar">
      <div className="tb-left">
        <button className="tb-btn tb-btn--accent">Profile</button>
        <div className="tb-sep" />

        <button className="tb-btn">
          <span className="tb-exchange">Bybit:</span> BTCUSDT
        </button>
        <div className="tb-sep" />

        <Dropdown
          value={settings.timeframe || "1m"}
          options={TIMEFRAMES}
          onChange={(value) => updateSetting("timeframe", value)}
        />
        <div className="tb-sep" />

        <Dropdown
          value={settings.tickSize || "1"}
          options={TICK_SIZES}
          onChange={(value) => updateSetting("tickSize", value)}
        />
        <div className="tb-sep" />

        <Dropdown
          label="Cluster"
          value={settings.clusterMode}
          options={CLUSTER_MODES}
          onChange={(value) => updateSetting("clusterMode", value)}
        />
        <Dropdown
          label="Shading"
          value={settings.shadingMode || "current"}
          options={SHADING_MODES}
          onChange={(value) => updateSetting("shadingMode", value)}
        />
        <Dropdown
          label="Data"
          value={settings.dataView}
          options={DATA_VIEWS}
          onChange={(value) => updateSetting("dataView", value)}
        />
        <Dropdown
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
            className={`tb-tab${activeFeatureArr.includes(tab.key) ? " tb-tab--active" : ""}`}
            onClick={() => toggleFeature(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <div className="tb-sep" style={{ margin: "0 4px" }} />
        <button
          className={`tb-tab${settings.showDOM ? " tb-tab--active" : ""}`}
          onClick={() => updateSetting("showDOM", !settings.showDOM)}
        >
          DOM
        </button>
      </div>

      <div className="tb-right">
        <button className="tb-btn">Default</button>
        <button className="tb-btn tb-btn--icon">Cfg</button>
        <div
          className={`tb-status-dot ${status === "connected" ? "on" : "off"}`}
          title={status === "connected" ? "Connected" : "Disconnected"}
        />
      </div>
    </div>
  );
}
