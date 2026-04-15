package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
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
	CTS int64      `json:"cts"`
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
	Price          float64 `json:"price"`
	BuyVol         float64 `json:"buyVol"`
	SellVol        float64 `json:"sellVol"`
	Delta          float64 `json:"delta"`
	TotalVol       float64 `json:"totalVol"`
	BuyTrades      int     `json:"buyTrades"`
	SellTrades     int     `json:"sellTrades"`
	MaxTradeBuy    float64 `json:"maxTradeBuy"`
	MaxTradeSell   float64 `json:"maxTradeSell"`
	BidAskRatio    float64 `json:"bidAskRatio"`
	ImbalanceBuy   bool    `json:"imbalance_buy"`
	ImbalanceSell  bool    `json:"imbalance_sell"`
	StackedBuy     bool    `json:"stacked_buy"`
	StackedSell    bool    `json:"stacked_sell"`
	LargeTradeBuy  bool    `json:"large_trade_buy"`
	LargeTradeSell bool    `json:"large_trade_sell"`
	AbsorptionBuy  bool    `json:"absorption_buy"`
	AbsorptionSell bool    `json:"absorption_sell"`
	ExhaustionBuy  bool    `json:"exhaustion_buy"`
	ExhaustionSell bool    `json:"exhaustion_sell"`
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
	CandleOpenTime      int64       `json:"candle_open_time"`
	Open                float64     `json:"open"`
	High                float64     `json:"high"`
	Low                 float64     `json:"low"`
	Close               float64     `json:"close"`
	RowSize             float64     `json:"row_size"`
	Clusters            []Cluster   `json:"clusters"`
	CandleDelta         float64     `json:"candle_delta"`
	CVD                 float64     `json:"cvd"`
	BuyTrades           int         `json:"buy_trades"`
	SellTrades          int         `json:"sell_trades"`
	TotalVolume         float64     `json:"total_volume"`
	BuyVolume           float64     `json:"buy_volume"`
	SellVolume          float64     `json:"sell_volume"`
	OI                  float64     `json:"oi"`
	OIDelta             float64     `json:"oi_delta"`
	BestBid             float64     `json:"best_bid"`
	BestBidSize         float64     `json:"best_bid_size"`
	BestAsk             float64     `json:"best_ask"`
	BestAskSize         float64     `json:"best_ask_size"`
	Bids                []BookLevel `json:"bids"`
	Asks                []BookLevel `json:"asks"`
	UnfinishedLow       bool        `json:"unfinished_low"`
	UnfinishedHigh      bool        `json:"unfinished_high"`
	AbsorptionLow       bool        `json:"absorption_low"`
	AbsorptionHigh      bool        `json:"absorption_high"`
	ExhaustionLow       bool        `json:"exhaustion_low"`
	ExhaustionHigh      bool        `json:"exhaustion_high"`
	SweepBuy            bool        `json:"sweep_buy"`
	SweepSell           bool        `json:"sweep_sell"`
	DeltaDivergenceBull bool        `json:"delta_divergence_bull"`
	DeltaDivergenceBear bool        `json:"delta_divergence_bear"`
	RecentTrades        []TapeTrade `json:"recent_trades,omitempty"`
	Alerts              []string    `json:"alerts,omitempty"`
	OrderflowCoverage   float64     `json:"orderflow_coverage"`
	DataSource          string      `json:"data_source,omitempty"`
}

type instrumentResponse struct {
	Symbol           string  `json:"symbol"`
	BaseCoin         string  `json:"baseCoin"`
	QuoteCoin        string  `json:"quoteCoin"`
	TickSize         float64 `json:"tickSize"`
	QtyStep          float64 `json:"qtyStep"`
	MinOrderQty      float64 `json:"minOrderQty"`
	MaxOrderQty      float64 `json:"maxOrderQty"`
	MinNotionalValue float64 `json:"minNotionalValue"`
	PriceScale       int     `json:"priceScale"`
	VolumeUnit       string  `json:"volumeUnit"`
	SyntheticBTC     bool    `json:"syntheticBtc"`
	DefaultTicks     []int   `json:"defaultTicks"`
}

// ════════════════════════════════════════════════════════════════════
//  Candle aggregator
// ════════════════════════════════════════════════════════════════════

const (
	bybitSymbol             = "BTCUSD"
	bybitCategory           = "inverse"
	bybitWSURL              = "wss://stream.bybit.com/v5/public/inverse"
	rootFeedIdentity        = "bybit:inverse:BTCUSD:raw-contracts-v1"
	rowSize                 = 0.10
	maxHistory              = 1000
	maxSeenTradeIDs         = 200000
	seenTradeIDTrimBatch    = 1024
	maxRecentTrades         = 1000
	maxRecentDepthSnapshots = 1000
	defaultHTTPPort         = "8080"
	bybitReconnectDelay     = 1 * time.Second
)


type bucketAccum struct {
	buyVol       float64
	sellVol      float64
	buyTrades    int
	sellTrades   int
	maxBuyTrade  float64
	maxSellTrade float64
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
		if vol > b.maxBuyTrade {
			b.maxBuyTrade = vol
		}
		c.delta += vol
		c.buyVol += vol
		c.buyTrades++
	} else if side == "Sell" {
		b.sellVol += vol
		b.sellTrades++
		if vol > b.maxSellTrade {
			b.maxSellTrade = vol
		}
		c.delta -= vol
		c.sellVol += vol
		c.sellTrades++
	}
}

func (c *Candle) footprint() ([]Cluster, clusterSignalSummary) {
	clusters := make([]Cluster, 0, len(c.buckets))
	for idx, b := range c.buckets {
		clusters = append(clusters, Cluster{
			Price:        float64(idx) * rowSize,
			BuyVol:       round6(b.buyVol),
			SellVol:      round6(b.sellVol),
			Delta:        round6(b.buyVol - b.sellVol),
			TotalVol:     round6(b.buyVol + b.sellVol),
			BuyTrades:    b.buyTrades,
			SellTrades:   b.sellTrades,
			MaxTradeBuy:  round6(b.maxBuyTrade),
			MaxTradeSell: round6(b.maxSellTrade),
		})
	}
	sort.Slice(clusters, func(i, j int) bool { return clusters[i].Price < clusters[j].Price })
	summary := annotateClusterSignals(clusters)
	return clusters, summary
}

type clusterSignalSummary struct {
	UnfinishedLow   bool
	UnfinishedHigh  bool
	AbsorptionLow   bool
	AbsorptionHigh  bool
	ExhaustionLow   bool
	ExhaustionHigh  bool
	ImbalanceCount  int
	StackedCount    int
	LargeTradeCount int
}

func annotateClusterSignals(clusters []Cluster) clusterSignalSummary {
	if len(clusters) == 0 {
		return clusterSignalSummary{}
	}

	cfg := currentStudyConfig()
	bullish := make([]bool, len(clusters))
	bearish := make([]bool, len(clusters))
	summary := clusterSignalSummary{}
	avgTotalVol := 0.0
	for _, cluster := range clusters {
		avgTotalVol += cluster.TotalVol
	}
	avgTotalVol /= math.Max(1, float64(len(clusters)))

	for i := range clusters {
		cluster := &clusters[i]
		cluster.BidAskRatio = round6((cluster.BuyVol + 1e-9) / (cluster.SellVol + 1e-9))
		cluster.LargeTradeBuy = cluster.MaxTradeBuy >= cfg.LargeTradeThreshold
		cluster.LargeTradeSell = cluster.MaxTradeSell >= cfg.LargeTradeThreshold
		if cluster.LargeTradeBuy || cluster.LargeTradeSell {
			summary.LargeTradeCount += 1
		}
		if i > 0 {
			below := clusters[i-1]
			if below.SellVol > 0 && cluster.BuyVol >= below.SellVol*cfg.ImbalanceThreshold && cluster.BuyVol >= cfg.MinImbalanceVolume {
				bullish[i] = true
				cluster.ImbalanceBuy = true
				summary.ImbalanceCount += 1
			}
		}
		if i+1 < len(clusters) {
			above := clusters[i+1]
			if above.BuyVol > 0 && cluster.SellVol >= above.BuyVol*cfg.ImbalanceThreshold && cluster.SellVol >= cfg.MinImbalanceVolume {
				bearish[i] = true
				cluster.ImbalanceSell = true
				summary.ImbalanceCount += 1
			}
		}
	}

	summary.StackedCount += markStackedSide(clusters, bullish, true, cfg.StackedLevels)
	summary.StackedCount += markStackedSide(clusters, bearish, false, cfg.StackedLevels)

	low := &clusters[0]
	high := &clusters[len(clusters)-1]
	summary.UnfinishedLow = low.BuyVol > 0 && low.SellVol > 0
	summary.UnfinishedHigh = high.BuyVol > 0 && high.SellVol > 0

	highVolumeThreshold := avgTotalVol * cfg.AbsorptionVolumeFactor
	lowVolumeThreshold := avgTotalVol * cfg.ExhaustionVolumeFactor

	if low.TotalVol >= highVolumeThreshold && low.BuyVol > 0 && low.SellVol > 0 && low.BuyVol >= low.SellVol*cfg.AbsorptionRatioThreshold {
		low.AbsorptionBuy = true
		summary.AbsorptionLow = true
	}
	if high.TotalVol >= highVolumeThreshold && high.BuyVol > 0 && high.SellVol > 0 && high.SellVol >= high.BuyVol*cfg.AbsorptionRatioThreshold {
		high.AbsorptionSell = true
		summary.AbsorptionHigh = true
	}
	if low.TotalVol > 0 && low.TotalVol <= lowVolumeThreshold && low.SellVol >= low.BuyVol*cfg.BidAskRatioThreshold {
		low.ExhaustionSell = true
		summary.ExhaustionLow = true
	}
	if high.TotalVol > 0 && high.TotalVol <= lowVolumeThreshold && high.BuyVol >= high.SellVol*cfg.BidAskRatioThreshold {
		high.ExhaustionBuy = true
		summary.ExhaustionHigh = true
	}

	return summary
}

func markStackedSide(clusters []Cluster, flags []bool, buySide bool, required int) int {
	streak := make([]int, 0, len(flags))
	marked := 0
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
			marked += 1
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
	return marked
}

func buildCandleAlerts(msg *BroadcastMsg, summary clusterSignalSummary) []string {
	if msg == nil || msg.OrderflowCoverage <= 0 {
		return nil
	}

	cfg := currentStudyConfig()
	alerts := make([]string, 0, 8)
	if summary.ImbalanceCount > 0 {
		if summary.StackedCount > 0 {
			alerts = append(alerts, "STACKED IMB")
		} else {
			alerts = append(alerts, "IMB")
		}
	}
	if summary.AbsorptionLow || summary.AbsorptionHigh {
		alerts = append(alerts, "ABS")
	}
	if summary.ExhaustionLow || summary.ExhaustionHigh {
		alerts = append(alerts, "EXH")
	}
	if summary.LargeTradeCount > 0 {
		alerts = append(alerts, "LARGE")
	}

	rangeTicks := 0.0
	if msg.RowSize > 0 {
		rangeTicks = (msg.High - msg.Low) / msg.RowSize
	}
	volumeDenominator := math.Max(msg.TotalVolume, 1e-9)
	deltaRatio := math.Abs(msg.CandleDelta) / volumeDenominator
	if rangeTicks >= cfg.SweepRangeTicks && deltaRatio >= cfg.SweepDeltaRatio {
		if msg.Close >= msg.Open && msg.CandleDelta > 0 {
			msg.SweepBuy = true
			alerts = append(alerts, "SWEEP UP")
		} else if msg.Close <= msg.Open && msg.CandleDelta < 0 {
			msg.SweepSell = true
			alerts = append(alerts, "SWEEP DN")
		}
	}

	if msg.TotalVolume > 0 {
		if msg.Close > msg.Open && msg.CandleDelta < 0 && math.Abs(msg.CandleDelta)/msg.TotalVolume >= cfg.DeltaDivergenceRatio {
			msg.DeltaDivergenceBear = true
			alerts = append(alerts, "DIV BEAR")
		}
		if msg.Close < msg.Open && msg.CandleDelta > 0 && math.Abs(msg.CandleDelta)/msg.TotalVolume >= cfg.DeltaDivergenceRatio {
			msg.DeltaDivergenceBull = true
			alerts = append(alerts, "DIV BULL")
		}
	}

	return alerts
}

func applyStudySignals(msg *BroadcastMsg, summary clusterSignalSummary) {
	if msg == nil {
		return
	}
	msg.UnfinishedLow = summary.UnfinishedLow
	msg.UnfinishedHigh = summary.UnfinishedHigh
	msg.AbsorptionLow = summary.AbsorptionLow
	msg.AbsorptionHigh = summary.AbsorptionHigh
	msg.ExhaustionLow = summary.ExhaustionLow
	msg.ExhaustionHigh = summary.ExhaustionHigh
	msg.Alerts = buildCandleAlerts(msg, summary)
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

func round8(v float64) float64 {
	return math.Round(v*1e8) / 1e8
}

func httpPort() string {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		return defaultHTTPPort
	}
	return port
}

// allowAllOrigins accepts requests from any origin (required for Railway + Vercel deployment)
func isAllowedFrontendOrigin(origin string) bool {
	return true
}

func applyAPIHeaders(w http.ResponseWriter, r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	} else {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	}
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func writeJSON(w http.ResponseWriter, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, "marshal error", http.StatusInternalServerError)
		return
	}
	_, _ = w.Write(data)
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

func (ob *OrderBook) levelsMap() map[float64]float64 {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	levels := make(map[float64]float64, len(ob.bids)+len(ob.asks))
	for p, s := range ob.bids {
		pf, _ := strconv.ParseFloat(p, 64)
		if pf > 0 && s > 0 {
			levels[round6(pf)] = round6(s)
		}
	}
	for p, s := range ob.asks {
		pf, _ := strconv.ParseFloat(p, 64)
		if pf > 0 && s > 0 {
			levels[round6(pf)] = round6(s)
		}
	}
	return levels
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

type wsClient struct {
	conn *websocket.Conn
	cfg  clientConfig
	mu   sync.Mutex
}

type hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]*wsClient
}

func newHub() *hub { return &hub{clients: make(map[*websocket.Conn]*wsClient)} }

func (h *hub) add(c *websocket.Conn, cfg clientConfig) {
	h.mu.Lock()
	h.clients[c] = &wsClient{conn: c, cfg: cfg}
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
	clients := make([]*wsClient, 0, len(h.clients))
	for _, c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()
	for _, c := range clients {
		c.mu.Lock()
		err := c.conn.WriteMessage(websocket.TextMessage, data)
		c.mu.Unlock()
		if err != nil {
			go h.remove(c.conn)
		}
	}
}

func (h *hub) broadcastCandles(history []BroadcastMsg, live BroadcastMsg, detector DetectorSnapshot) {
	h.mu.RLock()
	clients := make([]*wsClient, 0, len(h.clients))
	for _, c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		if err := sendAggregatedCandle(c, history, live, detector); err != nil {
			go h.remove(c.conn)
		}
	}
}

func sendAggregatedCandle(c *wsClient, history []BroadcastMsg, live BroadcastMsg, detector DetectorSnapshot) error {
	source := make([]BroadcastMsg, 0, len(history)+1)
	source = append(source, history...)
	if live.CandleOpenTime > 0 {
		source = append(source, live)
	}
	aggregated := aggregateBroadcastBars(source, c.cfg.Timeframe, c.cfg.TickMultiplier)
	if len(aggregated) == 0 {
		return nil
	}

	payload, err := json.Marshal(struct {
		Type     string           `json:"type"`
		Payload  BroadcastMsg     `json:"payload"`
		Detector DetectorSnapshot `json:"detector"`
	}{
		Type:     "candle",
		Payload:  aggregated[len(aggregated)-1],
		Detector: detector,
	})
	if err != nil {
		return err
	}
	
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, payload)
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
	if reset, err := store.EnsureFeedIdentity(rootFeedIdentity); err != nil {
		log.Fatalf("store identity init: %v", err)
	} else if reset {
		log.Printf("[store] cleared persisted cache for %s", rootFeedIdentity)
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
	InstrumentTickSize = rowSize
	if tickSize, err := fetchInstrumentTickSize(restClient, bybitSymbol); err != nil {
		log.Printf("[bybit] instrument tick size fetch failed, using default %.2f: %v", rowSize, err)
	} else {
		InstrumentTickSize = tickSize
	}
	detector := NewSweepDetector(InstrumentTickSize)
	detector.Start()
	if sessionDayStart, sessionHigh, sessionLow, err := fetchPreviousUTCSessionRange(restClient, bybitSymbol, time.Now().UTC(), InstrumentTickSize); err != nil {
		log.Printf("[detector] previous UTC session range unavailable: %v", err)
	} else {
		detector.SetSessionRange(sessionHigh, sessionLow, sessionDayStart)
	}

	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()

		lastDayStart := utcDayStart(time.Now().UnixMilli())
		for now := range ticker.C {
			currentDayStart := utcDayStart(now.UnixMilli())
			if currentDayStart == lastDayStart {
				continue
			}
			lastDayStart = currentDayStart
			if sessionDayStart, sessionHigh, sessionLow, err := fetchPreviousUTCSessionRange(restClient, bybitSymbol, now.UTC(), InstrumentTickSize); err != nil {
				log.Printf("[detector] session range refresh failed: %v", err)
			} else {
				detector.SetSessionRange(sessionHigh, sessionLow, sessionDayStart)
			}
		}
	}()

	if loadedBars, loadedTrades, loadedDepth, err := store.Load(); err != nil {
		log.Printf("[store] load failed, starting empty: %v", err)
	} else {
		completedBars = normalizeStoredBars(loadedBars)
		recentTrades = loadedTrades
		recentDepth = loadedDepth
		log.Printf("[store] loaded %d bars, %d tape prints, %d depth snapshots", len(completedBars), len(recentTrades), len(recentDepth))
	}

	candleOpenTime := func(tsMs int64) int64 {
		return tsMs - (tsMs % 60000)
	}

	if hydratedBars, err := hydrateHistoricalBars(restClient, bybitSymbol, completedBars); err != nil {
		log.Printf("[bybit] historical backfill failed: %v", err)
	} else {
		completedBars = hydratedBars
		if err := store.ReplaceBars(completedBars); err != nil {
			log.Printf("[store] bar rewrite failed: %v", err)
		}
	}

	if lastBar := lastCompletedBar(completedBars); lastBar != nil {
		cvd = lastBar.CVD
		oi.current = lastBar.OI
		oi.prevBar = lastBar.OI
	}

	if seededTrades, err := fetchBybitRecentTrades(restClient, bybitSymbol, 1000); err != nil {
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

	if currentOI, err := fetchBybitCurrentOpenInterest(restClient, bybitSymbol); err != nil {
		log.Printf("[bybit] current OI seed failed: %v", err)
	} else if currentOI > 0 {
		oi.update(currentOI)
	}

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
			if candle != nil && candle.hasTick {
				clusters, summary := candle.footprint()
				closedOIDelta := oi.barClose()
				bidP, bidS, askP, askS := ob.bestBidAsk()
				bids, asks := ob.topLevels(15)
				snapshot := BroadcastMsg{
					CandleOpenTime:    candle.openTime,
					Open:              candle.open,
					High:              candle.high,
					Low:               candle.low,
					Close:             candle.close,
					RowSize:           rowSize,
					Clusters:          clusters,
					CandleDelta:       round6(candle.delta),
					CVD:               round6(cvd),
					BuyTrades:         candle.buyTrades,
					SellTrades:        candle.sellTrades,
					TotalVolume:       round6(candle.buyVol + candle.sellVol),
					BuyVolume:         round6(candle.buyVol),
					SellVolume:        round6(candle.sellVol),
					OI:                oi.get(),
					OIDelta:           closedOIDelta,
					BestBid:           bidP,
					BestBidSize:       bidS,
					BestAsk:           askP,
					BestAskSize:       askS,
					Bids:              bids,
					Asks:              asks,
					OrderflowCoverage: 1,
					DataSource:        "live_trade_footprint",
				}
				applyStudySignals(&snapshot, summary)
				completedBars = append(completedBars, snapshot)
				detector.EnqueueClosedBar(detectorCandleFromBroadcast(snapshot))
				if len(completedBars) > maxHistory {
					completedBars = completedBars[len(completedBars)-maxHistory:]
				}
				if err := store.AppendBar(snapshot, completedBars); err != nil {
					log.Printf("[store] bar append failed: %v", err)
				}
			} else if candle != nil {
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
		detector.EnqueueTrade(DetectorTick{
			Price:       round6(price),
			Volume:      round6(vol),
			Side:        side,
			TimestampMs: ts,
		})
	}

	tradeCh := make(chan []byte, 1024)
	miscCh := make(chan []byte, 512)

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
				eventTimeMs := env.Data.CTS
				if eventTimeMs <= 0 {
					eventTimeMs = time.Now().UnixMilli()
				}
				detector.EnqueueBook(DetectorBookUpdate{
					Levels:      ob.levelsMap(),
					EventTimeMs: eventTimeMs,
				})
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

	go func() {
		for {
			if err := connectBybit(tradeCh, miscCh); err != nil {
				log.Printf("[bybit] error: %v — retrying in %v", err, bybitReconnectDelay)
			}
			time.Sleep(bybitReconnectDelay)
		}
	}()

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
			clusters, summary := candle.footprint()
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
				CandleOpenTime:    candle.openTime,
				Open:              candle.open,
				High:              candle.high,
				Low:               candle.low,
				Close:             candle.close,
				RowSize:           rowSize,
				Clusters:          clusters,
				CandleDelta:       round6(candle.delta),
				CVD:               round6(cvd),
				BuyTrades:         candle.buyTrades,
				SellTrades:        candle.sellTrades,
				TotalVolume:       round6(candle.buyVol + candle.sellVol),
				BuyVolume:         round6(candle.buyVol),
				SellVolume:        round6(candle.sellVol),
				OI:                oi.get(),
				OIDelta:           oi.delta(),
				BestBid:           bidP,
				BestBidSize:       bidS,
				BestAsk:           askP,
				BestAskSize:       askS,
				Bids:              bids,
				Asks:              asks,
				RecentTrades:      tape,
				OrderflowCoverage: 1,
				DataSource:        "live_trade_footprint",
			}
			applyStudySignals(&msg, summary)
			historySnapshot := copyBroadcastBars(completedBars)
			mu.Unlock()

			detectorSnapshot := detector.Snapshot()
			h.broadcastCandles(historySnapshot, msg, detectorSnapshot)

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
	listenAddr := "0.0.0.0:" + httpPort()
	instrumentPayload := instrumentResponse{
		Symbol:           bybitSymbol,
		BaseCoin:         "BTC",
		QuoteCoin:        "USD",
		TickSize:         InstrumentTickSize,
		QtyStep:          1,
		MinOrderQty:      1,
		MaxOrderQty:      0,
		MinNotionalValue: 0,
		PriceScale:       1,
		VolumeUnit:       "USD",
		SyntheticBTC:     false,
		DefaultTicks:     []int{1, 5, 10, 25, 50, 100},
	}
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // allow all origins for WebSocket
		},
	}
	parseHistoryLimit := func(raw string) int {
		if raw == "" {
			return maxHistory
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			return maxHistory
		}
		if value > maxHistory {
			return maxHistory
		}
		return value
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if applyAPIHeaders(w, r) {
			return
		}
		writeJSON(w, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("/instrument", func(w http.ResponseWriter, r *http.Request) {
		if applyAPIHeaders(w, r) {
			return
		}
		writeJSON(w, instrumentPayload)
	})

	mux.HandleFunc("/history", func(w http.ResponseWriter, r *http.Request) {
		if applyAPIHeaders(w, r) {
			return
		}
		timeframe := normalizeTimeframe(r.URL.Query().Get("timeframe"))
		tickMultiplier := parseTickMultiplier(r.URL.Query().Get("tickSize"))
		limit := parseHistoryLimit(r.URL.Query().Get("limit"))
		mu.Lock()
		historySnapshot := copyBroadcastBars(completedBars)
		mu.Unlock()
		aggregated := aggregateBroadcastBars(historySnapshot, timeframe, tickMultiplier)
		if len(aggregated) > limit {
			aggregated = aggregated[len(aggregated)-limit:]
		}
		writeJSON(w, aggregated)
	})

	mux.HandleFunc("/tape", func(w http.ResponseWriter, r *http.Request) {
		if applyAPIHeaders(w, r) {
			return
		}
		mu.Lock()
		payload := copyTapeTrades(recentTrades)
		mu.Unlock()
		writeJSON(w, payload)
	})

	mux.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		if applyAPIHeaders(w, r) {
			return
		}

		switch r.Method {
		case http.MethodGet:
			writeJSON(w, currentStudyConfig())
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
			writeJSON(w, configStore.Get())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/depth-history", func(w http.ResponseWriter, r *http.Request) {
		if applyAPIHeaders(w, r) {
			return
		}
		mu.Lock()
		payload := copyDepthSnapshots(recentDepth)
		mu.Unlock()
		writeJSON(w, payload)
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
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
			clusters, summary := candle.footprint()
			liveSnapshot = BroadcastMsg{
				CandleOpenTime:    candle.openTime,
				Open:              candle.open,
				High:              candle.high,
				Low:               candle.low,
				Close:             candle.close,
				RowSize:           rowSize,
				Clusters:          clusters,
				CandleDelta:       round6(candle.delta),
				CVD:               round6(cvd),
				BuyTrades:         candle.buyTrades,
				SellTrades:        candle.sellTrades,
				TotalVolume:       round6(candle.buyVol + candle.sellVol),
				BuyVolume:         round6(candle.buyVol),
				SellVolume:        round6(candle.sellVol),
				OI:                oi.get(),
				OIDelta:           oi.delta(),
				BestBid:           bidP,
				BestBidSize:       bidS,
				BestAsk:           askP,
				BestAskSize:       askS,
				Bids:              bids,
				Asks:              asks,
				RecentTrades:      copyTapeTrades(recentTrades),
				OrderflowCoverage: 1,
				DataSource:        "live_trade_footprint",
			}
			applyStudySignals(&liveSnapshot, summary)
		}
		mu.Unlock()

		detectorSnapshot := detector.Snapshot()
		tmpClient := &wsClient{conn: conn, cfg: cfg}
		if err := sendAggregatedCandle(tmpClient, historySnapshot, liveSnapshot, detectorSnapshot); err != nil {
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

	fmt.Printf("▶ Footprint server on %s\n", listenAddr)
	fmt.Println("   Streams: publicTrade + orderbook.50 + tickers (BTCUSD inverse)")
	fmt.Println("   Health endpoint: GET /health")
	fmt.Println("   History endpoint: GET /history")
	fmt.Println("   Depth history endpoint: GET /depth-history")
	server := &http.Server{Addr: listenAddr, Handler: mux}
	log.Fatal(server.ListenAndServe())
}

// ════════════════════════════════════════════════════════════════════
//  Bybit V5 WebSocket
// ════════════════════════════════════════════════════════════════════

func connectBybit(tradeCh chan<- []byte, miscCh chan<- []byte) error {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.Dial(bybitWSURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	log.Println("[bybit] connected — subscribing to 3 topics …")

	sub := map[string]interface{}{
		"op": "subscribe",
		"args": []string{
			"publicTrade." + bybitSymbol,
			"orderbook.50." + bybitSymbol,
			"tickers." + bybitSymbol,
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
