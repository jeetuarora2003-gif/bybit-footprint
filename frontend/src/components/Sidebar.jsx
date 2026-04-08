import "./Sidebar.css";

const INDICATORS = [
  { key: "settings", label: "Sett.", color: null },
  { key: "color", label: "Color", color: null },
  { key: "tpl", label: "TpL.", color: null },
  { key: "mrk", label: "Mrk.", color: null },
  { key: "showVA", label: "VA", color: "var(--green)", toggle: true },
  { key: "showPOC", label: "POC", color: "var(--red)", toggle: true },
  { key: "cpl", label: "CPL", color: null },
  { key: "cpr", label: "CPR", color: null },
  { key: "tpo", label: "TPO", color: null },
  { key: "tree", label: "Tree", color: null },
];

export default function Sidebar({ settings, updateSetting }) {
  return (
    <div className="sidebar">
      {INDICATORS.map((indicator) => {
        const isToggleable = indicator.toggle;
        const isActive = isToggleable ? settings[indicator.key] : false;

        return (
          <button
            key={indicator.key}
            className={`sb-item ${isActive ? "sb-item--active" : ""}`}
            onClick={() => {
              if (isToggleable) updateSetting(indicator.key, !settings[indicator.key]);
            }}
            title={indicator.label}
          >
            {indicator.color && (
              <span
                className="sb-dot"
                style={{ background: isActive ? indicator.color : "var(--text-muted)" }}
              />
            )}
            <span className="sb-label">{indicator.label}</span>
            {isToggleable && (
              <span className="sb-toggle-arrow">{isActive ? "v" : ">"}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
