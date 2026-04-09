import "./Sidebar.css";

const SIDEBAR_ITEMS = [
  { type: "setting", key: "showDOM", label: "DOM", color: "var(--accent)" },
  { type: "setting", key: "showHeatmap", label: "HEAT", color: "var(--purple)" },
  { type: "setting", key: "showCallouts", label: "NOTE", color: "var(--yellow)" },
  { type: "setting", key: "showSessionLevels", label: "LVL", color: "var(--green)" },
  { type: "setting", key: "showVA", label: "VA", color: "var(--green)" },
  { type: "setting", key: "showPOC", label: "POC", color: "var(--red)" },
  { type: "feature", key: "vol", label: "VOL", color: "var(--accent)" },
  { type: "feature", key: "fpbs", label: "IMB", color: "var(--green)" },
  { type: "feature", key: "cs", label: "CS", color: "var(--accent)" },
  { type: "feature", key: "hl", label: "H/L", color: "var(--yellow)" },
  { type: "feature", key: "oi", label: "OI", color: "var(--purple)" },
  { type: "feature", key: "vwap", label: "VWAP", color: "var(--yellow)" },
];

export default function Sidebar({ settings, updateSetting, activeFeatureArr, toggleFeature }) {
  return (
    <div className="sidebar">
      {SIDEBAR_ITEMS.map((item) => {
        const isSetting = item.type === "setting";
        const isActive = isSetting ? settings[item.key] : activeFeatureArr.includes(item.key);

        return (
          <button
            key={item.key}
            className={`sb-item ${isActive ? "sb-item--active" : ""}`}
            onClick={() => {
              if (isSetting) updateSetting(item.key, !settings[item.key]);
              else toggleFeature(item.key);
            }}
            title={item.label}
          >
            <span
              className="sb-dot"
              style={{ background: isActive ? item.color : "var(--text-muted)" }}
            />
            <span className="sb-label">{item.label}</span>
            <span className="sb-toggle-arrow">{isActive ? "v" : ">"}</span>
          </button>
        );
      })}
    </div>
  );
}
