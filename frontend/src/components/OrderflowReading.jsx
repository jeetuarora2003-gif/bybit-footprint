import "./OrderflowReading.css";
import { buildOrderflowReading } from "../utils/orderflow";

export default function OrderflowReading({ candle, previousCandle }) {
  const reading = buildOrderflowReading(candle, previousCandle);

  return (
    <div className={`orderflow-reading orderflow-reading--${reading.tone}`}>
      <div className="orderflow-reading__main">
        <div className="orderflow-reading__kicker">Orderflow Reading</div>
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
