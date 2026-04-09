package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"path"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	bybitBaseURL     = "https://api.bybit.com"
	minuteMS         = int64(time.Minute / time.Millisecond)
	maxLimit         = 5000
	maxBackfillPages = 16
	maxOIPages       = 16
	defaultSymbol    = "BTCUSDT"
	defaultRowSize   = 0.1
	defaultPort      = 19740
)

//go:embed web
var webFS embed.FS

type historyBar struct {
	CandleOpenTime      int64            `json:"candle_open_time"`
	Open                float64          `json:"open"`
	High                float64          `json:"high"`
	Low                 float64          `json:"low"`
	Close               float64          `json:"close"`
	RowSize             float64          `json:"row_size"`
	Clusters            []historyCluster `json:"clusters"`
	CandleDelta         float64          `json:"candle_delta"`
	CVD                 float64          `json:"cvd"`
	BuyTrades           int              `json:"buy_trades"`
	SellTrades          int              `json:"sell_trades"`
	TotalVolume         float64          `json:"total_volume"`
	BuyVolume           float64          `json:"buy_volume"`
	SellVolume          float64          `json:"sell_volume"`
	OI                  float64          `json:"oi"`
	OIDelta             float64          `json:"oi_delta"`
	BestBid             float64          `json:"best_bid"`
	BestBidSize         float64          `json:"best_bid_size"`
	BestAsk             float64          `json:"best_ask"`
	BestAskSize         float64          `json:"best_ask_size"`
	Bids                []bookLevel      `json:"bids"`
	Asks                []bookLevel      `json:"asks"`
	UnfinishedLow       bool             `json:"unfinished_low"`
	UnfinishedHigh      bool             `json:"unfinished_high"`
	AbsorptionLow       bool             `json:"absorption_low"`
	AbsorptionHigh      bool             `json:"absorption_high"`
	ExhaustionLow       bool             `json:"exhaustion_low"`
	ExhaustionHigh      bool             `json:"exhaustion_high"`
	SweepBuy            bool             `json:"sweep_buy"`
	SweepSell           bool             `json:"sweep_sell"`
	DeltaDivergenceBull bool             `json:"delta_divergence_bull"`
	DeltaDivergenceBear bool             `json:"delta_divergence_bear"`
	Alerts              []string         `json:"alerts"`
	OrderflowCoverage   float64          `json:"orderflow_coverage"`
	DataSource          string           `json:"data_source"`
}

type historyCluster struct {
	Price        float64 `json:"price"`
	BuyVol       float64 `json:"buyVol"`
	SellVol      float64 `json:"sellVol"`
	Delta        float64 `json:"delta"`
	TotalVol     float64 `json:"totalVol"`
	BuyTrades    int     `json:"buyTrades"`
	SellTrades   int     `json:"sellTrades"`
	MaxTradeBuy  float64 `json:"maxTradeBuy"`
	MaxTradeSell float64 `json:"maxTradeSell"`
}

type bookLevel struct {
	Price float64 `json:"price"`
	Size  float64 `json:"size"`
}

type klineBar struct {
	OpenTime int64
	Open     float64
	High     float64
	Low      float64
	Close    float64
	Volume   float64
}

type oiSnapshot struct {
	Timestamp    int64
	OpenInterest float64
}

type bybitEnvelope struct {
	RetCode int             `json:"retCode"`
	RetMsg  string          `json:"retMsg"`
	Result  json.RawMessage `json:"result"`
}

type bybitKlineResult struct {
	List [][]string `json:"list"`
}

type bybitOIResult struct {
	List []struct {
		OpenInterest string `json:"openInterest"`
		Timestamp    string `json:"timestamp"`
	} `json:"list"`
	NextPageCursor string `json:"nextPageCursor"`
}

type bybitInstrumentResult struct {
	List []struct {
		Symbol         string `json:"symbol"`
		BaseCoin       string `json:"baseCoin"`
		QuoteCoin      string `json:"quoteCoin"`
		PriceScale     string `json:"priceScale"`
		PriceFilter    struct {
			TickSize string `json:"tickSize"`
			MinPrice string `json:"minPrice"`
			MaxPrice string `json:"maxPrice"`
		} `json:"priceFilter"`
		LotSizeFilter struct {
			QtyStep      string `json:"qtyStep"`
			MinOrderQty  string `json:"minOrderQty"`
			MaxOrderQty  string `json:"maxOrderQty"`
			MinNotional  string `json:"minNotionalValue"`
			MaxMarketQty string `json:"maxMktOrderQty"`
		} `json:"lotSizeFilter"`
	} `json:"list"`
}

type instrumentInfo struct {
	Symbol       string  `json:"symbol"`
	BaseCoin     string  `json:"baseCoin"`
	QuoteCoin    string  `json:"quoteCoin"`
	TickSize     float64 `json:"tickSize"`
	QtyStep      float64 `json:"qtyStep"`
	MinOrderQty  float64 `json:"minOrderQty"`
	MaxOrderQty  float64 `json:"maxOrderQty"`
	MinNotional  float64 `json:"minNotionalValue"`
	PriceScale   int     `json:"priceScale"`
	DefaultTicks []int   `json:"defaultTicks"`
}

func main() {
	port := flag.Int("port", defaultPort, "local port to use; default keeps desktop storage stable")
	noOpen := flag.Bool("no-open", false, "disable automatically opening the app in a browser")
	flag.Parse()

	static, indexHTML, err := loadEmbeddedUI()
	if err != nil {
		log.Fatalf("load UI: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", handleHealth)
	mux.HandleFunc("/api/history", handleHistory)
	mux.HandleFunc("/api/instrument", handleInstrument)
	mux.Handle("/", makeStaticHandler(static, indexHTML))

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		existingURL := fmt.Sprintf("http://127.0.0.1:%d", *port)
		if *port > 0 && isHealthyDesktopInstance(existingURL) {
			log.Printf("Bybit Footprint is already running at %s", existingURL)
			if !*noOpen {
				if openErr := openBrowser(existingURL); openErr != nil {
					log.Printf("open browser: %v", openErr)
				}
			}
			return
		}

		if *port == defaultPort {
			listener, err = net.Listen("tcp", "127.0.0.1:0")
		}
		if err != nil {
			log.Fatalf("listen: %v", err)
		}
	}

	serverURL := "http://" + listener.Addr().String()
	log.Printf("Bybit Footprint is running at %s", serverURL)

	if !*noOpen {
		go func() {
			time.Sleep(350 * time.Millisecond)
			if err := openBrowser(serverURL); err != nil {
				log.Printf("open browser: %v", err)
			}
		}()
	}

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
}

func isHealthyDesktopInstance(baseURL string) bool {
	client := &http.Client{Timeout: 1200 * time.Millisecond}
	resp, err := client.Get(baseURL + "/api/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func loadEmbeddedUI() (fs.FS, []byte, error) {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		return nil, nil, err
	}
	indexHTML, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		return nil, nil, err
	}
	return sub, indexHTML, nil
}

func makeStaticHandler(static fs.FS, indexHTML []byte) http.Handler {
	fileServer := http.FileServer(http.FS(static))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		requestPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if requestPath == "." || requestPath == "" {
			requestPath = "index.html"
		}

		if requestPath != "index.html" {
			if _, err := fs.Stat(static, requestPath); err == nil {
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML)
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func handleHistory(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		symbol = defaultSymbol
	}

	limit := clampInt(r.URL.Query().Get("limit"), 1, maxLimit, maxLimit)
	client := &http.Client{Timeout: 20 * time.Second}
	rowSize := defaultRowSize
	if instrument, err := fetchInstrumentInfo(r.Context(), client, symbol); err == nil && instrument.TickSize > 0 {
		rowSize = instrument.TickSize
	}

	bars, err := fetchRecentKlines(r.Context(), client, symbol, limit, rowSize)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error":  "history_fetch_failed",
			"detail": err.Error(),
		})
		return
	}

	if len(bars) > 0 {
		oiSnapshots, err := fetchOpenInterestHistory(
			r.Context(),
			client,
			symbol,
			bars[0].CandleOpenTime,
			bars[len(bars)-1].CandleOpenTime+minuteMS,
		)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"error":  "oi_fetch_failed",
				"detail": err.Error(),
			})
			return
		}
		applyOpenInterest(bars, oiSnapshots)
	}

	writeJSON(w, http.StatusOK, bars)
}

func handleInstrument(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		symbol = defaultSymbol
	}

	client := &http.Client{Timeout: 20 * time.Second}
	instrument, err := fetchInstrumentInfo(r.Context(), client, symbol)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error":  "instrument_fetch_failed",
			"detail": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, instrument)
}

func fetchRecentKlines(ctx context.Context, client *http.Client, symbol string, limit int, rowSize float64) ([]historyBar, error) {
	pageLimit := minInt(1000, limit)
	barsByOpenTime := make(map[int64]historyBar, limit)
	nextEnd := time.Now().UnixMilli()

	for page := 0; page < maxBackfillPages && len(barsByOpenTime) < limit; page++ {
		var result bybitKlineResult
		err := fetchBybitResult(ctx, client, "/v5/market/kline", map[string]string{
			"category": "linear",
			"symbol":   symbol,
			"interval": "1",
			"limit":    strconv.Itoa(pageLimit),
			"end":      strconv.FormatInt(nextEnd, 10),
		}, &result)
		if err != nil {
			return nil, err
		}
		if len(result.List) == 0 {
			break
		}

		var oldestTS int64
		for _, item := range result.List {
			if len(item) < 6 {
				continue
			}

			openTime, err := strconv.ParseInt(item[0], 10, 64)
			if err != nil {
				continue
			}

			open, err1 := strconv.ParseFloat(item[1], 64)
			high, err2 := strconv.ParseFloat(item[2], 64)
			low, err3 := strconv.ParseFloat(item[3], 64)
			closeValue, err4 := strconv.ParseFloat(item[4], 64)
			volume, err5 := strconv.ParseFloat(item[5], 64)
			if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil {
				continue
			}

			barsByOpenTime[openTime] = historyBar{
				CandleOpenTime:    openTime,
				Open:              round6(open),
				High:              round6(high),
				Low:               round6(low),
				Close:             round6(closeValue),
				RowSize:           rowSize,
				Clusters:          []historyCluster{},
				CandleDelta:       0,
				CVD:               0,
				BuyTrades:         0,
				SellTrades:        0,
				TotalVolume:       round6(volume),
				BuyVolume:         0,
				SellVolume:        0,
				OI:                0,
				OIDelta:           0,
				BestBid:           0,
				BestBidSize:       0,
				BestAsk:           0,
				BestAskSize:       0,
				Bids:              []bookLevel{},
				Asks:              []bookLevel{},
				Alerts:            []string{},
				OrderflowCoverage: 0,
				DataSource:        "bybit_kline_backfill",
			}

			if oldestTS == 0 || openTime < oldestTS {
				oldestTS = openTime
			}
		}

		if oldestTS == 0 {
			break
		}
		nextEnd = oldestTS - minuteMS
	}

	openTimes := make([]int64, 0, len(barsByOpenTime))
	for openTime := range barsByOpenTime {
		openTimes = append(openTimes, openTime)
	}
	slices.Sort(openTimes)
	if len(openTimes) > limit {
		openTimes = openTimes[len(openTimes)-limit:]
	}

	bars := make([]historyBar, 0, len(openTimes))
	for _, openTime := range openTimes {
		bars = append(bars, barsByOpenTime[openTime])
	}
	return bars, nil
}

func fetchOpenInterestHistory(
	ctx context.Context,
	client *http.Client,
	symbol string,
	startTime int64,
	endTime int64,
) ([]oiSnapshot, error) {
	cursor := ""
	snapshotsByTS := make(map[int64]oiSnapshot)

	for page := 0; page < maxOIPages; page++ {
		params := map[string]string{
			"category":     "linear",
			"symbol":       symbol,
			"intervalTime": "5min",
			"limit":        "200",
			"startTime":    strconv.FormatInt(startTime, 10),
			"endTime":      strconv.FormatInt(endTime, 10),
		}
		if cursor != "" {
			params["cursor"] = cursor
		}

		var result bybitOIResult
		if err := fetchBybitResult(ctx, client, "/v5/market/open-interest", params, &result); err != nil {
			return nil, err
		}
		if len(result.List) == 0 {
			break
		}

		var oldestTS int64
		for _, item := range result.List {
			ts, err1 := strconv.ParseInt(item.Timestamp, 10, 64)
			openInterest, err2 := strconv.ParseFloat(item.OpenInterest, 64)
			if err1 != nil || err2 != nil {
				continue
			}

			snapshotsByTS[ts] = oiSnapshot{
				Timestamp:    ts,
				OpenInterest: round6(openInterest),
			}
			if oldestTS == 0 || ts < oldestTS {
				oldestTS = ts
			}
		}

		if result.NextPageCursor == "" || oldestTS <= startTime {
			break
		}
		cursor = result.NextPageCursor
	}

	timestamps := make([]int64, 0, len(snapshotsByTS))
	for ts := range snapshotsByTS {
		timestamps = append(timestamps, ts)
	}
	slices.Sort(timestamps)

	snapshots := make([]oiSnapshot, 0, len(timestamps))
	for _, ts := range timestamps {
		snapshots = append(snapshots, snapshotsByTS[ts])
	}
	return snapshots, nil
}

func fetchInstrumentInfo(ctx context.Context, client *http.Client, symbol string) (instrumentInfo, error) {
	var result bybitInstrumentResult
	if err := fetchBybitResult(ctx, client, "/v5/market/instruments-info", map[string]string{
		"category": "linear",
		"symbol":   symbol,
	}, &result); err != nil {
		return instrumentInfo{}, err
	}

	if len(result.List) == 0 {
		return instrumentInfo{}, fmt.Errorf("instrument %s not found", symbol)
	}

	item := result.List[0]
	tickSize := parseFloatOrDefault(item.PriceFilter.TickSize, defaultRowSize)
	priceScale := int(parseFloatOrDefault(item.PriceScale, 1))

	return instrumentInfo{
		Symbol:       strings.ToUpper(strings.TrimSpace(item.Symbol)),
		BaseCoin:     strings.ToUpper(strings.TrimSpace(item.BaseCoin)),
		QuoteCoin:    strings.ToUpper(strings.TrimSpace(item.QuoteCoin)),
		TickSize:     tickSize,
		QtyStep:      parseFloatOrDefault(item.LotSizeFilter.QtyStep, 0),
		MinOrderQty:  parseFloatOrDefault(item.LotSizeFilter.MinOrderQty, 0),
		MaxOrderQty:  parseFloatOrDefault(item.LotSizeFilter.MaxOrderQty, 0),
		MinNotional:  parseFloatOrDefault(item.LotSizeFilter.MinNotional, 0),
		PriceScale:   priceScale,
		DefaultTicks: defaultTickMultipliers(tickSize),
	}, nil
}

func fetchBybitResult(
	ctx context.Context,
	client *http.Client,
	apiPath string,
	params map[string]string,
	out any,
) error {
	requestURL, err := url.Parse(bybitBaseURL + apiPath)
	if err != nil {
		return err
	}

	query := requestURL.Query()
	for key, value := range params {
		if strings.TrimSpace(value) != "" {
			query.Set(key, value)
		}
	}
	requestURL.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "bybit-footprint-desktop/1.0")

	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Bybit returned %d", response.StatusCode)
	}

	var envelope bybitEnvelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return err
	}
	if envelope.RetCode != 0 {
		return fmt.Errorf("Bybit retCode=%d retMsg=%s", envelope.RetCode, envelope.RetMsg)
	}
	return json.Unmarshal(envelope.Result, out)
}

func applyOpenInterest(bars []historyBar, snapshots []oiSnapshot) {
	if len(bars) == 0 || len(snapshots) == 0 {
		return
	}

	snapshotIndex := 0
	currentOI := 0.0
	hasOI := false
	previousOI := 0.0
	previousAssigned := false

	for index := range bars {
		closeTS := bars[index].CandleOpenTime + minuteMS
		for snapshotIndex < len(snapshots) && snapshots[snapshotIndex].Timestamp <= closeTS {
			currentOI = snapshots[snapshotIndex].OpenInterest
			hasOI = true
			snapshotIndex++
		}
		if !hasOI {
			continue
		}

		bars[index].OI = currentOI
		if previousAssigned {
			bars[index].OIDelta = round6(currentOI - previousOI)
		}
		previousOI = currentOI
		previousAssigned = true
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write json: %v", err)
	}
}

func clampInt(value string, minValue int, maxValue int, fallback int) int {
	numeric, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return max(minValue, min(maxValue, numeric))
}

func round6(value float64) float64 {
	return math.Round(value*1e6) / 1e6
}

func parseFloatOrDefault(value string, fallback float64) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return round6(parsed)
}

func defaultTickMultipliers(tickSize float64) []int {
	switch {
	case tickSize >= 100:
		return []int{1, 2, 5, 10}
	case tickSize >= 10:
		return []int{1, 2, 5, 10, 25}
	case tickSize >= 1:
		return []int{1, 2, 5, 10, 25, 50}
	case tickSize >= 0.1:
		return []int{1, 2, 5, 10, 25, 50, 100}
	default:
		return []int{1, 5, 10, 25, 50, 100, 250}
	}
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func openBrowser(targetURL string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", targetURL).Start()
	case "darwin":
		return exec.Command("open", targetURL).Start()
	default:
		return exec.Command("xdg-open", targetURL).Start()
	}
}
