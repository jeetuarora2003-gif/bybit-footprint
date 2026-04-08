import { useEffect, useMemo, useState } from "react";
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
  shortNumbers: true,
};

const DEFAULT_FEATURES = ["vol", "fpbs", "tcount", "tsize", "cs", "dbars", "oi", "hl", "vwap"];

const CLASSIC_PRESET = {
  clusterMode: "deltaLadder",
  candleStyle: "borderedCandle",
  dataView: "bidAsk",
  showPOC: true,
  showVA: true,
  showDOM: true,
  shadingMode: "adaptive",
  shortNumbers: true,
};

const CLASSIC_FEATURES = ["vol", "fpbs", "tcount", "tsize", "cs", "dbars", "oi", "hl", "vwap"];
const REPLAY_SPEEDS = [1, 2, 4, 8];
const TIMEFRAME_MS = {
  "1m": 60000,
  "2m": 120000,
  "3m": 180000,
  "5m": 300000,
  "10m": 600000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
  "2h": 7200000,
  "4h": 14400000,
  "6h": 21600000,
  "8h": 28800000,
  "12h": 43200000,
  D: 86400000,
  W: 604800000,
  M: 2592000000,
};

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [crosshairData, setCrosshairData] = useState(null);
  const [activeFeatureArr, setActiveFeatureArr] = useState(DEFAULT_FEATURES);
  const [viewCommand, setViewCommand] = useState({ type: "reset", nonce: 1 });
  const [replay, setReplay] = useState({
    enabled: false,
    playing: false,
    index: null,
    speed: 1,
  });

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

  const { candles, liveCandle, depthHistory, status } = useWebSocket(settings.timeframe, settings.tickSize);
  const allCandles = useMemo(() => (liveCandle ? [...candles, liveCandle] : candles), [candles, liveCandle]);
  const replayMaxIndex = Math.max(0, allCandles.length - 1);
  const effectiveReplayIndex = replay.enabled
    ? Math.max(0, Math.min(replay.index ?? replayMaxIndex, replayMaxIndex))
    : replayMaxIndex;
  const displayedCandles = useMemo(() => {
    if (!replay.enabled) return allCandles;
    return allCandles.slice(0, effectiveReplayIndex + 1);
  }, [allCandles, effectiveReplayIndex, replay.enabled]);
  const displayedLiveCandle = replay.enabled ? displayedCandles.at(-1) ?? null : liveCandle;
  const infoCandle = crosshairData ?? displayedLiveCandle;
  useEffect(() => {
    if (!replay.enabled || !replay.playing) return undefined;

    const interval = setInterval(() => {
      setReplay((current) => {
        if (!current.enabled || !current.playing) return current;
        const nextIndex = Math.min(replayMaxIndex, (current.index ?? 0) + 1);
        if (nextIndex >= replayMaxIndex) {
          return { ...current, index: replayMaxIndex, playing: false };
        }
        return { ...current, index: nextIndex };
      });
    }, Math.max(80, 800 / replay.speed));

    return () => clearInterval(interval);
  }, [replay.enabled, replay.playing, replay.speed, replayMaxIndex]);

  const startReplay = () => {
    if (allCandles.length < 10) return;
    const startIndex = Math.max(0, replayMaxIndex - Math.min(120, replayMaxIndex));
    setReplay({
      enabled: true,
      playing: false,
      index: startIndex,
      speed: 1,
    });
    issueViewCommand("reset");
  };

  const stopReplay = () => {
    setReplay((current) => ({ ...current, enabled: false, playing: false, index: null }));
    issueViewCommand("reset");
  };

  const toggleReplayPlayback = () => {
    setReplay((current) => {
      if (!current.enabled) return current;
      return { ...current, playing: !current.playing };
    });
  };

  const stepReplay = (direction) => {
    setReplay((current) => {
      if (!current.enabled) return current;
      const nextIndex = Math.max(0, Math.min(replayMaxIndex, (current.index ?? 0) + direction));
      return { ...current, index: nextIndex, playing: false };
    });
  };

  const cycleReplaySpeed = () => {
    setReplay((current) => {
      if (!current.enabled) return current;
      const index = REPLAY_SPEEDS.indexOf(current.speed);
      const nextSpeed = REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.length];
      return { ...current, speed: nextSpeed };
    });
  };

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
        replay={replay}
        onStartReplay={startReplay}
        onStopReplay={stopReplay}
        onToggleReplayPlayback={toggleReplayPlayback}
        onStepReplay={stepReplay}
        onCycleReplaySpeed={cycleReplaySpeed}
      />
      <InfoBar candle={infoCandle} settings={settings} />
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
              candles={displayedCandles}
              depthHistory={depthHistory}
              settings={settings}
              activeFeatures={activeFeatures}
              onCrosshairMove={setCrosshairData}
              viewCommand={viewCommand}
            />
          </div>
          <SubPanels candles={displayedCandles} activeFeatures={activeFeatures} />
        </div>
      </div>
      <StatusBar
        crosshairData={crosshairData}
        status={status}
        liveCandle={displayedLiveCandle}
        onResetView={() => issueViewCommand("reset")}
        onAutoFitView={() => issueViewCommand("fit")}
        settings={settings}
        replay={replay}
        onStartReplay={startReplay}
        onStopReplay={stopReplay}
        onToggleReplayPlayback={toggleReplayPlayback}
        onStepReplay={stepReplay}
        onCycleReplaySpeed={cycleReplaySpeed}
      />
    </div>
  );
}
