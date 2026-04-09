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
import { normalizeTimeframe } from "./market/aggregate";
import { buildOrderflowReading } from "./utils/orderflow";
import "./App.css";

const REPLAY_SPEEDS = [1, 2, 4, 8];
const SETTINGS_STORAGE_KEY = "bybit-footprint:settings:v1";
const FEATURES_STORAGE_KEY = "bybit-footprint:features:v1";
const REPLAY_BATCHES = {
  1: 10,
  2: 25,
  4: 50,
  8: 100,
};

export default function App() {
  const [settings, setSettings] = useState(loadPersistedSettings);
  const [crosshairData, setCrosshairData] = useState(null);
  const [activeFeatureArr, setActiveFeatureArr] = useState(loadPersistedFeatures);
  const [viewCommand, setViewCommand] = useState({ type: "reset", nonce: 1 });
  const [replayUi, setReplayUi] = useState({
    playing: false,
    speed: 1,
  });

  const activeFeatures = useMemo(() => new Set(activeFeatureArr), [activeFeatureArr]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Workspace persistence is best effort only.
    }
  }, [settings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(FEATURES_STORAGE_KEY, JSON.stringify(activeFeatureArr));
    } catch {
      // Workspace persistence is best effort only.
    }
  }, [activeFeatureArr]);

  const updateSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: key === "timeframe" ? normalizeTimeframe(value) : value,
    }));
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
    () => buildSimpleReadingContext(allCandles, infoCandle, resolvedSettings.timeframe),
    [allCandles, infoCandle, resolvedSettings.timeframe],
  );
  const chartAnnotations = useMemo(() => {
    if (!allCandles.length) return [];
    const start = Math.max(0, allCandles.length - 96);
    const annotations = [];
    for (let index = start; index < allCandles.length; index += 1) {
      const candle = allCandles[index];
      const context = buildSimpleReadingContext(allCandles, candle, resolvedSettings.timeframe);
      const reading = buildOrderflowReading(candle, context);
      if (!reading?.setup) continue;
      const minimumScore = 7;
      if (reading.setup.qualityScore < minimumScore) continue;
      if (reading.setup.confirmationState !== "confirmed") continue;
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
  }, [allCandles, resolvedSettings.timeframe]);

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
      <InfoBar candle={infoCandle} settings={resolvedSettings} instrument={instrument} />
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

function buildSimpleReadingContext(allCandles, activeCandle, timeframe = "1m") {
  if (!activeCandle?.candle_open_time || allCandles.length === 0) {
    return {
      previousCandle: null,
      nextCandle: null,
      recentCandles: [],
      futureCandles: [],
    };
  }

  let index = -1;
  for (let cursor = allCandles.length - 1; cursor >= 0; cursor -= 1) {
    if (allCandles[cursor]?.candle_open_time === activeCandle.candle_open_time) {
      index = cursor;
      break;
    }
  }

  if (index < 0) {
    index = allCandles.length - 1;
  }

  const { recentCount, futureCount } = getAdaptiveReadingWindow(timeframe);

  return {
    previousCandle: index > 0 ? allCandles[index - 1] : null,
    nextCandle: index + 1 < allCandles.length ? allCandles[index + 1] : null,
    recentCandles: allCandles.slice(Math.max(0, index - recentCount), index),
    futureCandles: allCandles.slice(index + 1, index + 1 + futureCount),
  };
}

function getAdaptiveReadingWindow(timeframe) {
  switch (timeframe) {
    case "1m":
      return { recentCount: 10, futureCount: 3 };
    case "2m":
    case "3m":
      return { recentCount: 9, futureCount: 3 };
    case "5m":
      return { recentCount: 8, futureCount: 3 };
    case "10m":
      return { recentCount: 6, futureCount: 2 };
    case "15m":
      return { recentCount: 5, futureCount: 2 };
    case "30m":
      return { recentCount: 4, futureCount: 2 };
    default:
      return { recentCount: 8, futureCount: 2 };
  }
}

function loadPersistedSettings() {
  if (typeof window === "undefined") return DEFAULT_CHART_SETTINGS;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CHART_SETTINGS,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      timeframe: normalizeTimeframe(parsed?.timeframe || DEFAULT_CHART_SETTINGS.timeframe),
    };
  } catch {
    return DEFAULT_CHART_SETTINGS;
  }
}

function loadPersistedFeatures() {
  if (typeof window === "undefined") return DEFAULT_FEATURES;

  try {
    const raw = window.localStorage.getItem(FEATURES_STORAGE_KEY);
    if (!raw) return DEFAULT_FEATURES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed.filter((value) => typeof value === "string")
      : DEFAULT_FEATURES;
  } catch {
    return DEFAULT_FEATURES;
  }
}
