export const DEFAULT_FEATURES = ["vol", "fpbs", "tcount", "tsize", "cs", "dbars", "oi", "hl", "vwap"];
export const CLASSIC_FEATURES = ["vol", "fpbs", "tcount", "tsize", "cs", "dbars", "oi", "hl", "vwap"];

export const DEFAULT_CHART_SETTINGS = {
  symbol: "BTCUSD",
  baseRowSize: 0.1,
  clusterMode: "bidAskProfile",
  candleStyle: "borderedCandle",
  dataView: "bidAsk",
  timeframe: "1m",
  tickSize: "1",
  showPOC: false,
  showVA: false,
  showCrosshair: true,
  showDOM: false,
  showHeatmap: false,
  showCallouts: false,
  decisionLens: false,
  vaPercent: 70,
  shadingMode: "adaptive",
  shortNumbers: true,
};

export const CLASSIC_PRESET = {
  clusterMode: "deltaLadder",
  candleStyle: "borderedCandle",
  dataView: "bidAsk",
  profileStudy: "visible",
  showPOC: false,
  showVA: false,
  showDOM: false,
  showHeatmap: false,
  shadingMode: "adaptive",
  shortNumbers: true,
};

const EXPLICIT_MODE_PROFILES = {
  "bidAskProfile|imbalance|none": {
    id: "exo-profile-imbalance",
    profileOnlyMode: true,
    exoImbalanceProfile: true,
    showPointOfControl: false,
    showValueArea: false,
    showProfileRowSeparators: false,
    showCandleBadges: false,
    showCandleMetaOverlay: false,
    showAuctionOverlay: false,
    textDensity: "profile-tight",
    imbalanceEmphasis: "exo",
    bidAskOrder: "sellLeftBuyRight",
    barWidthScale: 0.78,
    axisFontSize: 11,
    timeAxisFontSize: 10,
    currentPriceLabel: "split",
  },
  "bidAskProfile|bidAsk|none": {
    id: "exo-profile-bidask",
    profileOnlyMode: true,
    showPointOfControl: false,
    showValueArea: false,
    showProfileRowSeparators: false,
    showCandleBadges: false,
    showCandleMetaOverlay: false,
    showAuctionOverlay: false,
    textDensity: "profile-tight",
    bidAskOrder: "sellLeftBuyRight",
    barWidthScale: 0.8,
    axisFontSize: 11,
    timeAxisFontSize: 10,
    currentPriceLabel: "split",
  },
  "bidAskProfile|imbalance|borderedCandle": {
    id: "exo-footprint-imbalance",
    textDensity: "balanced",
    bidAskOrder: "sellLeftBuyRight",
    imbalanceEmphasis: "exo",
    currentPriceLabel: "split",
    axisFontSize: 11,
    timeAxisFontSize: 10,
  },
};

export const MODE_PRESETS = {
  void: { dataView: "none", candleStyle: "colorCandle", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  volumeProfile: { dataView: "volume", candleStyle: "borderedCandle", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  deltaProfile: { dataView: "delta", candleStyle: "borderedCandle", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  bidAskProfile: { dataView: "bidAsk", candleStyle: "borderedCandle", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  volumeCluster: { dataView: "volume", candleStyle: "embed", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  deltaCluster: { dataView: "delta", candleStyle: "embed", showVA: false, showPOC: false, showDOM: false, showHeatmap: false },
  deltaLadder: { dataView: "bidAsk", candleStyle: "borderedCandle", showVA: false, showPOC: true, showDOM: true, showHeatmap: false },
};

export function deriveModeFlags(settings, activeFeatures) {
  const featureSet = activeFeatures?.has ? activeFeatures : new Set(activeFeatures || []);
  const explicitModeKey = `${settings.clusterMode}|${settings.dataView}|${settings.candleStyle}`;
  const behavior = EXPLICIT_MODE_PROFILES[explicitModeKey] ?? {};
  const minimalProfileMode = Boolean(behavior.profileOnlyMode)
    || (settings.candleStyle === "none" && settings.clusterMode === "bidAskProfile");
  const exoImbalanceProfile = Boolean(behavior.exoImbalanceProfile)
    || (minimalProfileMode && settings.dataView === "imbalance");

  return {
    behaviorId: behavior.id ?? explicitModeKey,
    bidAskOrder: behavior.bidAskOrder ?? "sellLeftBuyRight",
    textDensity: behavior.textDensity ?? "balanced",
    barWidthScale: behavior.barWidthScale ?? 1,
    axisFontSize: behavior.axisFontSize ?? 10,
    timeAxisFontSize: behavior.timeAxisFontSize ?? 9,
    currentPriceLabel: behavior.currentPriceLabel ?? "split",
    imbalanceEmphasis: behavior.imbalanceEmphasis ?? "default",
    profileStudy: settings.profileStudy || "visible",
    minimalProfileMode,
    exoImbalanceProfile,
    showProfileStudy: featureSet.has("vol"),
    showTradeCount: featureSet.has("tcount"),
    showImbalanceMarkers: featureSet.has("fpbs") || settings.dataView === "imbalance",
    showStudySignals: featureSet.has("fpbs"),
    showTradeSize: featureSet.has("tsize"),
    showCandleStats: featureSet.has("cs"),
    showDeltaBars: featureSet.has("dbars"),
    showAuctionMarkers: featureSet.has("hl"),
    showDOM: Boolean(settings.showDOM),
    showHeatmap: Boolean(settings.showHeatmap),
    showPointOfControl: typeof behavior.showPointOfControl === "boolean"
      ? behavior.showPointOfControl
      : (Boolean(settings.showPOC) && !minimalProfileMode),
    showValueArea: typeof behavior.showValueArea === "boolean"
      ? behavior.showValueArea
      : (Boolean(settings.showVA) && !minimalProfileMode),
    showProfileRowSeparators: typeof behavior.showProfileRowSeparators === "boolean"
      ? behavior.showProfileRowSeparators
      : !minimalProfileMode,
    showCandleBadges: typeof behavior.showCandleBadges === "boolean"
      ? behavior.showCandleBadges
      : (settings.candleStyle !== "none" && !exoImbalanceProfile),
    showCandleMetaOverlay: typeof behavior.showCandleMetaOverlay === "boolean"
      ? behavior.showCandleMetaOverlay
      : settings.candleStyle !== "none",
    showAuctionOverlay: typeof behavior.showAuctionOverlay === "boolean"
      ? behavior.showAuctionOverlay
      : settings.candleStyle !== "none",
  };
}
