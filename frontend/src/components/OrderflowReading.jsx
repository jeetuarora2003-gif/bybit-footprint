import "./OrderflowReading.css";
import { buildOrderflowReading } from "../utils/orderflow";

export default function OrderflowReading({
  candle,
  context,
  collapsed = false,
  onToggleCollapsed,
}) {
  const reading = buildOrderflowReading(candle, context);

  if (collapsed) {
    return (
      <div className={`orderflow-reading orderflow-reading--collapsed orderflow-reading--${reading.tone}`}>
        <div className="orderflow-reading__collapsed-summary">
          <span className="orderflow-reading__kicker">Orderflow Data</span>
          <span className="orderflow-reading__collapsed-text">
            Hidden to keep the chart area clear.
          </span>
        </div>
        <button
          type="button"
          className="orderflow-reading__toggle"
          onClick={onToggleCollapsed}
        >
          Show
        </button>
      </div>
    );
  }

  return (
    <div className={`orderflow-reading orderflow-reading--${reading.tone}`}>
      <div className="orderflow-reading__main">
        <div className="orderflow-reading__topline">
          <div className="orderflow-reading__kicker">Orderflow Data</div>
          {reading.qualityLabel && (
            <span className={`orderflow-reading__quality orderflow-reading__quality--${reading.qualityTone || "muted"}`}>
              {reading.qualityLabel}
            </span>
          )}
          {reading.gradeLabel && (
            <span className={`orderflow-reading__grade orderflow-reading__grade--${reading.gradeTone || "neutral"}`}>
              {reading.gradeLabel}
            </span>
          )}
          <button
            type="button"
            className="orderflow-reading__toggle"
            onClick={onToggleCollapsed}
          >
            Hide
          </button>
        </div>
        <div className="orderflow-reading__headline">{reading.headline}</div>
        <div className="orderflow-reading__detail">{reading.detail}</div>
        {reading.rows?.length > 0 && (
          <div className="orderflow-reading__rows">
            {reading.rows.map((row) => (
              <div key={`${row.label}:${row.value}`} className="orderflow-reading__row">
                <span className="orderflow-reading__row-label">{row.label}</span>
                <span className="orderflow-reading__row-value">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="orderflow-reading__chips">
        {reading.chips.map((chip) => (
          <span key={chip} className="orderflow-reading__chip">{chip}</span>
        ))}
      </div>
    </div>
  );
}
