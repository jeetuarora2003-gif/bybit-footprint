import { useEffect, useMemo, useState } from "react";
import "./DecisionLens.css";
import { buildDecisionLens } from "../utils/decisionLens";
import { buildApiUrl } from "../utils/apiBase";
import {
  formatSignalWithoutAI,
  interpretStructuredSignal,
} from "../utils/aiSignalInterpreter";

export default function DecisionLens({
  enabled,
  candle,
  context,
  captureStats,
  status,
}) {
  const decision = useMemo(
    () => buildDecisionLens(candle, context, captureStats, status),
    [candle, context, captureStats, status],
  );
  const [aiMessageState, setAiMessageState] = useState({ key: "", message: "" });
  const decisionKey = useMemo(
    () => JSON.stringify({
      formatterInput: decision?.formatterInput || null,
      threshold: decision?.formatterThreshold || null,
      headline: decision?.headline || "",
      reason: decision?.reason || "",
    }),
    [decision],
  );
  const fallbackMessage = useMemo(() => {
    if (!enabled) return "";
    if (!decision?.formatterInput) {
      return decision?.reason || "WAIT";
    }
    return formatSignalWithoutAI(decision.formatterInput, {
      threshold: decision.formatterThreshold,
    });
  }, [decision, enabled]);

  useEffect(() => {
    if (!enabled || !decision?.formatterInput) {
      return undefined;
    }

    let cancelled = false;
    const currentKey = decisionKey;
    const timeoutId = window.setTimeout(() => {
      interpretStructuredSignal(decision.formatterInput, {
        endpointUrl: buildApiUrl("/interpret"),
        threshold: decision.formatterThreshold,
        timeoutMs: 900,
      }).then((nextMessage) => {
        if (!cancelled) {
          setAiMessageState({
            key: currentKey,
            message: nextMessage,
          });
        }
      }).catch(() => {});
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [decision, decisionKey, enabled]);

  if (!enabled) return null;

  const message = aiMessageState.key === decisionKey && aiMessageState.message
    ? aiMessageState.message
    : fallbackMessage;

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
        <div className="decision-lens__message">{message || decision.reason}</div>
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
