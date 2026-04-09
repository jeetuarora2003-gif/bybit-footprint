import { useEffect, useMemo, useState } from "react";
import useWebSocket from "./hooks/useWebSocket";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import InfoBar from "./components/InfoBar";
import OrderflowReading from "./components/OrderflowReading";
import ChartCanvas from "./components/ChartCanvas";
import SubPanels from "./components/SubPanels";
import StatusBar from "./components/StatusBar";
import {
  CLASSIC_FEATURES,
  CLASSIC_PRESET,
  DEFAULT_CHART_SETTINGS,
  DEFAULT_FEATURES,
} from "./components/chart/modeRules";
import { buildOrderflowReading } from "./utils/orderflow";
import { buildCandleContext, buildMarketContext } from "./utils/marketContext";
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
    setSettings((prev) => ({
      ...prev,
      ...CLASSIC_PRESET,
    }));
    setActiveFeatureArr(CLASSIC_FEATURES);
    issueViewCommand("reset");
  };

  const resetWorkspace = () => {
    setSettings((prev) => ({
      ...DEFAULT_CHART_SETTINGS,
      symbol: prev.symbol,
      baseRowSize: prev.baseRowSize,
      tickSize: prev.tickSize,
    }));
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
    instrument,
    captureStats,
  } = useWebSocket({
    timeframe: settings.timeframe,
    tickSize: settings.tickSize,
    symbol: settings.symbol,
  });

  const allCandles = useMemo(() => (liveCandle ? [...candles, liveCandle] : candles), [candles, liveCandle]);
  const resolvedSettings = useMemo(() => ({
    ...settings,
    symbol: instrument?.symbol || settings.symbol,
    baseRowSize: instrument?.tickSize || settings.baseRowSize,
    tickSize: Array.isArray(instrument?.defaultTicks) && instrument.defaultTicks.length
      ? String(instrument.defaultTicks.includes(Number(settings.tickSize)) ? Number(settings.tickSize) : instrument.defaultTicks[0])
      : settings.tickSize,
  }), [instrument, settings]);
  const replay = {
    ...replayState,
    playing: replayState.enabled && replayUi.playing && replayState.cursor < replayState.totalEvents,
    speed: replayUi.speed,
  };
  const infoCandle = crosshairData ?? liveCandle;
  const readingContext = useMemo(
    () => buildMarketContext(allCandles, infoCandle, resolvedSettings),
    [allCandles, infoCandle, resolvedSettings],
  );
  const latestContext = useMemo(
    () => buildMarketContext(allCandles, liveCandle || allCandles.at(-1), resolvedSettings),
    [allCandles, liveCandle, resolvedSettings],
  );
  const chartAnnotations = useMemo(() => {
    if (!allCandles.length) return [];
    const start = Math.max(0, allCandles.length - 240);
    const annotations = [];
    for (let index = start; index < allCandles.length; index += 1) {
      const candle = allCandles[index];
      const context = buildCandleContext(allCandles, index, resolvedSettings);
      const reading = buildOrderflowReading(candle, context);
      if (!reading?.setup) continue;
      const minimumScore = context.market?.scoreConfig?.calloutMinimumScore ?? 7;
      if (reading.setup.qualityScore < minimumScore) continue;
      annotations.push({
        candle_open_time: candle.candle_open_time,
        price: reading.setup.price,
        direction: reading.setup.direction,
        label: reading.setup.setupLabel,
        gradeLabel: reading.setup.gradeLabel,
        qualityScore: reading.setup.qualityScore,
      });
    }
    return annotations.slice(-48);
  }, [allCandles, resolvedSettings]);

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
        instrument={instrument}
        captureStats={captureStats}
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
      <InfoBar candle={infoCandle} settings={resolvedSettings} instrument={instrument} marketContext={readingContext.market} />
      <OrderflowReading candle={infoCandle} context={readingContext} />
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
              marketContext={latestContext.market}
              annotations={chartAnnotations}
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
        instrument={instrument}
        marketContext={latestContext.market}
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
