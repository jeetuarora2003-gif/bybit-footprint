package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ════════════════════════════════════════════════════════════════════
//  Bybit V5 inbound types
// ════════════════════════════════════════════════════════════════════

type TradeEnvelope struct {
	Topic string       `json:"topic"`
	Type  string       `json:"type"`
	Ts    int64        `json:"ts"`
	Data  []BybitTrade `json:"data"`
}

type BybitTrade struct {
	T   int64  `json:"T"`
	S   string `json:"S"`
	V   string `json:"v"`
	P   string `json:"p"`
	ID  string `json:"i"`
	Sym string `json:"s"`
	Seq int64  `json:"seq"`
	BT  bool   `json:"BT"`
}

type OrderbookEnvelope struct {
	Topic string        `json:"topic"`
	Type  string        `json:"type"`
	Ts    int64         `json:"ts"`
	Data  OrderbookData `json:"data"`
}

type OrderbookData struct {
	S   string     `json:"s"`
	B   [][]string `json:"b"`
	A   [][]string `json:"a"`
	U   int64      `json:"u"`
	Seq int64      `json:"seq"`
}

type TickerEnvelope struct {
	Topic string     `json:"topic"`
	Type  string     `json:"type"`
	Ts    int64      `json:"ts"`
	Data  TickerData `json:"data"`
}

type TickerData struct {
	Symbol            string `json:"symbol"`
	LastPrice         string `json:"lastPrice"`
	OpenInterest      string `json:"openInterest"`
	OpenInterestValue string `json:"openInterestValue"`
	FundingRate       string `json:"fundingRate"`
	MarkPrice         string `json:"markPrice"`
	IndexPrice        string `json:"indexPrice"`
	Volume24h         string `json:"volume24h"`
	Turnover24h       string `json:"turnover24h"`
}

// ════════════════════════════════════════════════════════════════════
//  Outbound types
// ════════════════════════════════════════════════════════════════════

type Cluster struct {
	Price         float64 `json:"price"`
	BuyVol        float64 `json:"buyVol"`
	SellVol       float64 `json:"sellVol"`
	Delta         float64 `json:"delta"`
	TotalVol      float64 `json:"totalVol"`
	BuyTrades     int     `json:"buyTrades"`
	SellTrades    int     `json:"sellTrades"`
	ImbalanceBuy  bool    `json:"imbalance_buy"`
	ImbalanceSell bool    `json:"imbalance_sell"`
	StackedBuy    bool    `json:"stacked_buy"`
	StackedSell   bool    `json:"stacked_sell"`
}

type BookLevel struct {
	Price float64 `json:"price"`
	Size  float64 `json:"size"`
}

type TapeTrade struct {
	ID        string  `json:"id"`
	Price     float64 `json:"price"`
	Volume    float64 `json:"volume"`
	Side      string  `json:"side"`
	Timestamp int64   `json:"timestamp"`
	Seq       int64   `json:"seq"`
}

type DepthSnapshot struct {
	Timestamp   int64       `json:"timestamp"`
	RowSize     float64     `json:"row_size"`
	BestBid     float64     `json:"best_bid"`
	BestBidSize float64     `json:"best_bid_size"`
	BestAsk     float64     `json:"best_ask"`
	BestAskSize float64     `json:"best_ask_size"`
	Bids        []BookLevel `json:"bids"`
	Asks        []BookLevel `json:"asks"`
}

type DepthEnvelope struct {
	Type    string        `json:"type"`
	Payload DepthSnapshot `json:"payload"`
}

type BroadcastMsg struct {
	CandleOpenTime int64       `json:"candle_open_time"`
	Open           float64     `json:"open"`
	High           float64     `json:"high"`
	Low            float64     `json:"low"`
	Close          float64     `json:"close"`
	RowSize        float64     `json:"row_size"`
	Clusters       []Cluster   `json:"clusters"`
	CandleDelta    float64     `json:"candle_delta"`
	CVD            float64     `json:"cvd"`
	BuyTrades      int         `json:"buy_trades"`
	SellTrades     int         `json:"sell_trades"`
	TotalVolume    float64     `json:"total_volume"`
	BuyVolume      float64     `json:"buy_volume"`
	SellVolume     float64     `json:"sell_volume"`
	OI             float64     `json:"oi"`
	OIDelta        float64     `json:"oi_delta"`
	BestBid        float64     `json:"best_bid"`
	BestBidSize    float64     `json:"best_bid_size"`
	BestAsk        float64     `json:"best_ask"`
	BestAskSize    float64     `json:"best_ask_size"`
	Bids           []BookLevel `json:"bids"`
	Asks           []BookLevel `json:"asks"`
	UnfinishedLow  bool        `json:"unfinished_low"`
	UnfinishedHigh bool        `json:"unfinished_high"`
	RecentTrades   []TapeTrade `json:"recent_trades,omitempty"`
}

// ════════════════════════════════════════════════════════════════════
//  Candle aggregator
// ════════════════════════════════════════════════════════════════════

// Bybit BTCUSDT linear priceFilter.tickSize is 0.10 as of 2026-04-08.
const rowSize = 0.10
const maxHistory = 1500
const maxSeenTradeIDs = 200000
const seenTradeIDTrimBatch = 1024
const maxRecentTrades = 1500
const maxRecentDepthSnapshots = 12000

type bucketAccum struct {
	buyVol     float64
	sellVol    float64
	buyTrades  int
	sellTrades int
}

type Candle struct {
	openTime   int64
	open       float64
	high       float64
	low        float64
	close      float64
	buckets    map[int64]*bucketAccum
	delta      float64
	buyVol     float64
	sellVol    float64
	buyTrades  int
	sellTrades int
	hasTick    bool
	lastSeq    int64
}

func newCandle(openTime int64) *Candle {
	return &Candle{openTime: openTime, buckets: make(map[int64]*bucketAccum)}
}

func (c *Candle) addTrade(price, vol float64, side string, seq int64) {
	if !c.hasTick {
		c.open, c.high, c.low = price, price, price
		c.hasTick = true
	}
	if price > c.high {
		c.high = price
	}
	if price < c.low {
		c.low = price
	}
	c.close = price
	if seq > c.lastSeq {
		c.lastSeq = seq
	}

	idx := int64(math.Floor(price / rowSize))
	b, ok := c.buckets[idx]
	if !ok {
		b = &bucketAccum{}
		c.buckets[idx] = b
	}

	if side == "Buy" {
		b.buyVol += vol
		b.buyTrades++
		c.delta += vol
		c.buyVol += vol
		c.buyTrades++
	} else if side == "Sell" {
		b.sellVol += vol
		b.sellTrades++
		c.delta -= vol
		c.sellVol += vol
		c.sellTrades++
	}
}

func (c *Candle) footprint() ([]Cluster, bool, bool) {
	clusters := make([]Cluster, 0, len(c.buckets))
	for idx, b := range c.buckets {
		clusters = append(clusters, Cluster{
			Price:      float64(idx) * rowSize,
			BuyVol:     round6(b.buyVol),
			SellVol:    round6(b.sellVol),
			Delta:      round6(b.buyVol - b.sellVol),
			TotalVol:   round6(b.buyVol + b.sellVol),
			BuyTrades:  b.buyTrades,
			SellTrades: b.sellTrades,
		})
	}
	sort.Slice(clusters, func(i, j int) bool { return clusters[i].Price < clusters[j].Price })
	unfinishedLow, unfinishedHigh := annotateClusterSignals(clusters)
	return clusters, unfinishedLow, unfinishedHigh
}

func annotateClusterSignals(clusters []Cluster) (bool, bool) {
	if len(clusters) == 0 {
		return false, false
	}

	cfg := currentStudyConfig()
	bullish := make([]bool, len(clusters))
	bearish := make([]bool, len(clusters))

	for i := range clusters {
		if i > 0 {
			below := clusters[i-1]
			if below.BuyVol > 0 && clusters[i].SellVol >= below.BuyVol*cfg.ImbalanceThreshold && clusters[i].SellVol >= cfg.MinImbalanceVolume {
				bearish[i] = true
				clusters[i].ImbalanceSell = true
			}
		}
		if i+1 < len(clusters) {
			above := clusters[i+1]
			if above.SellVol > 0 && clusters[i].BuyVol >= above.SellVol*cfg.ImbalanceThreshold && clusters[i].BuyVol >= cfg.MinImbalanceVolume {
				bullish[i] = true
				clusters[i].ImbalanceBuy = true
			}
		}
	}

	markStackedSide(clusters, bullish, true, cfg.StackedLevels)
	markStackedSide(clusters, bearish, false, cfg.StackedLevels)

	unfinishedLow := clusters[0].BuyVol > 0 && clusters[0].SellVol > 0
	unfinishedHigh := clusters[len(clusters)-1].BuyVol > 0 && clusters[len(clusters)-1].SellVol > 0
	return unfinishedLow, unfinishedHigh
}

func markStackedSide(clusters []Cluster, flags []bool, buySide bool, required int) {
	streak := make([]int, 0, len(flags))
	flush := func() {
		if len(streak) < required {
			streak = streak[:0]
			return
		}
		for _, idx := range streak {
			if buySide {
				clusters[idx].StackedBuy = true
			} else {
				clusters[idx].StackedSell = true
			}
		}
		streak = streak[:0]
	}

	for i, ok := range flags {
		if ok {
			streak = append(streak, i)
			continue
		}
		flush()
	}
	flush()
}

func copyTapeTrades(src []TapeTrade) []TapeTrade {
	if len(src) == 0 {
		return nil
	}
	dst := make([]TapeTrade, len(src))
	copy(dst, src)
	return dst
}

func copyBookLevels(src []BookLevel) []BookLevel {
	if len(src) == 0 {
		return nil
	}
	dst := make([]BookLevel, len(src))
	copy(dst, src)
	return dst
}

func copyDepthSnapshots(src []DepthSnapshot) []DepthSnapshot {
	if len(src) == 0 {
		return nil
	}
	dst := make([]DepthSnapshot, len(src))
	for i, snapshot := range src {
		dst[i] = DepthSnapshot{
			Timestamp:   snapshot.Timestamp,
			RowSize:     snapshot.RowSize,
			BestBid:     snapshot.BestBid,
			BestBidSize: snapshot.BestBidSize,
			BestAsk:     snapshot.BestAsk,
			BestAskSize: snapshot.BestAskSize,
			Bids:        copyBookLevels(snapshot.Bids),
			Asks:        copyBookLevels(snapshot.Asks),
		}
	}
	return dst
}

func lastCompletedBar(bars []BroadcastMsg) *BroadcastMsg {
	if len(bars) == 0 {
		return nil
	}
	return &bars[len(bars)-1]
}

func round6(v float64) float64 {
	return math.Round(v*1e6) / 1e6
}

// ════════════════════════════════════════════════════════════════════
//  Orderbook state
// ════════════════════════════════════════════════════════════════════

type OrderBook struct {
	mu   sync.RWMutex
	bids map[string]float64
	asks map[string]float64
}

func newOrderBook() *OrderBook {
	return &OrderBook{bids: make(map[string]float64), asks: make(map[string]float64)}
}

func (ob *OrderBook) applySnapshot(b, a [][]string) {
	ob.mu.Lock()
	defer ob.mu.Unlock()
	ob.bids = make(map[string]float64, len(b))
	ob.asks = make(map[string]float64, len(a))
	for _, lev := range b {
		if len(lev) >= 2 {
			s, _ := strconv.ParseFloat(lev[1], 64)
			ob.bids[lev[0]] = s
		}
	}
	for _, lev := range a {
		if len(lev) >= 2 {
			s, _ := strconv.ParseFloat(lev[1], 64)
			ob.asks[lev[0]] = s
		}
	}
}

func (ob *OrderBook) applyDelta(b, a [][]string) {
	ob.mu.Lock()
	defer ob.mu.Unlock()
	for _, lev := range b {
		if len(lev) < 2 {
			continue
		}
		s, _ := strconv.ParseFloat(lev[1], 64)
		if s == 0 {
			delete(ob.bids, lev[0])
		} else {
			ob.bids[lev[0]] = s
		}
	}
	for _, lev := range a {
		if len(lev) < 2 {
			continue
		}
		s, _ := strconv.ParseFloat(lev[1], 64)
		if s == 0 {
			delete(ob.asks, lev[0])
		} else {
			ob.asks[lev[0]] = s
		}
	}
}

func (ob *OrderBook) bestBidAsk() (bidP, bidS, askP, askS float64) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()
	bidP = 0
	for p, s := range ob.bids {
		pf, _ := strconv.ParseFloat(p, 64)
		if pf > bidP {
			bidP = pf
			bidS = s
		}
	}
	askP = math.MaxFloat64
	for p, s := range ob.asks {
		pf, _ := strconv.ParseFloat(p, 64)
		if pf < askP {
			askP = pf
			askS = s
		}
	}
	if askP == math.MaxFloat64 {
		askP = 0
	}
	return
}

func (ob *OrderBook) topLevels(n int) (bids, asks []BookLevel) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	bids = make([]BookLevel, 0, len(ob.bids))
	for p, s := range ob.bids {
		pf, _ := strconv.ParseFloat(p, 64)
		bids = append(bids, BookLevel{Price: pf, Size: s})
	}
	sort.Slice(bids, func(i, j int) bool { return bids[i].Price > bids[j].Price })
	if len(bids) > n {
		bids = bids[:n]
	}

	asks = make([]BookLevel, 0, len(ob.asks))
	for p, s := range ob.asks {
		pf, _ := strconv.ParseFloat(p, 64)
		asks = append(asks, BookLevel{Price: pf, Size: s})
	}
	sort.Slice(asks, func(i, j int) bool { return asks[i].Price < asks[j].Price })
	if len(asks) > n {
		asks = asks[:n]
	}
	return
}

// ════════════════════════════════════════════════════════════════════
//  OI tracker
// ════════════════════════════════════════════════════════════════════

type OITracker struct {
	mu      sync.RWMutex
	current float64
	prevBar float64
}

func (oi *OITracker) update(val float64) {
	oi.mu.Lock()
	oi.current = val
	oi.mu.Unlock()
}

func (oi *OITracker) get() float64 {
	oi.mu.RLock()
	defer oi.mu.RUnlock()
	return oi.current
}

func (oi *OITracker) barClose() float64 {
	oi.mu.Lock()
	defer oi.mu.Unlock()
	delta := oi.current - oi.prevBar
	oi.prevBar = oi.current
	return delta
}

func (oi *OITracker) delta() float64 {
	oi.mu.RLock()
	defer oi.mu.RUnlock()
	return oi.current - oi.prevBar
}

// ════════════════════════════════════════════════════════════════════
//  Hub
// ════════════════════════════════════════════════════════════════════

type clientConfig struct {
	Timeframe      string
	TickMultiplier float64
}

type hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]clientConfig
}

func newHub() *hub { return &hub{clients: make(map[*websocket.Conn]clientConfig)} }

func (h *hub) add(c *websocket.Conn, cfg clientConfig) {
	h.mu.Lock()
	h.clients[c] = cfg
	h.mu.Unlock()
}

func (h *hub) remove(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	c.Close()
}

func (h *hub) broadcast(data []byte) {
	h.mu.RLock()
	clients := make([]*websocket.Conn, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()
	for _, c := range clients {
		if err := c.WriteMessage(websocket.TextMessage, data); err != nil {
			go h.remove(c)
		}
	}
}

func (h *hub) broadcastCandles(history []BroadcastMsg, live BroadcastMsg) {
	h.mu.RLock()
	clients := make(map[*websocket.Conn]clientConfig, len(h.clients))
	for conn, cfg := range h.clients {
		clients[conn] = cfg
	}
	h.mu.RUnlock()

	for conn, cfg := range clients {
		if err := sendAggregatedCandle(conn, cfg, history, live); err != nil {
			go h.remove(conn)
		}
	}
}

func sendAggregatedCandle(conn *websocket.Conn, cfg clientConfig, history []BroadcastMsg, live BroadcastMsg) error {
	source := make([]BroadcastMsg, 0, len(history)+1)
	source = append(source, history...)
	if live.CandleOpenTime > 0 {
		source = append(source, live)
	}
	aggregated := aggregateBroadcastBars(source, cfg.Timeframe, cfg.TickMultiplier)
	if len(aggregated) == 0 {
		return nil
	}

	payload, err := json.Marshal(struct {
		Type    string       `json:"type"`
		Payload BroadcastMsg `json:"payload"`
	}{
		Type:    "candle",
		Payload: aggregated[len(aggregated)-1],
	})
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, payload)
}

// ════════════════════════════════════════════════════════════════════
//  Exponential backoff
// ════════════════════════════════════════════════════════════════════

const (
	maxRetries    = 5
	baseBackoff   = 1 * time.Second
	maxBackoff    = 30 * time.Second
	backoffFactor = 2.0
)

func backoffDuration(attempt int) time.Duration {
	d := time.Duration(float64(baseBackoff) * math.Pow(backoffFactor, float64(attempt)))
	if d > maxBackoff {
		d = maxBackoff
	}
	return d
}

// ════════════════════════════════════════════════════════════════════
//  Main
// ════════════════════════════════════════════════════════════════════

func main() {
	h := newHub()
	ob := newOrderBook()
	oi := &OITracker{}
	configStore, err := newStudyConfigStore("data/study-config.json")
	if err != nil {
		log.Fatalf("study config init: %v", err)
	}
	runtimeStudyConfig = configStore
	store, err := newPersistenceStore("data")
	if err != nil {
		log.Fatalf("persistence init: %v", err)
	}

	var (
		mu            sync.Mutex
		cvd           float64
		candle        *Candle
		lastSeq       int64
		seenTradeIDs  []string
		seenTradeSet  map[string]struct{}
		completedBars []BroadcastMsg
		recentTrades  []TapeTrade
		recentDepth   []DepthSnapshot
	)
	seenTradeSet = make(map[string]struct{}, maxSeenTradeIDs)
	restClient := &http.Client{Timeout: 10 * time.Second}

	if loadedBars, loadedTrades, loadedDepth, err := store.Load(); err != nil {
		log.Printf("[store] load failed, starting empty: %v", err)
	} else {
		completedBars = loadedBars
		recentTrades = loadedTrades
		recentDepth = loadedDepth
		log.Printf("[store] loaded %d bars, %d tape prints, %d depth snapshots", len(completedBars), len(recentTrades), len(recentDepth))
	}

	candleOpenTime := func(tsMs int64) int64 {
		return tsMs - (tsMs % 60000)
	}

	if len(completedBars) > 0 {
		earliestTs := completedBars[0].CandleOpenTime
		if snapshots, err := fetchBybitOpenInterestHistory(restClient, "BTCUSDT", earliestTs); err != nil {
			log.Printf("[bybit] OI history seed failed: %v", err)
		} else if applyOfficialOpenInterest(completedBars, snapshots) {
			if err := store.ReplaceBars(completedBars); err != nil {
				log.Printf("[store] bar rewrite failed: %v", err)
			}
		}
	}

	if lastBar := lastCompletedBar(completedBars); lastBar != nil {
		cvd = lastBar.CVD
		oi.current = lastBar.OI
		oi.prevBar = lastBar.OI
	}

	if seededTrades, err := fetchBybitRecentTrades(restClient, "BTCUSDT", 1000); err != nil {
		log.Printf("[bybit] recent trade seed failed: %v", err)
	} else {
		recentTrades = mergeTapeTrades(recentTrades, seededTrades)
		if err := store.ReplaceTrades(recentTrades); err != nil {
			log.Printf("[store] tape rewrite failed: %v", err)
		}
	}

	seedSeenTradeIDs(recentTrades, seenTradeSet, &seenTradeIDs)

	replayAfterTs := int64(0)
	if lastBar := lastCompletedBar(completedBars); lastBar != nil {
		replayAfterTs = lastBar.CandleOpenTime + int64(time.Minute/time.Millisecond)
	}
	rebuildCurrentFromTape(recentTrades, replayAfterTs, candleOpenTime, &candle, &cvd, &lastSeq)

	if currentOI, err := fetchBybitCurrentOpenInterest(restClient, "BTCUSDT"); err != nil {
		log.Printf("[bybit] current OI seed failed: %v", err)
	} else if currentOI > 0 {
		oi.update(currentOI)
	}

	// FIX #5: processTrade is called only from single-threaded tradeCh goroutine — no races
	processTrade := func(price, vol float64, side string, ts, seq int64, tradeID string) {
		mu.Lock()
		defer mu.Unlock()

		if side != "Buy" && side != "Sell" {
			return
		}

		if tradeID != "" {
			if _, ok := seenTradeSet[tradeID]; ok {
				return
			}
			seenTradeSet[tradeID] = struct{}{}
			seenTradeIDs = append(seenTradeIDs, tradeID)
			if len(seenTradeIDs) > maxSeenTradeIDs+seenTradeIDTrimBatch {
				for _, oldID := range seenTradeIDs[:seenTradeIDTrimBatch] {
					delete(seenTradeSet, oldID)
				}
				seenTradeIDs = seenTradeIDs[seenTradeIDTrimBatch:]
			}
		}

		if seq > lastSeq {
			lastSeq = seq
		}

		recentTrades = append(recentTrades, TapeTrade{
			ID:        tradeID,
			Price:     round6(price),
			Volume:    round6(vol),
			Side:      side,
			Timestamp: ts,
			Seq:       seq,
		})
		if len(recentTrades) > maxRecentTrades {
			recentTrades = recentTrades[len(recentTrades)-maxRecentTrades:]
		}
		if err := store.AppendTrade(recentTrades[len(recentTrades)-1], recentTrades); err != nil {
			log.Printf("[store] tape append failed: %v", err)
		}

		openT := candleOpenTime(ts)
		if candle == nil || openT != candle.openTime {
			// FIX #1 + #6: Snapshot the closing bar (with full clusters + closed OI delta) into completedBars
			if candle != nil && candle.hasTick {
				clusters, unfinishedLow, unfinishedHigh := candle.footprint()
				closedOIDelta := oi.barClose()
				bidP, bidS, askP, askS := ob.bestBidAsk()
				bids, asks := ob.topLevels(15)
				snapshot := BroadcastMsg{
					CandleOpenTime: candle.openTime,
					Open:           candle.open,
					High:           candle.high,
					Low:            candle.low,
					Close:          candle.close,
					RowSize:        rowSize,
					Clusters:       clusters,
					CandleDelta:    round6(candle.delta),
					CVD:            round6(cvd),
					BuyTrades:      candle.buyTrades,
					SellTrades:     candle.sellTrades,
					TotalVolume:    round6(candle.buyVol + candle.sellVol),
					BuyVolume:      round6(candle.buyVol),
					SellVolume:     round6(candle.sellVol),
					OI:             oi.get(),
					OIDelta:        closedOIDelta,
					BestBid:        bidP,
					BestBidSize:    bidS,
					BestAsk:        askP,
					BestAskSize:    askS,
					Bids:           bids,
					Asks:           asks,
					UnfinishedLow:  unfinishedLow,
					UnfinishedHigh: unfinishedHigh,
				}
				completedBars = append(completedBars, snapshot)
				// Cap history to last maxHistory bars
				if len(completedBars) > maxHistory {
					completedBars = completedBars[len(completedBars)-maxHistory:]
				}
				if err := store.AppendBar(snapshot, completedBars); err != nil {
					log.Printf("[store] bar append failed: %v", err)
				}
			} else if candle != nil {
				// bar rotated but had no ticks — still advance OI baseline
				oi.barClose()
			}
			candle = newCandle(openT)
		}
		candle.addTrade(price, vol, side, seq)
		if side == "Buy" {
			cvd += vol
		} else if side == "Sell" {
			cvd -= vol
		}
	}

	// FIX #5: Separate channels for trades (serial) vs orderbook/ticker (parallel)
	tradeCh := make(chan []byte, 1024)
	miscCh := make(chan []byte, 512)

	// Single-threaded trade processor — preserves order
	go func() {
		for raw := range tradeCh {
			var env TradeEnvelope
			if err := json.Unmarshal(raw, &env); err != nil {
				continue
			}
			for _, bt := range env.Data {
				price, _ := strconv.ParseFloat(bt.P, 64)
				vol, _ := strconv.ParseFloat(bt.V, 64)
				if price == 0 || vol == 0 {
					continue
				}
				processTrade(price, vol, bt.S, bt.T, bt.Seq, bt.ID)
			}
		}
	}()

	// Orderbook deltas are order-dependent, so keep misc market data serial.
	go func() {
		for raw := range miscCh {
			s := string(raw)
			if strings.Contains(s, `"orderbook.`) {
				var env OrderbookEnvelope
				if err := json.Unmarshal(raw, &env); err != nil {
					continue
				}
				if env.Type == "snapshot" || env.Data.U == 1 {
					ob.applySnapshot(env.Data.B, env.Data.A)
				} else {
					ob.applyDelta(env.Data.B, env.Data.A)
				}
			} else if strings.Contains(s, `"tickers.`) {
				var env TickerEnvelope
				if err := json.Unmarshal(raw, &env); err != nil {
					continue
				}
				if env.Data.OpenInterest != "" {
					val, _ := strconv.ParseFloat(env.Data.OpenInterest, 64)
					if val > 0 {
						oi.update(val)
					}
				}
			}
		}
	}()

	// ── Bybit reader with exponential backoff ──
	go func() {
		attempt := 0
		for {
			err := connectBybit(tradeCh, miscCh)
			if err != nil {
				attempt++
				wait := backoffDuration(attempt - 1)
				if attempt > maxRetries {
					log.Printf("[bybit] max retries (%d) exceeded — resetting", maxRetries)
					attempt = 0
					wait = baseBackoff
				}
				log.Printf("[bybit] error: %v — retry %d in %v", err, attempt, wait)
				time.Sleep(wait)
			} else {
				attempt = 0
			}
		}
	}()

	// ── 500ms live broadcast ticker ──
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			mu.Lock()
			if candle == nil || !candle.hasTick {
				mu.Unlock()
				continue
			}

			bidP, bidS, askP, askS := ob.bestBidAsk()
			bids, asks := ob.topLevels(15)
			clusters, unfinishedLow, unfinishedHigh := candle.footprint()
			tape := copyTapeTrades(recentTrades)
			depthSnapshot := DepthSnapshot{
				Timestamp:   time.Now().UnixMilli(),
				RowSize:     rowSize,
				BestBid:     bidP,
				BestBidSize: bidS,
				BestAsk:     askP,
				BestAskSize: askS,
				Bids:        copyBookLevels(bids),
				Asks:        copyBookLevels(asks),
			}
			if len(depthSnapshot.Bids) > 0 || len(depthSnapshot.Asks) > 0 {
				recentDepth = append(recentDepth, depthSnapshot)
				if len(recentDepth) > maxRecentDepthSnapshots {
					recentDepth = recentDepth[len(recentDepth)-maxRecentDepthSnapshots:]
				}
				if err := store.AppendDepth(depthSnapshot, recentDepth); err != nil {
					log.Printf("[store] depth append failed: %v", err)
				}
			}

			msg := BroadcastMsg{
				CandleOpenTime: candle.openTime,
				Open:           candle.open,
				High:           candle.high,
				Low:            candle.low,
				Close:          candle.close,
				RowSize:        rowSize,
				Clusters:       clusters,
				CandleDelta:    round6(candle.delta),
				CVD:            round6(cvd),
				BuyTrades:      candle.buyTrades,
				SellTrades:     candle.sellTrades,
				TotalVolume:    round6(candle.buyVol + candle.sellVol),
				BuyVolume:      round6(candle.buyVol),
				SellVolume:     round6(candle.sellVol),
				OI:             oi.get(),
				OIDelta:        oi.delta(),
				BestBid:        bidP,
				BestBidSize:    bidS,
				BestAsk:        askP,
				BestAskSize:    askS,
				Bids:           bids,
				Asks:           asks,
				UnfinishedLow:  unfinishedLow,
				UnfinishedHigh: unfinishedHigh,
				RecentTrades:   tape,
			}
			historySnapshot := copyBroadcastBars(completedBars)
			mu.Unlock()

			h.broadcastCandles(historySnapshot, msg)

			if len(depthSnapshot.Bids) > 0 || len(depthSnapshot.Asks) > 0 {
				depthData, err := json.Marshal(DepthEnvelope{
					Type:    "depth",
					Payload: depthSnapshot,
				})
				if err == nil {
					h.broadcast(depthData)
				}
			}
		}
	}()

	// ── HTTP routes ──
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	// FIX #1: /history returns completed bars with full clusters for frontend preload
	http.HandleFunc("/history", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		timeframe := normalizeTimeframe(r.URL.Query().Get("timeframe"))
		tickMultiplier := parseTickMultiplier(r.URL.Query().Get("tickSize"))
		mu.Lock()
		historySnapshot := copyBroadcastBars(completedBars)
		mu.Unlock()
		data, err := json.Marshal(aggregateBroadcastBars(historySnapshot, timeframe, tickMultiplier))
		if err != nil {
			http.Error(w, "marshal error", 500)
			return
		}
		w.Write(data)
	})

	http.HandleFunc("/tape", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		data, err := json.Marshal(copyTapeTrades(recentTrades))
		mu.Unlock()
		if err != nil {
			http.Error(w, "marshal error", 500)
			return
		}
		w.Write(data)
	})

	http.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		switch r.Method {
		case http.MethodGet:
			data, err := json.Marshal(currentStudyConfig())
			if err != nil {
				http.Error(w, "marshal error", 500)
				return
			}
			w.Write(data)
		case http.MethodPost:
			var next StudyConfig
			if err := json.NewDecoder(r.Body).Decode(&next); err != nil {
				http.Error(w, "bad config payload", 400)
				return
			}
			if err := configStore.Update(next); err != nil {
				http.Error(w, "config update failed", 500)
				return
			}
			data, err := json.Marshal(configStore.Get())
			if err != nil {
				http.Error(w, "marshal error", 500)
				return
			}
			w.Write(data)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	http.HandleFunc("/depth-history", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		data, err := json.Marshal(copyDepthSnapshots(recentDepth))
		mu.Unlock()
		if err != nil {
			http.Error(w, "marshal error", 500)
			return
		}
		w.Write(data)
	})

	// ── Local WS server on :8080 ──
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		cfg := clientConfig{
			Timeframe:      normalizeTimeframe(r.URL.Query().Get("timeframe")),
			TickMultiplier: parseTickMultiplier(r.URL.Query().Get("tickSize")),
		}
		log.Printf("[ws] client connected: %s", conn.RemoteAddr())
		h.add(conn, cfg)

		mu.Lock()
		historySnapshot := copyBroadcastBars(completedBars)
		var liveSnapshot BroadcastMsg
		if candle != nil && candle.hasTick {
			bidP, bidS, askP, askS := ob.bestBidAsk()
			bids, asks := ob.topLevels(15)
			clusters, unfinishedLow, unfinishedHigh := candle.footprint()
			liveSnapshot = BroadcastMsg{
				CandleOpenTime: candle.openTime,
				Open:           candle.open,
				High:           candle.high,
				Low:            candle.low,
				Close:          candle.close,
				RowSize:        rowSize,
				Clusters:       clusters,
				CandleDelta:    round6(candle.delta),
				CVD:            round6(cvd),
				BuyTrades:      candle.buyTrades,
				SellTrades:     candle.sellTrades,
				TotalVolume:    round6(candle.buyVol + candle.sellVol),
				BuyVolume:      round6(candle.buyVol),
				SellVolume:     round6(candle.sellVol),
				OI:             oi.get(),
				OIDelta:        oi.delta(),
				BestBid:        bidP,
				BestBidSize:    bidS,
				BestAsk:        askP,
				BestAskSize:    askS,
				Bids:           bids,
				Asks:           asks,
				UnfinishedLow:  unfinishedLow,
				UnfinishedHigh: unfinishedHigh,
				RecentTrades:   copyTapeTrades(recentTrades),
			}
		}
		mu.Unlock()

		if err := sendAggregatedCandle(conn, cfg, historySnapshot, liveSnapshot); err != nil {
			h.remove(conn)
			return
		}
		go func() {
			defer h.remove(conn)
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					break
				}
			}
		}()
	})

	fmt.Println("▶  Footprint WS server on :8080")
	fmt.Println("   Streams: publicTrade + orderbook.50 + tickers (BTCUSDT)")
	fmt.Println("   History endpoint: GET /history")
	fmt.Println("   Depth history endpoint: GET /depth-history")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

// ════════════════════════════════════════════════════════════════════
//  Bybit V5 WebSocket — FIX #5: separate tradeCh and miscCh
// ════════════════════════════════════════════════════════════════════

func connectBybit(tradeCh chan<- []byte, miscCh chan<- []byte) error {
	const url = "wss://stream.bybit.com/v5/public/linear"

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.Dial(url, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	log.Println("[bybit] connected — subscribing to 3 topics …")

	sub := map[string]interface{}{
		"op": "subscribe",
		"args": []string{
			"publicTrade.BTCUSDT",
			"orderbook.50.BTCUSDT",
			"tickers.BTCUSDT",
		},
	}
	if err := conn.WriteJSON(sub); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}

	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for range t.C {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"op":"ping"}`)); err != nil {
				return
			}
		}
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}

		s := string(raw)
		if strings.Contains(s, `"publicTrade.`) {
			// FIX #5: trades go to dedicated serial channel
			select {
			case tradeCh <- raw:
			default:
				log.Println("[warn] tradeCh full — dropping trade batch")
			}
		} else if strings.Contains(s, `"orderbook.`) || strings.Contains(s, `"tickers.`) {
			select {
			case miscCh <- raw:
			default:
			}
		}
	}
}
