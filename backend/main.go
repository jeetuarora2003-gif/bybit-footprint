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
	Price    float64 `json:"price"`
	BuyVol   float64 `json:"buyVol"`
	SellVol  float64 `json:"sellVol"`
	Delta    float64 `json:"delta"`
	TotalVol float64 `json:"totalVol"`
}

type BookLevel struct {
	Price float64 `json:"price"`
	Size  float64 `json:"size"`
}

type BroadcastMsg struct {
	CandleOpenTime int64      `json:"candle_open_time"`
	Open           float64    `json:"open"`
	High           float64    `json:"high"`
	Low            float64    `json:"low"`
	Close          float64    `json:"close"`
	Clusters       []Cluster  `json:"clusters"`
	CandleDelta    float64    `json:"candle_delta"`
	CVD            float64    `json:"cvd"`
	BuyTrades      int        `json:"buy_trades"`
	SellTrades     int        `json:"sell_trades"`
	TotalVolume    float64    `json:"total_volume"`
	BuyVolume      float64    `json:"buy_volume"`
	SellVolume     float64    `json:"sell_volume"`
	OI             float64    `json:"oi"`
	OIDelta        float64    `json:"oi_delta"`
	BestBid        float64    `json:"best_bid"`
	BestBidSize    float64    `json:"best_bid_size"`
	BestAsk        float64    `json:"best_ask"`
	BestAskSize    float64    `json:"best_ask_size"`
	Bids           []BookLevel `json:"bids"`
	Asks           []BookLevel `json:"asks"`
}

// ════════════════════════════════════════════════════════════════════
//  Candle aggregator
// ════════════════════════════════════════════════════════════════════

// FIX #4: rowSize = 1.0 (standard BTC tick, matches frontend ROW_SIZE)
const rowSize = 1.0
const maxHistory = 500

type bucketAccum struct {
	buyVol  float64
	sellVol float64
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
		c.delta += vol
		c.buyVol += vol
		c.buyTrades++
	} else {
		b.sellVol += vol
		c.delta -= vol
		c.sellVol += vol
		c.sellTrades++
	}
}

func (c *Candle) toClusters() []Cluster {
	clusters := make([]Cluster, 0, len(c.buckets))
	for idx, b := range c.buckets {
		clusters = append(clusters, Cluster{
			Price:    float64(idx) * rowSize,
			BuyVol:   round6(b.buyVol),
			SellVol:  round6(b.sellVol),
			Delta:    round6(b.buyVol - b.sellVol),
			TotalVol: round6(b.buyVol + b.sellVol),
		})
	}
	sort.Slice(clusters, func(i, j int) bool { return clusters[i].Price < clusters[j].Price })
	return clusters
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

type hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]struct{}
}

func newHub() *hub { return &hub{clients: make(map[*websocket.Conn]struct{})} }

func (h *hub) add(c *websocket.Conn) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
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
	defer h.mu.RUnlock()
	for c := range h.clients {
		if err := c.WriteMessage(websocket.TextMessage, data); err != nil {
			go h.remove(c)
		}
	}
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

	var (
		mu           sync.Mutex
		cvd          float64
		candle       *Candle
		lastSeq      int64
		// FIX #1: completedBars stores closed bars with full cluster data for /history endpoint
		completedBars []BroadcastMsg
	)

	candleOpenTime := func(tsMs int64) int64 {
		return tsMs - (tsMs % 60000)
	}

	// FIX #5: processTrade is called only from single-threaded tradeCh goroutine — no races
	processTrade := func(price, vol float64, side string, ts, seq int64) {
		mu.Lock()
		defer mu.Unlock()

		if seq > 0 && seq <= lastSeq {
			return
		}
		if seq > lastSeq {
			lastSeq = seq
		}

		openT := candleOpenTime(ts)
		if candle == nil || openT != candle.openTime {
			// FIX #1 + #6: Snapshot the closing bar (with full clusters + closed OI delta) into completedBars
			if candle != nil && candle.hasTick {
				closedOIDelta := oi.barClose()
				bidP, bidS, askP, askS := ob.bestBidAsk()
				bids, asks := ob.topLevels(15)
				snapshot := BroadcastMsg{
					CandleOpenTime: candle.openTime,
					Open:           candle.open,
					High:           candle.high,
					Low:            candle.low,
					Close:          candle.close,
					Clusters:       candle.toClusters(),
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
				}
				completedBars = append(completedBars, snapshot)
				// Cap history to last maxHistory bars
				if len(completedBars) > maxHistory {
					completedBars = completedBars[len(completedBars)-maxHistory:]
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
		} else {
			cvd -= vol
		}
	}

	// FIX #5: Separate channels for trades (serial) vs orderbook/ticker (parallel)
	tradeCh := make(chan []byte, 1024)
	miscCh  := make(chan []byte, 512)

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
				processTrade(price, vol, bt.S, bt.T, bt.Seq)
			}
		}
	}()

	// Worker pool for orderbook + ticker (idempotent, order doesn't matter)
	const workerCount = 4
	for i := 0; i < workerCount; i++ {
		go func() {
			for raw := range miscCh {
				s := string(raw)
				if strings.Contains(s, `"orderbook.`) {
					var env OrderbookEnvelope
					if err := json.Unmarshal(raw, &env); err != nil {
						continue
					}
					if env.Type == "snapshot" {
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
	}

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

			msg := BroadcastMsg{
				CandleOpenTime: candle.openTime,
				Open:           candle.open,
				High:           candle.high,
				Low:            candle.low,
				Close:          candle.close,
				Clusters:       candle.toClusters(),
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
			}
			mu.Unlock()

			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			h.broadcast(data)
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
		mu.Lock()
		data, err := json.Marshal(completedBars)
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
		log.Printf("[ws] client connected: %s", conn.RemoteAddr())
		h.add(conn)
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
