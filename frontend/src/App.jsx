import { useState } from "react";
import useWebSocket from "./hooks/useWebSocket";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import InfoBar from "./components/InfoBar";
import ChartCanvas from "./components/ChartCanvas";
import SubPanels from "./components/SubPanels";
import StatusBar from "./components/StatusBar";
import "./App.css";

const DEFAULT_SETTINGS = {
  clusterMode: "volumeProfile",
  candleStyle: "colorCandle",
  dataView: "volume",
  timeframe: "1m",
  tickSize: "1",
  showPOC: true,
  showVA: true,
  showCrosshair: true,
  showDOM: true,
  vaPercent: 70,
};

export default function App() {
  const { candles, liveCandle, status } = useWebSocket("ws://localhost:8080");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [crosshairData, setCrosshairData] = useState(null);
  const [activeFeatures, setActiveFeatures] = useState(new Set());

  const updateSetting = (key, val) =>
    setSettings((prev) => ({ ...prev, [key]: val }));

  // Combine completed candles + live candle
  const allCandles = liveCandle ? [...candles, liveCandle] : candles;

  return (
    <div className="app-shell">
      <Toolbar
        settings={settings}
        updateSetting={updateSetting}
        status={status}
        activeFeatures={activeFeatures}
        setActiveFeatures={setActiveFeatures}
      />
      <InfoBar candle={liveCandle} settings={settings} />
      <div className="app-body">
        <Sidebar settings={settings} updateSetting={updateSetting} />
        <div className="app-chart-area">
          <div className="app-main-chart">
            <ChartCanvas
              candles={allCandles}
              settings={settings}
              activeFeatures={activeFeatures}
              onCrosshairMove={setCrosshairData}
            />
          </div>
          <SubPanels candles={allCandles} activeFeatures={activeFeatures} />
        </div>
      </div>
      <StatusBar crosshairData={crosshairData} status={status} liveCandle={liveCandle} />
    </div>
  );
}
