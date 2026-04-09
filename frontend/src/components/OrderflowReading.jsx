import "./OrderflowReading.css";
import { buildOrderflowReading } from "../utils/orderflow";

export default function OrderflowReading({ candle }) {
  const reading = buildOrderflowReading(candle);

  return (
    <div className={`orderflow-reading orderflow-reading--${reading.tone}`}>
      <div className="orderflow-reading__main">
        <div className="orderflow-reading__kicker">Orderflow Reading</div>
        <div className="orderflow-reading__headline">{reading.headline}</div>
        <div className="orderflow-reading__detail">{reading.detail}</div>
      </div>
      <div className="orderflow-reading__chips">
        {reading.chips.map((chip) => (
          <span key={chip} className="orderflow-reading__chip">{chip}</span>
        ))}
      </div>
    </div>
  );
}
