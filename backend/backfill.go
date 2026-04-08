package main

import (
	"math"
	"net/http"
	"sort"
	"time"
)

const minuteMs = int64(time.Minute / time.Millisecond)

func normalizeStoredBars(bars []BroadcastMsg) []BroadcastMsg {
	if len(bars) == 0 {
		return nil
	}

	normalized := make([]BroadcastMsg, 0, len(bars))
	for _, bar := range bars {
		bar = normalizeStoredBar(bar)
		if bar.CandleOpenTime == 0 {
			continue
		}
		normalized = append(normalized, bar)
	}

	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i].CandleOpenTime < normalized[j].CandleOpenTime
	})
	return normalized
}

func normalizeStoredBar(bar BroadcastMsg) BroadcastMsg {
	bar.Clusters = append([]Cluster(nil), bar.Clusters...)
	bar.Bids = copyBookLevels(bar.Bids)
	bar.Asks = copyBookLevels(bar.Asks)
	bar.RecentTrades = copyTapeTrades(bar.RecentTrades)

	if bar.OrderflowCoverage <= 0 {
		if barHasOrderflow(bar) {
			bar.OrderflowCoverage = 1
		} else {
			bar.OrderflowCoverage = 0
		}
	}
	bar.OrderflowCoverage = math.Max(0, math.Min(1, round6(bar.OrderflowCoverage)))

	if bar.DataSource == "" {
		if bar.OrderflowCoverage >= 0.999 {
			bar.DataSource = "live_trade_footprint"
		} else {
			bar.DataSource = "bybit_kline_backfill"
		}
	}

	return bar
}

func barHasOrderflow(bar BroadcastMsg) bool {
	return len(bar.Clusters) > 0 ||
		bar.BuyTrades > 0 ||
		bar.SellTrades > 0 ||
		bar.BuyVolume > 0 ||
		bar.SellVolume > 0
}

func latestCompletedBarOpenTime(now time.Time) int64 {
	currentOpen := now.UTC().UnixMilli() - (now.UTC().UnixMilli() % minuteMs)
	return currentOpen - minuteMs
}

type barTimeRange struct {
	Start int64
	End   int64
}

func detectMissingBarRanges(existing []BroadcastMsg, targetStart, targetEnd int64) []barTimeRange {
	if targetStart <= 0 || targetEnd < targetStart {
		return nil
	}

	ranges := make([]barTimeRange, 0)
	cursor := targetStart

	for _, bar := range existing {
		if bar.CandleOpenTime < targetStart {
			continue
		}
		if bar.CandleOpenTime > targetEnd {
			break
		}
		if bar.CandleOpenTime > cursor {
			ranges = append(ranges, barTimeRange{
				Start: cursor,
				End:   bar.CandleOpenTime - minuteMs,
			})
		}
		cursor = bar.CandleOpenTime + minuteMs
	}

	if cursor <= targetEnd {
		ranges = append(ranges, barTimeRange{Start: cursor, End: targetEnd})
	}

	return ranges
}

func buildBackfilledBar(seed officialKlineBar) BroadcastMsg {
	return BroadcastMsg{
		CandleOpenTime:    seed.OpenTime,
		Open:              seed.Open,
		High:              seed.High,
		Low:               seed.Low,
		Close:             seed.Close,
		RowSize:           rowSize,
		TotalVolume:       seed.Volume,
		OrderflowCoverage: 0,
		DataSource:        "bybit_kline_backfill",
	}
}

func preferHistoricalBar(existing, candidate BroadcastMsg) BroadcastMsg {
	existing = normalizeStoredBar(existing)
	candidate = normalizeStoredBar(candidate)

	if existing.OrderflowCoverage > candidate.OrderflowCoverage {
		return existing
	}
	if candidate.OrderflowCoverage > existing.OrderflowCoverage {
		return candidate
	}

	if barHasOrderflow(existing) && !barHasOrderflow(candidate) {
		return existing
	}
	if candidate.TotalVolume > 0 && existing.TotalVolume == 0 {
		return candidate
	}
	if existing.OI != 0 && candidate.OI == 0 {
		return existing
	}
	return existing
}

func trimBarsToWindow(bars []BroadcastMsg, targetStart, targetEnd int64) []BroadcastMsg {
	filtered := make([]BroadcastMsg, 0, len(bars))
	for _, bar := range bars {
		if bar.CandleOpenTime < targetStart || bar.CandleOpenTime > targetEnd {
			continue
		}
		filtered = append(filtered, normalizeStoredBar(bar))
	}
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].CandleOpenTime < filtered[j].CandleOpenTime
	})
	if len(filtered) > maxHistory {
		filtered = filtered[len(filtered)-maxHistory:]
	}
	return filtered
}

func hydrateHistoricalBars(client *http.Client, symbol string, existing []BroadcastMsg) ([]BroadcastMsg, error) {
	targetEnd := latestCompletedBarOpenTime(time.Now())
	if targetEnd <= 0 {
		return normalizeStoredBars(existing), nil
	}
	targetStart := targetEnd - int64(maxHistory-1)*minuteMs

	window := trimBarsToWindow(existing, targetStart, targetEnd)
	missing := detectMissingBarRanges(window, targetStart, targetEnd)
	if len(missing) > 0 {
		barsByOpenTime := make(map[int64]BroadcastMsg, len(window))
		for _, bar := range window {
			barsByOpenTime[bar.CandleOpenTime] = normalizeStoredBar(bar)
		}

		for _, gap := range missing {
			officialBars, err := fetchBybitKlineRange(client, symbol, gap.Start, gap.End)
			if err != nil {
				return window, err
			}
			for _, seed := range officialBars {
				bar := buildBackfilledBar(seed)
				current, ok := barsByOpenTime[bar.CandleOpenTime]
				if !ok {
					barsByOpenTime[bar.CandleOpenTime] = bar
					continue
				}
				barsByOpenTime[bar.CandleOpenTime] = preferHistoricalBar(current, bar)
			}
		}

		window = make([]BroadcastMsg, 0, len(barsByOpenTime))
		for _, bar := range barsByOpenTime {
			window = append(window, normalizeStoredBar(bar))
		}
		sort.Slice(window, func(i, j int) bool {
			return window[i].CandleOpenTime < window[j].CandleOpenTime
		})
	}

	if len(window) > 0 {
		snapshots, err := fetchBybitOpenInterestHistory(client, symbol, window[0].CandleOpenTime, targetEnd+minuteMs)
		if err != nil {
			return window, err
		}
		applyOfficialOpenInterest(window, snapshots)
	}

	if len(window) > maxHistory {
		window = window[len(window)-maxHistory:]
	}
	return window, nil
}
