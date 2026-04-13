package main

import "testing"

func TestNormalizeStoredBarInfersLegacyOrderflow(t *testing.T) {
	bar := normalizeStoredBar(BroadcastMsg{
		CandleOpenTime: 1,
		Clusters: []Cluster{
			{Price: 100, BuyVol: 2, SellVol: 1},
		},
	})

	if bar.OrderflowCoverage != 1 {
		t.Fatalf("expected inferred orderflow coverage 1, got %v", bar.OrderflowCoverage)
	}
	if bar.DataSource != "live_trade_footprint" {
		t.Fatalf("expected live data source, got %q", bar.DataSource)
	}
}

func TestDetectMissingBarRanges(t *testing.T) {
	existing := []BroadcastMsg{
		{CandleOpenTime: minuteMs},
		{CandleOpenTime: 2 * minuteMs},
		{CandleOpenTime: 4 * minuteMs},
	}

	ranges := detectMissingBarRanges(existing, minuteMs, 5*minuteMs)
	if len(ranges) != 2 {
		t.Fatalf("expected 2 missing ranges, got %d", len(ranges))
	}
	if ranges[0].Start != 3*minuteMs || ranges[0].End != 3*minuteMs {
		t.Fatalf("unexpected first range: %+v", ranges[0])
	}
	if ranges[1].Start != 5*minuteMs || ranges[1].End != 5*minuteMs {
		t.Fatalf("unexpected second range: %+v", ranges[1])
	}
}

func TestAggregateBroadcastBarsTracksCoverage(t *testing.T) {
	source := []BroadcastMsg{
		{
			CandleOpenTime:    2 * minuteMs,
			Open:              100,
			High:              102,
			Low:               99,
			Close:             101,
			RowSize:           rowSize,
			TotalVolume:       10,
			OrderflowCoverage: 1,
			DataSource:        "live_trade_footprint",
		},
		{
			CandleOpenTime:    3 * minuteMs,
			Open:              101,
			High:              103,
			Low:               100,
			Close:             102,
			RowSize:           rowSize,
			TotalVolume:       12,
			OrderflowCoverage: 0,
			DataSource:        "bybit_kline_backfill",
		},
	}

	aggregated := aggregateBroadcastBars(source, "2m", 1)
	if len(aggregated) != 1 {
		t.Fatalf("expected 1 aggregated candle, got %d", len(aggregated))
	}
	if aggregated[0].OrderflowCoverage != 0.5 {
		t.Fatalf("expected 0.5 orderflow coverage, got %v", aggregated[0].OrderflowCoverage)
	}
	if aggregated[0].DataSource != "mixed" {
		t.Fatalf("expected mixed data source, got %q", aggregated[0].DataSource)
	}
}
