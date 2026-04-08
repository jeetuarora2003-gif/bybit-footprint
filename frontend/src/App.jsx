import { useMemo, useState } from "react";
import useWebSocket from "./hooks/useWebSocket";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import InfoBar from "./components/InfoBar";
import ChartCanvas from "./components/ChartCanvas";
import SubPanels from "./components/SubPanels";
import StatusBar from "./components/StatusBar";
import "./App.css";

const DEFAULT_SETTINGS = {
  clusterMode: "bidAskProfile",
  candleStyle: "borderedCandle",
  dataView: "bidAsk",
  timeframe: "1m",
  tickSize: "1",
  showPOC: true,
  showVA: true,
  showCrosshair: true,
  showDOM: true,
  vaPercent: 70,
  shadingMode: "adaptive",
};

const DEFAULT_FEATURES = ["vol", "fpbs", "tcount", "tsize", "dbars", "oi", "hl", "vwap"];

const CLASSIC_PRESET = {
  clusterMode: "deltaLadder",
  candleStyle: "borderedCandle",
  dataView: "bidAsk",
  showPOC: true,
  showVA: true,
  showDOM: true,
  shadingMode: "adaptive",
};

const CLASSIC_FEATURES = ["vol", "fpbs", "tcount", "tsize", "dbars", "oi", "hl", "vwap"];

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [crosshairData, setCrosshairData] = useState(null);
  const [activeFeatureArr, setActiveFeatureArr] = useState(DEFAULT_FEATURES);
  const [viewCommand, setViewCommand] = useState({ type: "reset", nonce: 1 });

  const activeFeatures = useMemo(() => new Set(activeFeatureArr), [activeFeatureArr]);

  const updateSetting = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleFeature = (key) => {
    setActiveFeatureArr((prev) => (
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    ));
  };

  const issueViewCommand = (type) => {
    setViewCommand((prev) => ({ type, nonce: prev.nonce + 1 }));
  };

  const applyClassicPreset = () => {
    setSettings((prev) => ({ ...prev, ...CLASSIC_PRESET }));
    setActiveFeatureArr(CLASSIC_FEATURES);
    issueViewCommand("reset");
  };

  const resetWorkspace = () => {
    setSettings(DEFAULT_SETTINGS);
    setActiveFeatureArr(DEFAULT_FEATURES);
    issueViewCommand("reset");
  };

  const { candles, liveCandle, recentTrades, status } = useWebSocket(settings.timeframe, settings.tickSize);
  const allCandles = liveCandle ? [...candles, liveCandle] : candles;

  return (
    <div className="app-shell">
      <Toolbar
        settings={settings}
        updateSetting={updateSetting}
        status={status}
        activeFeatureArr={activeFeatureArr}
        toggleFeature={toggleFeature}
        onApplyPreset={applyClassicPreset}
        onResetWorkspace={resetWorkspace}
      />
      <InfoBar candle={liveCandle} settings={settings} />
      <div className="app-body">
        <Sidebar
          settings={settings}
          updateSetting={updateSetting}
          activeFeatureArr={activeFeatureArr}
          toggleFeature={toggleFeature}
        />
        <div className="app-chart-area">
          <div className="app-main-chart">
            <ChartCanvas
              candles={allCandles}
              settings={settings}
              activeFeatures={activeFeatures}
              onCrosshairMove={setCrosshairData}
              viewCommand={viewCommand}
            />
          </div>
          <SubPanels candles={allCandles} activeFeatures={activeFeatures} recentTrades={recentTrades} />
        </div>
      </div>
      <StatusBar
        crosshairData={crosshairData}
        status={status}
        liveCandle={liveCandle}
        onResetView={() => issueViewCommand("reset")}
        onAutoFitView={() => issueViewCommand("fit")}
        settings={settings}
      />
    </div>
  );
}
