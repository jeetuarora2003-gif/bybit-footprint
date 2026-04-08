import { useEffect, useMemo, useState } from "react";
import useWebSocket from "./hooks/useWebSocket";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import InfoBar from "./components/InfoBar";
import ChartCanvas from "./components/ChartCanvas";
import SubPanels from "./components/SubPanels";
import StatusBar from "./components/StatusBar";
import {
  CLASSIC_FEATURES,
  CLASSIC_PRESET,
  DEFAULT_CHART_SETTINGS,
  DEFAULT_FEATURES,
} from "./components/chart/modeRules";
import "./App.css";

const REPLAY_SPEEDS = [1, 2, 4, 8];
const REPLAY_BATCHES = {
  1: 10,
  2: 25,
  4: 50,
  8: 100,
};

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_CHART_SETTINGS);
  const [crosshairData, setCrosshairData] = useState(null);
  const [activeFeatureArr, setActiveFeatureArr] = useState(DEFAULT_FEATURES);
  const [viewCommand, setViewCommand] = useState({ type: "reset", nonce: 1 });
  const [replayUi, setReplayUi] = useState({
    playing: false,
    speed: 1,
  });

  const activeFeatures = useMemo(() => new Set(activeFeatureArr), [activeFeatureArr]);
  const resolvedSettings = useMemo(() => ({
    ...settings,
  }), [settings]);

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
    setSettings(DEFAULT_CHART_SETTINGS);
    setActiveFeatureArr(DEFAULT_FEATURES);
    issueViewCommand("reset");
  };

  const {
    candles,
    liveCandle,
    depthHistory,
    status,
    replayState,
    startReplay: startReplayEngine,
    stopReplay: stopReplayEngine,
    stepReplay: stepReplayEngine,
  } = useWebSocket(settings.timeframe, settings.tickSize);
  const allCandles = useMemo(() => (liveCandle ? [...candles, liveCandle] : candles), [candles, liveCandle]);
  const replay = {
    ...replayState,
    playing: replayState.enabled && replayUi.playing && replayState.cursor < replayState.totalEvents,
    speed: replayUi.speed,
  };
  const infoCandle = crosshairData ?? liveCandle;

  useEffect(() => {
    if (!replay.enabled || !replay.playing) return undefined;

    const interval = setInterval(() => {
      stepReplayEngine(REPLAY_BATCHES[replay.speed] ?? REPLAY_BATCHES[1]);
    }, 120);

    return () => clearInterval(interval);
  }, [replay.cursor, replay.enabled, replay.playing, replay.speed, replay.totalEvents, stepReplayEngine]);

  const startReplay = () => {
    if (!replayState.available) return;
    startReplayEngine();
    setReplayUi({
      playing: false,
      speed: 1,
    });
    issueViewCommand("reset");
  };

  const stopReplay = () => {
    stopReplayEngine();
    setReplayUi((current) => ({ ...current, playing: false }));
    issueViewCommand("reset");
  };

  const toggleReplayPlayback = () => {
    setReplayUi((current) => {
      if (!replayState.enabled) return current;
      if (replayState.cursor >= replayState.totalEvents) {
        return { ...current, playing: false };
      }
      return { ...current, playing: !current.playing };
    });
  };

  const stepReplay = (direction) => {
    if (!replayState.enabled) return;
    setReplayUi((current) => ({ ...current, playing: false }));
    stepReplayEngine(direction);
  };

  const cycleReplaySpeed = () => {
    setReplayUi((current) => {
      if (!replayState.enabled) return current;
      const index = REPLAY_SPEEDS.indexOf(current.speed);
      const nextSpeed = REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.length];
      return { ...current, speed: nextSpeed };
    });
  };

  return (
    <div className="app-shell">
      <Toolbar
        settings={resolvedSettings}
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
      <InfoBar candle={infoCandle} settings={resolvedSettings} />
      <div className="app-body">
        <Sidebar
          settings={resolvedSettings}
          updateSetting={updateSetting}
          activeFeatureArr={activeFeatureArr}
          toggleFeature={toggleFeature}
        />
        <div className="app-chart-area">
          <div className="app-main-chart">
            <ChartCanvas
              candles={allCandles}
              depthHistory={depthHistory}
              settings={resolvedSettings}
              activeFeatures={activeFeatures}
              onCrosshairMove={setCrosshairData}
              viewCommand={viewCommand}
            />
          </div>
          <SubPanels candles={allCandles} activeFeatures={activeFeatures} />
        </div>
      </div>
      <StatusBar
        crosshairData={crosshairData}
        status={status}
        liveCandle={liveCandle}
        onResetView={() => issueViewCommand("reset")}
        onAutoFitView={() => issueViewCommand("fit")}
        settings={resolvedSettings}
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
