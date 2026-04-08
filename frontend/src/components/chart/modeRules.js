export const DEFAULT_FEATURES = ["vol", "fpbs", "tcount", "tsize", "cs", "dbars", "oi", "hl", "vwap"];
export const CLASSIC_FEATURES = ["vol", "fpbs", "tcount", "tsize", "cs", "dbars", "oi", "hl", "vwap"];

export const DEFAULT_CHART_SETTINGS = {
  clusterMode: "bidAskProfile",
  candleStyle: "borderedCandle",
  dataView: "bidAsk",
  timeframe: "1m",
  tickSize: "1",
  showPOC: true,
  showVA: true,
  showCrosshair: true,
  showDOM: false,
  showHeatmap: false,
  vaPercent: 70,
  shadingMode: "adaptive",
  shortNumbers: true,
};

export const CLASSIC_PRESET = {
  clusterMode: "deltaLadder",
  candleStyle: "borderedCandle",
  dataView: "bidAsk",
  showPOC: true,
  showVA: true,
  showDOM: false,
  showHeatmap: false,
  shadingMode: "adaptive",
  shortNumbers: true,
};

export const MODE_PRESETS = {
  void: { dataView: "none", candleStyle: "colorCandle", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  volumeProfile: { dataView: "volume", candleStyle: "borderedCandle", showVA: true, showPOC: true, showDOM: false, showHeatmap: false },
  deltaProfile: { dataView: "delta", candleStyle: "borderedCandle", showVA: true, showPOC: true, showDOM: false, showHeatmap: false },
  bidAskProfile: { dataView: "bidAsk", candleStyle: "borderedCandle", showVA: true, showPOC: true, showDOM: false, showHeatmap: false },
  volumeCluster: { dataView: "volume", candleStyle: "embed", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  deltaCluster: { dataView: "delta", candleStyle: "embed", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  deltaLadder: { dataView: "bidAsk", candleStyle: "borderedCandle", showVA: false, showPOC: true, showDOM: true, showHeatmap: false },
};

export function deriveModeFlags(settings, activeFeatures) {
  const featureSet = activeFeatures?.has ? activeFeatures : new Set(activeFeatures || []);
  const minimalProfileMode = settings.candleStyle === "none" && settings.clusterMode === "bidAskProfile";
  const exoImbalanceProfile = minimalProfileMode && settings.dataView === "imbalance";

  return {
    minimalProfileMode,
    exoImbalanceProfile,
    showSessionProfile: featureSet.has("vol"),
    showTradeCount: featureSet.has("tcount"),
    showImbalanceMarkers: featureSet.has("fpbs") || settings.dataView === "imbalance",
    showTradeSize: featureSet.has("tsize"),
    showCandleStats: featureSet.has("cs"),
    showDeltaBars: featureSet.has("dbars"),
    showAuctionMarkers: featureSet.has("hl"),
    showDOM: Boolean(settings.showDOM),
    showHeatmap: Boolean(settings.showHeatmap),
    showPointOfControl: Boolean(settings.showPOC) && !minimalProfileMode,
    showValueArea: Boolean(settings.showVA) && !minimalProfileMode,
    showProfileRowSeparators: !minimalProfileMode,
    showCandleBadges: settings.candleStyle !== "none" && !exoImbalanceProfile,
    showCandleMetaOverlay: settings.candleStyle !== "none",
    showAuctionOverlay: settings.candleStyle !== "none",
  };
}
