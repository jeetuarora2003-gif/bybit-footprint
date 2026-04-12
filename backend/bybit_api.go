package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"
)

const bybitRESTBase = "https://api.bybit.com"
const maxBackfillPages = 128

type bybitAPIResponse[T any] struct {
	RetCode int    `json:"retCode"`
	RetMsg  string `json:"retMsg"`
	Result  T      `json:"result"`
}

type bybitRecentTradeResult struct {
	List []bybitRecentTradeItem `json:"list"`
}

type bybitRecentTradeItem struct {
	ExecID string `json:"execId"`
	Price  string `json:"price"`
	Size   string `json:"size"`
	Side   string `json:"side"`
	Time   string `json:"time"`
	Seq    string `json:"seq"`
}

type bybitTickerResult struct {
	List []TickerData `json:"list"`
}

type bybitKlineResult struct {
	List [][]string `json:"list"`
}

type bybitOpenInterestResult struct {
	List           []bybitOpenInterestItem `json:"list"`
	NextPageCursor string                  `json:"nextPageCursor"`
}

type bybitOpenInterestItem struct {
	OpenInterest string `json:"openInterest"`
	Timestamp    string `json:"timestamp"`
}

type officialOISnapshot struct {
	Timestamp    int64
	OpenInterest float64
}

type officialKlineBar struct {
	OpenTime int64
	Open     float64
	High     float64
	Low      float64
	Close    float64
	Volume   float64
}

func fetchBybitJSON[T any](client *http.Client, path string, params url.Values, out *T) error {
	endpoint := bybitRESTBase + path
	if encoded := params.Encode(); encoded != "" {
		endpoint += "?" + encoded
	}

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "bybit-footprint/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %s", resp.Status)
	}

	var payload bybitAPIResponse[T]
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return err
	}
	if payload.RetCode != 0 {
		return fmt.Errorf("retCode=%d retMsg=%s", payload.RetCode, payload.RetMsg)
	}

	*out = payload.Result
	return nil
}

func fetchBybitRecentTrades(client *http.Client, symbol string, limit int) ([]TapeTrade, error) {
	params := url.Values{
		"category": []string{bybitCategory},
		"symbol":   []string{symbol},
		"limit":    []string{strconv.Itoa(limit)},
	}

	var result bybitRecentTradeResult
	if err := fetchBybitJSON(client, "/v5/market/recent-trade", params, &result); err != nil {
		return nil, err
	}

	trades := make([]TapeTrade, 0, len(result.List))
	for _, item := range result.List {
		price, _ := strconv.ParseFloat(item.Price, 64)
		size, _ := strconv.ParseFloat(item.Size, 64)
		ts, _ := strconv.ParseInt(item.Time, 10, 64)
		seq, _ := strconv.ParseInt(item.Seq, 10, 64)
		if price == 0 || size == 0 || ts == 0 {
			continue
		}
		trades = append(trades, TapeTrade{
			ID:        item.ExecID,
			Price:     round6(price),
			Volume:    round6(size),
			Side:      item.Side,
			Timestamp: ts,
			Seq:       seq,
		})
	}

	sortTapeTradesChronologically(trades)
	return trades, nil
}

func fetchBybitCurrentOpenInterest(client *http.Client, symbol string) (float64, error) {
	params := url.Values{
		"category": []string{bybitCategory},
		"symbol":   []string{symbol},
	}

	var result bybitTickerResult
	if err := fetchBybitJSON(client, "/v5/market/tickers", params, &result); err != nil {
		return 0, err
	}
	if len(result.List) == 0 {
		return 0, fmt.Errorf("no ticker payload")
	}

	value, err := strconv.ParseFloat(result.List[0].OpenInterest, 64)
	if err != nil {
		return 0, err
	}
	return round6(value), nil
}

func fetchBybitKlineRange(client *http.Client, symbol string, startTs, endTs int64) ([]officialKlineBar, error) {
	if startTs <= 0 || endTs <= 0 || endTs < startTs {
		return nil, nil
	}

	const pageLimit = 1000
	barsByOpenTime := make(map[int64]officialKlineBar)
	nextEnd := endTs

	for page := 0; page < maxBackfillPages; page += 1 {
		params := url.Values{
			"category": []string{bybitCategory},
			"symbol":   []string{symbol},
			"interval": []string{"1"},
			"start":    []string{strconv.FormatInt(startTs, 10)},
			"end":      []string{strconv.FormatInt(nextEnd, 10)},
			"limit":    []string{strconv.Itoa(pageLimit)},
		}

		var result bybitKlineResult
		if err := fetchBybitJSON(client, "/v5/market/kline", params, &result); err != nil {
			return nil, err
		}
		if len(result.List) == 0 {
			break
		}

		oldestTs := int64(0)
		for _, item := range result.List {
			if len(item) < 7 {
				continue
			}
			openTime, errTs := strconv.ParseInt(item[0], 10, 64)
			open, errOpen := strconv.ParseFloat(item[1], 64)
			high, errHigh := strconv.ParseFloat(item[2], 64)
			low, errLow := strconv.ParseFloat(item[3], 64)
			closePrice, errClose := strconv.ParseFloat(item[4], 64)
			volume, errVolume := strconv.ParseFloat(item[5], 64)
			if errTs != nil || errOpen != nil || errHigh != nil || errLow != nil || errClose != nil || errVolume != nil {
				continue
			}
			if openTime < startTs || openTime > endTs {
				continue
			}

			barsByOpenTime[openTime] = officialKlineBar{
				OpenTime: openTime,
				Open:     round6(open),
				High:     round6(high),
				Low:      round6(low),
				Close:    round6(closePrice),
				Volume:   round6(volume),
			}
			if oldestTs == 0 || openTime < oldestTs {
				oldestTs = openTime
			}
		}

		if oldestTs == 0 || oldestTs <= startTs {
			break
		}
		nextEnd = oldestTs - int64(time.Minute/time.Millisecond)
		if nextEnd < startTs {
			break
		}
	}

	bars := make([]officialKlineBar, 0, len(barsByOpenTime))
	for _, bar := range barsByOpenTime {
		bars = append(bars, bar)
	}
	sort.Slice(bars, func(i, j int) bool {
		return bars[i].OpenTime < bars[j].OpenTime
	})
	return bars, nil
}

func fetchBybitOpenInterestHistory(client *http.Client, symbol string, earliestTs, latestTs int64) ([]officialOISnapshot, error) {
	if earliestTs <= 0 {
		return nil, nil
	}
	if latestTs <= 0 || latestTs < earliestTs {
		latestTs = time.Now().UnixMilli()
	}

	cursor := ""
	snapshotsByTs := make(map[int64]officialOISnapshot)

	for page := 0; page < maxBackfillPages; page += 1 {
		params := url.Values{
			"category":     []string{bybitCategory},
			"symbol":       []string{symbol},
			"intervalTime": []string{"5min"},
			"limit":        []string{"200"},
			"startTime":    []string{strconv.FormatInt(earliestTs, 10)},
			"endTime":      []string{strconv.FormatInt(latestTs, 10)},
		}
		if cursor != "" {
			params.Set("cursor", cursor)
		}

		var result bybitOpenInterestResult
		if err := fetchBybitJSON(client, "/v5/market/open-interest", params, &result); err != nil {
			return nil, err
		}
		if len(result.List) == 0 {
			break
		}

		oldestTs := int64(0)
		for _, item := range result.List {
			value, errValue := strconv.ParseFloat(item.OpenInterest, 64)
			ts, errTs := strconv.ParseInt(item.Timestamp, 10, 64)
			if errValue != nil || errTs != nil || ts == 0 {
				continue
			}
			snapshotsByTs[ts] = officialOISnapshot{
				Timestamp:    ts,
				OpenInterest: round6(value),
			}
			if oldestTs == 0 || ts < oldestTs {
				oldestTs = ts
			}
		}

		if oldestTs == 0 || oldestTs <= earliestTs || result.NextPageCursor == "" {
			break
		}
		cursor = result.NextPageCursor
	}

	snapshots := make([]officialOISnapshot, 0, len(snapshotsByTs))
	for _, snapshot := range snapshotsByTs {
		snapshots = append(snapshots, snapshot)
	}
	sort.Slice(snapshots, func(i, j int) bool {
		return snapshots[i].Timestamp < snapshots[j].Timestamp
	})
	return snapshots, nil
}

func applyOfficialOpenInterest(bars []BroadcastMsg, snapshots []officialOISnapshot) bool {
	if len(bars) == 0 || len(snapshots) == 0 {
		return false
	}

	idx := 0
	currentOI := 0.0
	hasOI := false
	prevOI := 0.0
	prevAssigned := false
	changed := false

	for i := range bars {
		barCloseTs := bars[i].CandleOpenTime + int64(time.Minute/time.Millisecond)
		for idx < len(snapshots) && snapshots[idx].Timestamp <= barCloseTs {
			currentOI = snapshots[idx].OpenInterest
			hasOI = true
			idx += 1
		}
		if !hasOI {
			continue
		}

		nextDelta := 0.0
		if prevAssigned {
			nextDelta = round6(currentOI - prevOI)
		}

		if round6(bars[i].OI) != currentOI || round6(bars[i].OIDelta) != nextDelta {
			changed = true
		}

		bars[i].OI = currentOI
		bars[i].OIDelta = nextDelta
		prevOI = currentOI
		prevAssigned = true
	}

	return changed
}

func sortTapeTradesChronologically(trades []TapeTrade) {
	sort.SliceStable(trades, func(i, j int) bool {
		if trades[i].Timestamp != trades[j].Timestamp {
			return trades[i].Timestamp < trades[j].Timestamp
		}
		if trades[i].Seq != trades[j].Seq {
			return trades[i].Seq < trades[j].Seq
		}
		return trades[i].ID < trades[j].ID
	})
}

func mergeTapeTrades(base []TapeTrade, incoming []TapeTrade) []TapeTrade {
	if len(incoming) == 0 {
		return base
	}

	seen := make(map[string]struct{}, len(base)+len(incoming))
	merged := make([]TapeTrade, 0, len(base)+len(incoming))

	appendUnique := func(trades []TapeTrade) {
		for _, trade := range trades {
			key := tapeTradeKey(trade)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			merged = append(merged, trade)
		}
	}

	appendUnique(base)
	appendUnique(incoming)
	sortTapeTradesChronologically(merged)
	if len(merged) > maxRecentTrades {
		merged = merged[len(merged)-maxRecentTrades:]
	}
	return merged
}

func tapeTradeKey(trade TapeTrade) string {
	if trade.ID != "" {
		return trade.ID
	}
	return fmt.Sprintf("%d:%d:%0.6f:%0.6f:%s", trade.Timestamp, trade.Seq, trade.Price, trade.Volume, trade.Side)
}

func seedSeenTradeIDs(trades []TapeTrade, seenTradeSet map[string]struct{}, seenTradeIDs *[]string) {
	for _, trade := range trades {
		if trade.ID == "" {
			continue
		}
		if _, ok := seenTradeSet[trade.ID]; ok {
			continue
		}
		seenTradeSet[trade.ID] = struct{}{}
		*seenTradeIDs = append(*seenTradeIDs, trade.ID)
	}

	if len(*seenTradeIDs) <= maxSeenTradeIDs {
		return
	}

	trim := len(*seenTradeIDs) - maxSeenTradeIDs
	for _, oldID := range (*seenTradeIDs)[:trim] {
		delete(seenTradeSet, oldID)
	}
	*seenTradeIDs = (*seenTradeIDs)[trim:]
}

func rebuildCurrentFromTape(
	trades []TapeTrade,
	afterTs int64,
	candleOpenTime func(int64) int64,
	candle **Candle,
	cvd *float64,
	lastSeq *int64,
) {
	sortTapeTradesChronologically(trades)

	for _, trade := range trades {
		if trade.Timestamp < afterTs {
			continue
		}

		openTime := candleOpenTime(trade.Timestamp)
		if *candle == nil || openTime != (*candle).openTime {
			*candle = newCandle(openTime)
		}

		(*candle).addTrade(trade.Price, trade.Volume, trade.Side, trade.Seq)
		if trade.Side == "Buy" {
			*cvd += trade.Volume
		} else if trade.Side == "Sell" {
			*cvd -= trade.Volume
		}
		if trade.Seq > *lastSeq {
			*lastSeq = trade.Seq
		}
	}
}
