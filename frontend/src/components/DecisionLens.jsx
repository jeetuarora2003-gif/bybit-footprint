import "./DecisionLens.css";
import { buildDecisionLens } from "../utils/decisionLens";

export default function DecisionLens({
  enabled,
  candle,
  context,
  captureStats,
  status,
}) {
  if (!enabled) return null;

  const decision = buildDecisionLens(candle, context, captureStats, status);

  return (
    <div className={`decision-lens decision-lens--${decision.tone}`}>
      <div className="decision-lens__main">
        <div className="decision-lens__topline">
          <div className="decision-lens__kicker">Decision Lens</div>
          <span className={`decision-lens__badge decision-lens__badge--${decision.tone}`}>
            {decision.headline}
          </span>
          <span className="decision-lens__confidence">{decision.confidence}%</span>
        </div>
        <div className="decision-lens__reason">{decision.reason}</div>
        {decision.rows?.length > 0 && (
          <div className="decision-lens__rows">
            {decision.rows.map((row) => (
              <div key={`${row.label}:${row.value}`} className="decision-lens__row">
                <span className="decision-lens__row-label">{row.label}</span>
                <span className="decision-lens__row-value">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
