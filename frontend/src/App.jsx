import { useState, useRef } from "react";
import useWebSocket from "./hooks/useWebSocket";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import InfoBar from "./components/InfoBar";
import ChartCanvas from "./components/ChartCanvas";
import SubPanels from "./components/SubPanels";
import StatusBar from "./components/StatusBar";
import "./App.css";

const DEFAULT_SETTINGS = {
  clusterMode:  "volumeProfile",
  candleStyle:  "colorCandle",
  dataView:     "volume",
  timeframe:    "1m",
  tickSize:     "1",
  showPOC:      true,
  showVA:       true,
  showCrosshair: true,
  showDOM:      true,
  vaPercent:    70,
  shadingMode:  "current",
};

export default function App() {
  const [settings, setSettings]           = useState(DEFAULT_SETTINGS);
  const [crosshairData, setCrosshairData] = useState(null);

  // activeFeatures as a plain array so React detects changes correctly
  // (a mutated Set reference does NOT trigger re-renders)
  const [activeFeatureArr, setActiveFeatureArr] = useState([]);
  // Convert to Set for O(1) lookup in ChartCanvas/SubPanels
  const activeFeatures = new Set(activeFeatureArr);

  const updateSetting = (key, val) =>
    setSettings(prev => ({ ...prev, [key]: val }));

  const toggleFeature = (key) =>
    setActiveFeatureArr(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );

  // Pass timeframe to useWebSocket so it reconnects on change
  const { candles, liveCandle, status } = useWebSocket(settings.timeframe);

  const allCandles = liveCandle ? [...candles, liveCandle] : candles;

  return (
    <div className="app-shell">
      <Toolbar
        settings={settings}
        updateSetting={updateSetting}
        status={status}
        activeFeatures={activeFeatures}
        activeFeatureArr={activeFeatureArr}
        toggleFeature={toggleFeature}
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
