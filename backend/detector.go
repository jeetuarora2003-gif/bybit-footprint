package main

import (
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

var InstrumentTickSize = rowSize

type RangeBox struct {
	Source     string  `json:"source"`
	High       float64 `json:"high"`
	Low        float64 `json:"low"`
	SizeTicks  float64 `json:"size_ticks"`
	Age        int     `json:"age"`
	Touches    int     `json:"touches"`
	Priority   int     `json:"priority"`
	StaleCount int     `json:"stale_count"`
}

type SweepCandidate struct {
	Direction      string   `json:"direction"`
	SweptLevel     float64  `json:"swept_level"`
	ExcursionTicks float64  `json:"excursion_ticks"`
	TimestampMs    int64    `json:"timestamp_ms"`
	Range          RangeBox `json:"range"`
	RestingBefore  float64  `json:"resting_before"`
}

type DetectorEvent struct {
	ID                     string  `json:"id"`
	Type                   string  `json:"type"`
	Strength               string  `json:"strength"`
	Score                  int     `json:"score"`
	RangeSource            string  `json:"range_source"`
	SweptLevel             float64 `json:"swept_level"`
	ExcursionTicks         float64 `json:"excursion_ticks"`
	ReclaimedIn            string  `json:"reclaimed_in"`
	ExtremeImbalance       bool    `json:"extreme_imbalance"`
	DeltaZscore            float64 `json:"delta_zscore"`
	DepletionRatio         float64 `json:"depletion_ratio"`
	WickPct                float64 `json:"wick_pct"`
	ImbalanceCount         int     `json:"imbalance_count"`
	ExpiresAfter           int     `json:"expires_after"`
	Outcome                string  `json:"outcome"`
	EventCandleOpenTime    int64   `json:"event_candle_open_time"`
	ResolvedCandleOpenTime int64   `json:"resolved_candle_open_time"`
	CloseReclaimCandle     float64 `json:"close_reclaim_candle"`
	CloseExpiryCandle      float64 `json:"close_expiry_candle"`
}

type DetectorTick struct {
	Price       float64
	Volume      float64
	Side        string
	TimestampMs int64
}

type DetectorBookUpdate struct {
	Levels      map[float64]float64
	EventTimeMs int64
}

type DetectorCandle struct {
	OpenTime int64
	Open     float64
	High     float64
	Low      float64
	Close    float64
	Delta    float64
	CVD      float64
	Buckets  map[float64][2]float64
}

type DetectorSnapshot struct {
	ActiveEvents        []DetectorEvent `json:"active_events"`
	WinRateLast100      float64         `json:"win_rate_last_100"`
	TotalSignalsSession int             `json:"total_signals_session"`
}

type TrackedEvent struct {
	Event                DetectorEvent
	ReclaimClose         float64
	ReclaimCandleOpen    int64
	RangeSpan            float64
	ExpiryCountdown      int
	DisplayBarsRemaining int
}

type bybitInstrumentInfoResult struct {
	List []bybitInstrumentInfoItem `json:"list"`
}

type bybitInstrumentInfoItem struct {
	PriceFilter struct {
		TickSize string `json:"tickSize"`
	} `json:"priceFilter"`
}

type detectorSessionSeed struct {
	High     float64
	Low      float64
	DayStart int64
}

type detectorCandidateState struct {
	SweepCandidate
	SweepCandleOpenTime int64
	SweepCandleHigh     float64
	SweepCandleLow      float64
	MinObserved         float64
	DepletionRatio      float64
	ImbalanceCount      int
	ExtremeImbalance    bool
	DeltaZscore         float64
	AwaitingReclaim     bool
}

type SweepDetector struct {
	tradeCh chan DetectorTick
	bookCh  chan DetectorBookUpdate
	barCh   chan DetectorCandle

	sessionCh chan detectorSessionSeed

	dropCount int64

	tickSize float64

	snapshotMu sync.RWMutex
	snapshot   DetectorSnapshot

	closedBars         []DetectorCandle
	sessionBars        []DetectorCandle
	bookMirror         map[float64]float64
	levelHistory       map[float64][]float64
	activeCandidates   []detectorCandidateState
	trackedEvents      []TrackedEvent
	resolvedLog        []DetectorEvent
	currentCandle      DetectorCandle
	currentCVD         float64
	sessionTotalSignals int
	localRange         *RangeBox
	sessionRange       *RangeBox
	sessionDayStart    int64
	lastTickPrice      float64
}

func NewSweepDetector(tickSize float64) *SweepDetector {
	if tickSize <= 0 {
		tickSize = rowSize
	}
	detector := &SweepDetector{
		tradeCh:     make(chan DetectorTick, 2000),
		bookCh:      make(chan DetectorBookUpdate, 500),
		barCh:       make(chan DetectorCandle, 60),
		sessionCh:   make(chan detectorSessionSeed, 4),
		tickSize:    tickSize,
		bookMirror:  make(map[float64]float64),
		levelHistory: make(map[float64][]float64),
	}
	detector.publishSnapshot()
	return detector
}

func (d *SweepDetector) Start() {
	go d.loop()
}

func (d *SweepDetector) EnqueueTrade(t DetectorTick) {
	select {
	case d.tradeCh <- t:
	default:
		atomic.AddInt64(&d.dropCount, 1)
	}
}

func (d *SweepDetector) EnqueueBook(b DetectorBookUpdate) {
	select {
	case d.bookCh <- b:
	default:
		atomic.AddInt64(&d.dropCount, 1)
	}
}

func (d *SweepDetector) EnqueueClosedBar(c DetectorCandle) {
	select {
	case d.barCh <- c:
	default:
		atomic.AddInt64(&d.dropCount, 1)
	}
}

func (d *SweepDetector) SetSessionRange(high, low float64, dayStart int64) {
	seed := detectorSessionSeed{
		High:     round6(high),
		Low:      round6(low),
		DayStart: dayStart,
	}
	select {
	case d.sessionCh <- seed:
	default:
		select {
		case <-d.sessionCh:
		default:
		}
		select {
		case d.sessionCh <- seed:
		default:
		}
	}
}

func (d *SweepDetector) Snapshot() DetectorSnapshot {
	d.snapshotMu.RLock()
	defer d.snapshotMu.RUnlock()
	return DetectorSnapshot{
		ActiveEvents:        copyDetectorEvents(d.snapshot.ActiveEvents),
		WinRateLast100:      d.snapshot.WinRateLast100,
		TotalSignalsSession: d.snapshot.TotalSignalsSession,
	}
}

func (d *SweepDetector) loop() {
	for {
		select {
		case seed := <-d.sessionCh:
			d.handleSessionSeed(seed)
		case tick := <-d.tradeCh:
			d.handleTrade(tick)
		case book := <-d.bookCh:
			d.handleBook(book)
		case bar := <-d.barCh:
			d.handleClosedBar(bar)
		}
	}
}

func (d *SweepDetector) handleSessionSeed(seed detectorSessionSeed) {
	if seed.DayStart <= 0 || seed.High <= 0 || seed.Low <= 0 || seed.High <= seed.Low {
		d.sessionRange = nil
		d.sessionDayStart = 0
		d.sessionBars = nil
		d.sessionTotalSignals = 0
		d.publishSnapshot()
		return
	}
	sizeTicks := (seed.High - seed.Low) / d.tickSize
	if sizeTicks < 20 {
		d.sessionRange = nil
		d.sessionDayStart = seed.DayStart
		d.sessionBars = nil
		d.sessionTotalSignals = 0
		d.publishSnapshot()
		return
	}
	d.sessionRange = &RangeBox{
		Source:    "session_range",
		High:      round6(seed.High),
		Low:       round6(seed.Low),
		SizeTicks: round6(sizeTicks),
		Priority:  3,
	}
	d.sessionDayStart = seed.DayStart
	d.sessionBars = nil
	d.sessionTotalSignals = 0
	d.publishSnapshot()
}

func (d *SweepDetector) handleTrade(t DetectorTick) {
	if t.Price <= 0 || t.Volume <= 0 || (t.Side != "Buy" && t.Side != "Sell") || t.TimestampMs <= 0 {
		return
	}

	d.finalizeExpiredObservationWindows(t.TimestampMs)

	openTime := candleOpenTimeForDetector(t.TimestampMs)
	if d.currentCandle.OpenTime == 0 || d.currentCandle.OpenTime != openTime {
		d.currentCandle = newDetectorCandle(openTime)
	}

	if t.Side == "Buy" {
		d.currentCVD += t.Volume
	} else {
		d.currentCVD -= t.Volume
	}
	addDetectorTrade(&d.currentCandle, t, d.tickSize, d.currentCVD)

	validRanges := d.validRanges()
	for _, box := range validRanges {
		if d.lastTickPrice <= box.High && t.Price > box.High {
			d.tryCreateSweepCandidate("UP", box, t.TimestampMs, t.Price)
		}
		if d.lastTickPrice >= box.Low && t.Price < box.Low {
			d.tryCreateSweepCandidate("DOWN", box, t.TimestampMs, t.Price)
		}
	}

	d.lastTickPrice = t.Price
}

func (d *SweepDetector) handleBook(update DetectorBookUpdate) {
	eventTime := update.EventTimeMs
	if eventTime <= 0 {
		eventTime = time.Now().UnixMilli()
	}

	d.finalizeExpiredObservationWindows(eventTime)

	d.bookMirror = copyLevelSizeMap(update.Levels)
	for price, size := range d.bookMirror {
		d.recordLevelSample(price, size)
	}

	for index := range d.activeCandidates {
		candidate := &d.activeCandidates[index]
		if candidate.AwaitingReclaim {
			continue
		}
		if eventTime-candidate.TimestampMs > 200 {
			continue
		}
		currentSize := d.bookMirror[candidate.SweptLevel]
		if currentSize < candidate.MinObserved {
			candidate.MinObserved = currentSize
		}
	}
}

func (d *SweepDetector) handleClosedBar(bar DetectorCandle) {
	if bar.OpenTime == 0 {
		return
	}

	d.finalizeExpiredObservationWindows(bar.OpenTime + int64(time.Minute/time.Millisecond))
	d.updateTrackedEventsForClosedBar(bar)

	if d.currentCandle.OpenTime == bar.OpenTime {
		d.currentCandle = DetectorCandle{}
	}
	d.currentCVD = bar.CVD

	d.closedBars = append(d.closedBars, sanitizeDetectorCandle(bar))
	if len(d.closedBars) > 64 {
		d.closedBars = d.closedBars[len(d.closedBars)-64:]
	}

	dayStart := utcDayStart(bar.OpenTime)
	if d.sessionDayStart > 0 {
		if dayStart == d.sessionDayStart {
			d.sessionBars = append(d.sessionBars, sanitizeDetectorCandle(bar))
			if len(d.sessionBars) > 1600 {
				d.sessionBars = d.sessionBars[len(d.sessionBars)-1600:]
			}
		} else if dayStart > d.sessionDayStart {
			d.sessionBars = nil
			d.sessionTotalSignals = 0
		}
	}

	if d.localRange != nil {
		if updateRangeLifecycle(d.localRange, bar, d.tickSize) {
			d.localRange = nil
		}
	}
	if d.localRange == nil {
		if nextRange, ok := buildLocalRange(d.closedBars, d.tickSize); ok {
			d.localRange = &nextRange
		}
	}

	if d.sessionRange != nil && dayStart == d.sessionDayStart {
		if updateRangeLifecycle(d.sessionRange, bar, d.tickSize) {
			d.sessionRange = nil
		}
	}

	d.evaluateReclaims(bar)
	d.publishSnapshot()
}

func (d *SweepDetector) validRanges() []RangeBox {
	ranges := make([]RangeBox, 0, 2)
	if d.localRange != nil {
		ranges = append(ranges, *d.localRange)
	}
	if d.sessionRange != nil {
		ranges = append(ranges, *d.sessionRange)
	}
	return ranges
}

func (d *SweepDetector) tryCreateSweepCandidate(direction string, box RangeBox, timestampMs int64, price float64) {
	if d.currentCandle.OpenTime == 0 {
		return
	}
	edge := box.High
	if direction == "DOWN" {
		edge = box.Low
	}
	excursionTicks := math.Abs(price-edge) / d.tickSize
	maxExcursion := d.maxAllowedExcursionTicks(box.SizeTicks)
	if maxExcursion > 0 && excursionTicks > maxExcursion {
		return
	}

	restingBefore := d.bookMirror[edge]
	if restingBefore <= 0 {
		return
	}

	next := detectorCandidateState{
		SweepCandidate: SweepCandidate{
			Direction:      direction,
			SweptLevel:     edge,
			ExcursionTicks: round6(excursionTicks),
			TimestampMs:    timestampMs,
			Range:          box,
			RestingBefore:  round6(restingBefore),
		},
		SweepCandleOpenTime: d.currentCandle.OpenTime,
		SweepCandleHigh:     d.currentCandle.High,
		SweepCandleLow:      d.currentCandle.Low,
		MinObserved:         restingBefore,
	}

	replaced := false
	for index := range d.activeCandidates {
		candidate := &d.activeCandidates[index]
		if candidate.Range.Source == box.Source && candidate.Direction == direction {
			d.activeCandidates[index] = next
			replaced = true
			break
		}
	}
	if !replaced {
		d.activeCandidates = append(d.activeCandidates, next)
	}
}

func (d *SweepDetector) maxAllowedExcursionTicks(rangeSizeTicks float64) float64 {
	if rangeSizeTicks <= 0 {
		return 0
	}
	atr10 := d.computeATR10Ticks()
	if atr10 <= 0 {
		return 0.25 * rangeSizeTicks
	}
	return math.Min(0.25*rangeSizeTicks, 0.6*atr10)
}

func (d *SweepDetector) computeATR10Ticks() float64 {
	sample := lastDetectorCandles(d.closedBars, 10)
	if len(sample) == 0 {
		return 0
	}
	total := 0.0
	for _, bar := range sample {
		total += math.Abs(bar.High-bar.Low) / d.tickSize
	}
	return total / float64(len(sample))
}

func (d *SweepDetector) finalizeExpiredObservationWindows(eventTimeMs int64) {
	if len(d.activeCandidates) == 0 {
		return
	}
	filtered := make([]detectorCandidateState, 0, len(d.activeCandidates))
	for _, candidate := range d.activeCandidates {
		if candidate.AwaitingReclaim {
			filtered = append(filtered, candidate)
			continue
		}
		if eventTimeMs-candidate.TimestampMs <= 200 {
			filtered = append(filtered, candidate)
			continue
		}

		if finalized, ok := d.finalizeCandidate(candidate); ok {
			filtered = append(filtered, finalized)
		}
	}
	d.activeCandidates = filtered
}

func (d *SweepDetector) finalizeCandidate(candidate detectorCandidateState) (detectorCandidateState, bool) {
	if candidate.RestingBefore <= 0 {
		return detectorCandidateState{}, false
	}

	consumed := candidate.RestingBefore - candidate.MinObserved
	depletionRatio := 0.0
	if candidate.RestingBefore > 0 {
		depletionRatio = consumed / candidate.RestingBefore
	}
	medianLevelSize := d.medianObservedSize(candidate.SweptLevel)
	if medianLevelSize <= 0 {
		medianLevelSize = candidate.RestingBefore
	}
	adaptiveMin := math.Max(3*medianLevelSize, 1.0*candidate.SweptLevel)
	if depletionRatio < 0.30 || consumed < adaptiveMin {
		return detectorCandidateState{}, false
	}

	imbalanceCount, extremeImbalance, ok := detectExtremeImbalance(candidate.Direction, d.currentCandle)
	if !ok {
		return detectorCandidateState{}, false
	}

	deltaZscore, deltaOk := computeDeltaZscore(d.closedBars, d.currentCandle)
	if !deltaOk {
		return detectorCandidateState{}, false
	}

	if !passesCVDivergence(candidate.Direction, d.closedBars, d.currentCandle) {
		return detectorCandidateState{}, false
	}

	candidate.AwaitingReclaim = true
	candidate.DepletionRatio = round6(depletionRatio)
	candidate.ImbalanceCount = imbalanceCount
	candidate.ExtremeImbalance = extremeImbalance
	candidate.DeltaZscore = round6(deltaZscore)
	return candidate, true
}

func (d *SweepDetector) evaluateReclaims(bar DetectorCandle) {
	if len(d.activeCandidates) == 0 {
		return
	}
	remaining := make([]detectorCandidateState, 0, len(d.activeCandidates))
	nextOpenTime := func(openTime int64) int64 {
		return openTime + int64(time.Minute/time.Millisecond)
	}

	for _, candidate := range d.activeCandidates {
		if !candidate.AwaitingReclaim {
			remaining = append(remaining, candidate)
			continue
		}

		sameCandle := bar.OpenTime == candidate.SweepCandleOpenTime
		nextCandle := bar.OpenTime == nextOpenTime(candidate.SweepCandleOpenTime)
		if !sameCandle && !nextCandle {
			if bar.OpenTime > nextOpenTime(candidate.SweepCandleOpenTime) {
				continue
			}
			remaining = append(remaining, candidate)
			continue
		}

		reclaimedIn := ""
		switch candidate.Direction {
		case "UP":
			if bar.Close < candidate.Range.High-(3*d.tickSize) {
				if sameCandle {
					reclaimedIn = "same_candle"
				} else {
					reclaimedIn = "next_1m_candle"
				}
			}
		case "DOWN":
			if bar.Close > candidate.Range.Low+(3*d.tickSize) {
				if sameCandle {
					reclaimedIn = "same_candle"
				} else {
					reclaimedIn = "next_1m_candle"
				}
			}
		}

		if reclaimedIn == "" {
			if nextCandle {
				continue
			}
			remaining = append(remaining, candidate)
			continue
		}

		event, ok := buildDetectorEvent(candidate, reclaimedIn, bar.Close, d.tickSize)
		if !ok {
			continue
		}
		d.emitTrackedEvent(event, bar.OpenTime, bar.Close, candidate.Range.High-candidate.Range.Low)
	}

	d.activeCandidates = remaining
}

func (d *SweepDetector) emitTrackedEvent(event DetectorEvent, reclaimOpenTime int64, reclaimClose, rangeSpan float64) {
	d.sessionTotalSignals += 1
	d.trackedEvents = append(d.trackedEvents, TrackedEvent{
		Event:                 event,
		ReclaimClose:          reclaimClose,
		ReclaimCandleOpen:     reclaimOpenTime,
		RangeSpan:             round6(rangeSpan),
		ExpiryCountdown:       3,
		DisplayBarsRemaining: 10,
	})
	d.publishSnapshot()
}

func (d *SweepDetector) updateTrackedEventsForClosedBar(bar DetectorCandle) {
	if len(d.trackedEvents) == 0 {
		return
	}

	nextTracked := make([]TrackedEvent, 0, len(d.trackedEvents))
	for _, tracked := range d.trackedEvents {
		if tracked.Event.Outcome == "PENDING" {
			if bar.OpenTime <= tracked.ReclaimCandleOpen {
				nextTracked = append(nextTracked, tracked)
				continue
			}
			tracked.ExpiryCountdown -= 1
			if tracked.ExpiryCountdown > 0 {
				nextTracked = append(nextTracked, tracked)
				continue
			}

			tracked.Event.CloseReclaimCandle = round6(tracked.ReclaimClose)
			tracked.Event.CloseExpiryCandle = round6(bar.Close)
			tracked.Event.ResolvedCandleOpenTime = bar.OpenTime
			tracked.Event.Outcome = resolveDetectorOutcome(tracked.Event, tracked.ReclaimClose, bar.Close, tracked.RangeSpan)
			d.resolvedLog = append(d.resolvedLog, tracked.Event)
			if len(d.resolvedLog) > 100 {
				d.resolvedLog = d.resolvedLog[len(d.resolvedLog)-100:]
			}
			nextTracked = append(nextTracked, tracked)
			continue
		}

		if tracked.Event.ResolvedCandleOpenTime == 0 || bar.OpenTime <= tracked.Event.ResolvedCandleOpenTime {
			nextTracked = append(nextTracked, tracked)
			continue
		}

		tracked.DisplayBarsRemaining -= 1
		if tracked.DisplayBarsRemaining > 0 {
			nextTracked = append(nextTracked, tracked)
		}
	}

	d.trackedEvents = nextTracked
}

func (d *SweepDetector) publishSnapshot() {
	activeEvents := make([]DetectorEvent, 0, len(d.trackedEvents))
	successCount := 0
	for _, event := range d.resolvedLog {
		if event.Outcome == "SUCCESS" {
			successCount += 1
		}
	}
	for _, tracked := range d.trackedEvents {
		activeEvents = append(activeEvents, tracked.Event)
	}
	winRate := 0.0
	if len(d.resolvedLog) > 0 {
		winRate = float64(successCount) / float64(len(d.resolvedLog))
	}

	d.snapshotMu.Lock()
	d.snapshot = DetectorSnapshot{
		ActiveEvents:        copyDetectorEvents(activeEvents),
		WinRateLast100:      round6(winRate),
		TotalSignalsSession: d.sessionTotalSignals,
	}
	d.snapshotMu.Unlock()
}

func fetchInstrumentTickSize(client *http.Client, symbol string) (float64, error) {
	params := url.Values{
		"category": []string{bybitCategory},
		"symbol":   []string{symbol},
	}
	var result bybitInstrumentInfoResult
	if err := fetchBybitJSON(client, "/v5/market/instruments-info", params, &result); err != nil {
		return 0, err
	}
	if len(result.List) == 0 {
		return 0, fmt.Errorf("no instrument info for %s", symbol)
	}
	tickSize, err := strconv.ParseFloat(result.List[0].PriceFilter.TickSize, 64)
	if err != nil || tickSize <= 0 {
		return 0, fmt.Errorf("invalid tick size %q", result.List[0].PriceFilter.TickSize)
	}
	return tickSize, nil
}

func fetchPreviousUTCSessionRange(client *http.Client, symbol string, now time.Time, tickSize float64) (int64, float64, float64, error) {
	currentDayStart := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	previousStart := currentDayStart.Add(-24 * time.Hour).UnixMilli()
	previousEnd := currentDayStart.UnixMilli() - 1
	bars, err := fetchBybitKlineRange(client, symbol, previousStart, previousEnd)
	if err != nil {
		return 0, 0, 0, err
	}
	if len(bars) == 0 {
		return currentDayStart.UnixMilli(), 0, 0, fmt.Errorf("no previous-day bars")
	}
	high := 0.0
	low := 0.0
	for _, bar := range bars {
		if bar.High > high {
			high = bar.High
		}
		if low == 0 || bar.Low < low {
			low = bar.Low
		}
	}
	if high <= 0 || low <= 0 || high <= low {
		return currentDayStart.UnixMilli(), 0, 0, fmt.Errorf("invalid previous-day range")
	}
	if tickSize > 0 && (high-low)/tickSize < 20 {
		return currentDayStart.UnixMilli(), 0, 0, fmt.Errorf("previous-day range too small")
	}
	return currentDayStart.UnixMilli(), round6(high), round6(low), nil
}

func candleOpenTimeForDetector(timestampMs int64) int64 {
	return timestampMs - (timestampMs % int64(time.Minute/time.Millisecond))
}

func newDetectorCandle(openTime int64) DetectorCandle {
	return DetectorCandle{
		OpenTime: openTime,
		Buckets:  make(map[float64][2]float64),
	}
}

func addDetectorTrade(candle *DetectorCandle, trade DetectorTick, tickSize float64, currentCVD float64) {
	if candle.OpenTime == 0 {
		*candle = newDetectorCandle(candleOpenTimeForDetector(trade.TimestampMs))
	}
	if candle.Open == 0 {
		candle.Open = trade.Price
		candle.High = trade.Price
		candle.Low = trade.Price
	}
	if trade.Price > candle.High {
		candle.High = trade.Price
	}
	if trade.Price < candle.Low {
		candle.Low = trade.Price
	}
	candle.Close = trade.Price
	if trade.Side == "Buy" {
		candle.Delta += trade.Volume
	} else if trade.Side == "Sell" {
		candle.Delta -= trade.Volume
	}
	candle.CVD = currentCVD
	priceBucket := bucketDetectorPrice(trade.Price, tickSize)
	entry := candle.Buckets[priceBucket]
	if trade.Side == "Buy" {
		entry[0] += trade.Volume
	} else if trade.Side == "Sell" {
		entry[1] += trade.Volume
	}
	candle.Buckets[priceBucket] = entry
}

func bucketDetectorPrice(price, tickSize float64) float64 {
	if tickSize <= 0 {
		tickSize = rowSize
	}
	return round6(math.Floor((price+math.SmallestNonzeroFloat64)/tickSize) * tickSize)
}

func buildLocalRange(closedBars []DetectorCandle, tickSize float64) (RangeBox, bool) {
	if len(closedBars) < 5 {
		return RangeBox{}, false
	}
	window := lastDetectorCandles(closedBars, 30)
	high := 0.0
	low := 0.0
	for _, bar := range window {
		if bar.High > high {
			high = bar.High
		}
		if low == 0 || bar.Low < low {
			low = bar.Low
		}
	}
	if high <= 0 || low <= 0 || high <= low {
		return RangeBox{}, false
	}
	touchBuffer := 2 * tickSize
	touches := 0
	for _, bar := range window {
		if bar.High >= high-touchBuffer || bar.Low <= low+touchBuffer {
			touches += 1
		}
	}
	sizeTicks := (high - low) / tickSize
	if touches < 3 || sizeTicks < 20 {
		return RangeBox{}, false
	}
	return RangeBox{
		Source:    "local_range",
		High:      round6(high),
		Low:       round6(low),
		SizeTicks: round6(sizeTicks),
		Age:       len(window),
		Touches:   touches,
		Priority:  2,
	}, true
}

func updateRangeLifecycle(box *RangeBox, bar DetectorCandle, tickSize float64) bool {
	if box == nil {
		return false
	}
	box.Age += 1
	buffer := 2 * tickSize
	if bar.High >= box.High-buffer || bar.Low <= box.Low+buffer {
		box.Touches += 1
	}
	switch {
	case bar.Close > box.High:
		if box.StaleCount >= 0 {
			box.StaleCount += 1
		} else {
			box.StaleCount = 1
		}
	case bar.Close < box.Low:
		if box.StaleCount <= 0 {
			box.StaleCount -= 1
		} else {
			box.StaleCount = -1
		}
	default:
		box.StaleCount = 0
	}
	return math.Abs(float64(box.StaleCount)) >= 2
}

func lastDetectorCandles(bars []DetectorCandle, limit int) []DetectorCandle {
	if len(bars) <= limit {
		return bars
	}
	return bars[len(bars)-limit:]
}

func detectExtremeImbalance(direction string, candle DetectorCandle) (int, bool, bool) {
	if len(candle.Buckets) == 0 {
		return 0, false, false
	}
	candleRange := candle.High - candle.Low
	if candleRange <= 0 {
		return 0, false, false
	}
	count := 0
	extreme := false
	switch direction {
	case "UP":
		zoneThreshold := candle.Low + (0.80 * candleRange)
		extremeThreshold := candle.Low + (0.90 * candleRange)
		for price, volumes := range candle.Buckets {
			if price < zoneThreshold {
				continue
			}
			buyVol := volumes[0]
			sellVol := volumes[1]
			if qualifiesThreeToOne(buyVol, sellVol) {
				count += 1
				if price >= extremeThreshold {
					extreme = true
				}
			}
		}
	case "DOWN":
		zoneThreshold := candle.Low + (0.20 * candleRange)
		extremeThreshold := candle.Low + (0.10 * candleRange)
		for price, volumes := range candle.Buckets {
			if price > zoneThreshold {
				continue
			}
			buyVol := volumes[0]
			sellVol := volumes[1]
			if qualifiesThreeToOne(sellVol, buyVol) {
				count += 1
				if price <= extremeThreshold {
					extreme = true
				}
			}
		}
	}
	return count, extreme, count > 0
}

func qualifiesThreeToOne(numerator, denominator float64) bool {
	if numerator <= 0 {
		return false
	}
	if denominator <= 0 {
		return true
	}
	return numerator >= 3*denominator
}

func computeDeltaZscore(closedBars []DetectorCandle, current DetectorCandle) (float64, bool) {
	sample := lastDetectorCandles(closedBars, 20)
	if len(sample) == 0 {
		return 0, true
	}
	values := make([]float64, 0, len(sample))
	for _, bar := range sample {
		values = append(values, bar.Delta)
	}
	mean := averageFloat64(values)
	stddev := stddevFloat64(values, mean)
	if stddev == 0 {
		return 0, true
	}
	zscore := (current.Delta - mean) / stddev
	return zscore, math.Abs(zscore) >= 1.5
}

func passesCVDivergence(direction string, closedBars []DetectorCandle, current DetectorCandle) bool {
	lookback := lastDetectorCandles(closedBars, 5)
	if len(lookback) == 0 {
		return true
	}
	switch direction {
	case "UP":
		prior := lookback[0]
		for _, bar := range lookback[1:] {
			if bar.High > prior.High {
				prior = bar
			}
		}
		return current.High > prior.High && current.CVD < prior.CVD
	case "DOWN":
		prior := lookback[0]
		for _, bar := range lookback[1:] {
			if prior.Low == 0 || bar.Low < prior.Low {
				prior = bar
			}
		}
		return current.Low < prior.Low && current.CVD > prior.CVD
	default:
		return true
	}
}

func buildDetectorEvent(candidate detectorCandidateState, reclaimedIn string, reclaimClose float64, tickSize float64) (DetectorEvent, bool) {
	wickPct := computeWickPct(candidate, tickSize)
	score := 0
	if wickPct >= 25 {
		score += 1
	}
	if reclaimedIn == "same_candle" {
		score += 1
	}
	if candidate.ImbalanceCount >= 2 {
		score += 1
	}
	if candidate.DepletionRatio >= 0.50 {
		score += 1
	}
	if math.Abs(candidate.DeltaZscore) >= 1.5 {
		score += 1
	}
	if candidate.ExtremeImbalance {
		score += 1
	}
	if score < 3 {
		return DetectorEvent{}, false
	}

	strength := "MEDIUM"
	if score >= 5 {
		strength = "HIGH"
	}
	eventType := "FAILED_SWEEP_UP"
	if candidate.Direction == "DOWN" {
		eventType = "FAILED_SWEEP_DOWN"
	}
	return DetectorEvent{
		ID:                     fmt.Sprintf("%s|%s|%.1f|%d", eventType, candidate.Range.Source, candidate.SweptLevel, candidate.TimestampMs),
		Type:                   eventType,
		Strength:               strength,
		Score:                  score,
		RangeSource:            candidate.Range.Source,
		SweptLevel:             round6(candidate.SweptLevel),
		ExcursionTicks:         round6(candidate.ExcursionTicks),
		ReclaimedIn:            reclaimedIn,
		ExtremeImbalance:       candidate.ExtremeImbalance,
		DeltaZscore:            round6(candidate.DeltaZscore),
		DepletionRatio:         round6(candidate.DepletionRatio),
		WickPct:                round6(wickPct),
		ImbalanceCount:         candidate.ImbalanceCount,
		ExpiresAfter:           3,
		Outcome:                "PENDING",
		EventCandleOpenTime:    candidate.SweepCandleOpenTime,
		ResolvedCandleOpenTime: 0,
		CloseReclaimCandle:     round6(reclaimClose),
	}, true
}

func computeWickPct(candidate detectorCandidateState, tickSize float64) float64 {
	candleRange := candidate.SweepCandleHigh - candidate.SweepCandleLow
	if candleRange <= 0 {
		return 0
	}
	wickOutside := 0.0
	if candidate.Direction == "UP" {
		wickOutside = math.Max(0, candidate.SweepCandleHigh-candidate.Range.High)
	} else {
		wickOutside = math.Max(0, candidate.Range.Low-candidate.SweepCandleLow)
	}
	return (wickOutside / candleRange) * 100
}

func resolveDetectorOutcome(event DetectorEvent, reclaimClose, expiryClose, rangeSpan float64) string {
	move := 0.0
	if event.Type == "FAILED_SWEEP_UP" {
		move = reclaimClose - expiryClose
	} else {
		move = expiryClose - reclaimClose
	}
	threshold := 0.5 * rangeSpan
	if threshold <= 0 {
		threshold = InstrumentTickSize
	}
	if move >= threshold {
		return "SUCCESS"
	}
	if move > 0 {
		return "PARTIAL"
	}
	return "FAILED"
}

func sanitizeDetectorCandle(candle DetectorCandle) DetectorCandle {
	return DetectorCandle{
		OpenTime: candle.OpenTime,
		Open:     round6(candle.Open),
		High:     round6(candle.High),
		Low:      round6(candle.Low),
		Close:    round6(candle.Close),
		Delta:    round6(candle.Delta),
		CVD:      round6(candle.CVD),
		Buckets:  copyDetectorBuckets(candle.Buckets),
	}
}

func detectorCandleFromBroadcast(bar BroadcastMsg) DetectorCandle {
	buckets := make(map[float64][2]float64, len(bar.Clusters))
	for _, cluster := range bar.Clusters {
		buckets[round6(cluster.Price)] = [2]float64{round6(cluster.BuyVol), round6(cluster.SellVol)}
	}
	return DetectorCandle{
		OpenTime: bar.CandleOpenTime,
		Open:     round6(bar.Open),
		High:     round6(bar.High),
		Low:      round6(bar.Low),
		Close:    round6(bar.Close),
		Delta:    round6(bar.CandleDelta),
		CVD:      round6(bar.CVD),
		Buckets:  buckets,
	}
}

func copyDetectorBuckets(src map[float64][2]float64) map[float64][2]float64 {
	if len(src) == 0 {
		return nil
	}
	dst := make(map[float64][2]float64, len(src))
	for price, pair := range src {
		dst[price] = pair
	}
	return dst
}

func copyDetectorEvents(src []DetectorEvent) []DetectorEvent {
	if len(src) == 0 {
		return nil
	}
	dst := make([]DetectorEvent, len(src))
	copy(dst, src)
	return dst
}

func copyLevelSizeMap(src map[float64]float64) map[float64]float64 {
	if len(src) == 0 {
		return nil
	}
	dst := make(map[float64]float64, len(src))
	for price, size := range src {
		dst[price] = round6(size)
	}
	return dst
}

func (d *SweepDetector) recordLevelSample(price, size float64) {
	if price <= 0 || size <= 0 {
		return
	}
	history := append(d.levelHistory[price], size)
	if len(history) > 10 {
		history = history[len(history)-10:]
	}
	d.levelHistory[price] = history
	if len(d.levelHistory) > 5000 {
		trimmed := make(map[float64][]float64, len(d.bookMirror))
		for level := range d.bookMirror {
			if samples, ok := d.levelHistory[level]; ok {
				trimmed[level] = samples
			}
		}
		d.levelHistory = trimmed
	}
}

func (d *SweepDetector) medianObservedSize(price float64) float64 {
	samples := append([]float64(nil), d.levelHistory[price]...)
	if len(samples) == 0 {
		return 0
	}
	sort.Float64s(samples)
	mid := len(samples) / 2
	if len(samples)%2 == 1 {
		return samples[mid]
	}
	return (samples[mid-1] + samples[mid]) / 2
}

func averageFloat64(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func stddevFloat64(values []float64, mean float64) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range values {
		diff := value - mean
		total += diff * diff
	}
	return math.Sqrt(total / float64(len(values)))
}

func utcDayStart(timestampMs int64) int64 {
	date := time.UnixMilli(timestampMs).UTC()
	return time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC).UnixMilli()
}
