package main

import (
	"math"
	"sort"
	"strconv"
	"time"
)

var supportedTimeframes = map[string]struct{}{
	"1m": {}, "2m": {}, "3m": {}, "5m": {}, "10m": {}, "15m": {}, "30m": {},
	"1h": {}, "2h": {}, "4h": {}, "6h": {}, "8h": {}, "12h": {},
	"D": {}, "W": {}, "M": {},
}

func normalizeTimeframe(timeframe string) string {
	if _, ok := supportedTimeframes[timeframe]; ok {
		return timeframe
	}
	return "1m"
}

func parseTickMultiplier(raw string) float64 {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value <= 0 {
		return 1
	}
	return value
}

func aggregatedRowSize(tickMultiplier float64) float64 {
	return round6(rowSize * tickMultiplier)
}

func timeframeDurationMs(timeframe string, referenceTs int64) int64 {
	switch timeframe {
	case "1m":
		return int64(time.Minute / time.Millisecond)
	case "2m":
		return int64(2 * time.Minute / time.Millisecond)
	case "3m":
		return int64(3 * time.Minute / time.Millisecond)
	case "5m":
		return int64(5 * time.Minute / time.Millisecond)
	case "10m":
		return int64(10 * time.Minute / time.Millisecond)
	case "15m":
		return int64(15 * time.Minute / time.Millisecond)
	case "30m":
		return int64(30 * time.Minute / time.Millisecond)
	case "1h":
		return int64(time.Hour / time.Millisecond)
	case "2h":
		return int64(2 * time.Hour / time.Millisecond)
	case "4h":
		return int64(4 * time.Hour / time.Millisecond)
	case "6h":
		return int64(6 * time.Hour / time.Millisecond)
	case "8h":
		return int64(8 * time.Hour / time.Millisecond)
	case "12h":
		return int64(12 * time.Hour / time.Millisecond)
	case "D":
		return int64(24 * time.Hour / time.Millisecond)
	case "W":
		return int64(7 * 24 * time.Hour / time.Millisecond)
	case "M":
		date := time.UnixMilli(referenceTs).UTC()
		next := time.Date(date.Year(), date.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		return next.UnixMilli() - frameOpenTime(referenceTs, timeframe)
	default:
		return int64(time.Minute / time.Millisecond)
	}
}

func frameOpenTime(timestamp int64, timeframe string) int64 {
	timeframe = normalizeTimeframe(timeframe)
	date := time.UnixMilli(timestamp).UTC()

	switch timeframe {
	case "D":
		return time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC).UnixMilli()
	case "W":
		diffToMonday := (int(date.Weekday()) + 6) % 7
		day := date.AddDate(0, 0, -diffToMonday)
		return time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC).UnixMilli()
	case "M":
		return time.Date(date.Year(), date.Month(), 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	default:
		tfMs := timeframeDurationMs(timeframe, timestamp)
		return timestamp - (timestamp % tfMs)
	}
}

func bucketPriceForSize(price, targetRowSize float64) float64 {
	if targetRowSize <= 0 {
		targetRowSize = rowSize
	}
	return round6(math.Floor((price+math.SmallestNonzeroFloat64)/targetRowSize) * targetRowSize)
}

func normalizeAggregatedClusters(clusters []Cluster, targetRowSize float64) ([]Cluster, bool, bool) {
	if len(clusters) == 0 {
		return nil, false, false
	}

	type clusterAccum struct {
		BuyVol     float64
		SellVol    float64
		BuyTrades  int
		SellTrades int
	}

	buckets := make(map[float64]*clusterAccum)
	for _, cluster := range clusters {
		price := bucketPriceForSize(cluster.Price, targetRowSize)
		current := buckets[price]
		if current == nil {
			current = &clusterAccum{}
			buckets[price] = current
		}
		current.BuyVol += cluster.BuyVol
		current.SellVol += cluster.SellVol
		current.BuyTrades += cluster.BuyTrades
		current.SellTrades += cluster.SellTrades
	}

	normalized := make([]Cluster, 0, len(buckets))
	for price, item := range buckets {
		normalized = append(normalized, Cluster{
			Price:      round6(price),
			BuyVol:     round6(item.BuyVol),
			SellVol:    round6(item.SellVol),
			Delta:      round6(item.BuyVol - item.SellVol),
			TotalVol:   round6(item.BuyVol + item.SellVol),
			BuyTrades:  item.BuyTrades,
			SellTrades: item.SellTrades,
		})
	}
	sort.Slice(normalized, func(i, j int) bool { return normalized[i].Price < normalized[j].Price })
	unfinishedLow, unfinishedHigh := annotateClusterSignals(normalized)
	return normalized, unfinishedLow, unfinishedHigh
}

func aggregateBroadcastBars(source []BroadcastMsg, timeframe string, tickMultiplier float64) []BroadcastMsg {
	timeframe = normalizeTimeframe(timeframe)
	targetRowSize := aggregatedRowSize(tickMultiplier)
	if len(source) == 0 {
		return nil
	}

	frames := make([]BroadcastMsg, 0, len(source))
	frameCounts := make([]int, 0, len(source))
	var current *BroadcastMsg

	for _, candle := range source {
		if candle.CandleOpenTime == 0 {
			continue
		}
		openTime := frameOpenTime(candle.CandleOpenTime, timeframe)
		if current == nil || current.CandleOpenTime != openTime {
			frame := BroadcastMsg{
				CandleOpenTime:    openTime,
				Open:              candle.Open,
				High:              candle.High,
				Low:               candle.Low,
				Close:             candle.Close,
				RowSize:           targetRowSize,
				BestBid:           candle.BestBid,
				BestBidSize:       candle.BestBidSize,
				BestAsk:           candle.BestAsk,
				BestAskSize:       candle.BestAskSize,
				Bids:              copyBookLevels(candle.Bids),
				Asks:              copyBookLevels(candle.Asks),
				RecentTrades:      copyTapeTrades(candle.RecentTrades),
				OrderflowCoverage: 0,
				DataSource:        candle.DataSource,
			}
			frames = append(frames, frame)
			frameCounts = append(frameCounts, 1)
			current = &frames[len(frames)-1]
		} else {
			frameCounts[len(frameCounts)-1] += 1
		}

		current.High = math.Max(current.High, candle.High)
		current.Low = math.Min(current.Low, candle.Low)
		current.Close = candle.Close
		current.CandleDelta = round6(current.CandleDelta + candle.CandleDelta)
		current.CVD = candle.CVD
		current.BuyTrades += candle.BuyTrades
		current.SellTrades += candle.SellTrades
		current.TotalVolume = round6(current.TotalVolume + candle.TotalVolume)
		current.BuyVolume = round6(current.BuyVolume + candle.BuyVolume)
		current.SellVolume = round6(current.SellVolume + candle.SellVolume)
		current.OI = candle.OI
		current.OIDelta = round6(current.OIDelta + candle.OIDelta)
		current.BestBid = candle.BestBid
		current.BestBidSize = candle.BestBidSize
		current.BestAsk = candle.BestAsk
		current.BestAskSize = candle.BestAskSize
		current.Bids = copyBookLevels(candle.Bids)
		current.Asks = copyBookLevels(candle.Asks)
		current.RecentTrades = copyTapeTrades(candle.RecentTrades)
		current.Clusters = append(current.Clusters, candle.Clusters...)
		current.OrderflowCoverage = round6(current.OrderflowCoverage + math.Max(0, math.Min(1, candle.OrderflowCoverage)))
		current.DataSource = mergeDataSource(current.DataSource, candle.DataSource)
	}

	for index := range frames {
		clusters, unfinishedLow, unfinishedHigh := normalizeAggregatedClusters(frames[index].Clusters, targetRowSize)
		frames[index].Clusters = clusters
		frames[index].UnfinishedLow = unfinishedLow
		frames[index].UnfinishedHigh = unfinishedHigh
		if frameCounts[index] > 0 {
			frames[index].OrderflowCoverage = round6(frames[index].OrderflowCoverage / float64(frameCounts[index]))
		}
		if frames[index].DataSource == "" {
			frames[index].DataSource = "mixed"
		}
	}

	return frames
}

func mergeDataSource(current, next string) string {
	switch {
	case current == "":
		return next
	case next == "":
		return current
	case current == next:
		return current
	default:
		return "mixed"
	}
}

func copyBroadcastBars(src []BroadcastMsg) []BroadcastMsg {
	if len(src) == 0 {
		return nil
	}
	dst := make([]BroadcastMsg, len(src))
	for i, item := range src {
		dst[i] = BroadcastMsg{
			CandleOpenTime:    item.CandleOpenTime,
			Open:              item.Open,
			High:              item.High,
			Low:               item.Low,
			Close:             item.Close,
			RowSize:           item.RowSize,
			Clusters:          append([]Cluster(nil), item.Clusters...),
			CandleDelta:       item.CandleDelta,
			CVD:               item.CVD,
			BuyTrades:         item.BuyTrades,
			SellTrades:        item.SellTrades,
			TotalVolume:       item.TotalVolume,
			BuyVolume:         item.BuyVolume,
			SellVolume:        item.SellVolume,
			OI:                item.OI,
			OIDelta:           item.OIDelta,
			BestBid:           item.BestBid,
			BestBidSize:       item.BestBidSize,
			BestAsk:           item.BestAsk,
			BestAskSize:       item.BestAskSize,
			Bids:              copyBookLevels(item.Bids),
			Asks:              copyBookLevels(item.Asks),
			UnfinishedLow:     item.UnfinishedLow,
			UnfinishedHigh:    item.UnfinishedHigh,
			RecentTrades:      copyTapeTrades(item.RecentTrades),
			OrderflowCoverage: item.OrderflowCoverage,
			DataSource:        item.DataSource,
		}
	}
	return dst
}
