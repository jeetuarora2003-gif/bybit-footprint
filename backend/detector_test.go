package main

import (
	"math"
	"testing"
)

func TestBuildLocalRangeValidatesAgeTouchesAndSize(t *testing.T) {
	tickSize := 0.10
	bars := []DetectorCandle{
		{OpenTime: 1, High: 102.0, Low: 100.0},
		{OpenTime: 2, High: 101.9, Low: 100.1},
		{OpenTime: 3, High: 101.8, Low: 100.0},
		{OpenTime: 4, High: 102.0, Low: 100.2},
		{OpenTime: 5, High: 101.7, Low: 100.0},
		{OpenTime: 6, High: 101.9, Low: 100.1},
	}

	box, ok := buildLocalRange(bars, tickSize)
	if !ok {
		t.Fatalf("expected local range to be valid")
	}
	if box.Source != "local_range" {
		t.Fatalf("expected local_range source, got %q", box.Source)
	}
	if box.Touches < 3 {
		t.Fatalf("expected at least 3 touches, got %d", box.Touches)
	}
	if math.Abs(box.SizeTicks-20) > 0.0001 {
		t.Fatalf("expected 20 ticks, got %.4f", box.SizeTicks)
	}
}

func TestUpdateRangeLifecycleMarksRangeStaleAfterTwoClosesOutside(t *testing.T) {
	box := &RangeBox{
		Source:    "local_range",
		High:      102.0,
		Low:       100.0,
		SizeTicks: 20,
	}

	if stale := updateRangeLifecycle(box, DetectorCandle{Close: 102.1, High: 102.2, Low: 101.0}, 0.10); stale {
		t.Fatalf("range should not be stale after first close outside")
	}
	if box.StaleCount != 1 {
		t.Fatalf("expected stale count 1 after first close outside, got %d", box.StaleCount)
	}

	if stale := updateRangeLifecycle(box, DetectorCandle{Close: 102.3, High: 102.4, Low: 101.2}, 0.10); !stale {
		t.Fatalf("range should be stale after second consecutive close outside")
	}
}

func TestComputeDeltaZscoreFlagsSignificantAggression(t *testing.T) {
	closedBars := make([]DetectorCandle, 0, 20)
	for index := 0; index < 20; index += 1 {
		delta := -1.0
		if index%2 == 1 {
			delta = 1.0
		}
		closedBars = append(closedBars, DetectorCandle{Delta: delta})
	}

	zscore, ok := computeDeltaZscore(closedBars, DetectorCandle{Delta: 3})
	if !ok {
		t.Fatalf("expected z-score filter to pass, got %.4f", zscore)
	}
	if zscore < 2.9 {
		t.Fatalf("expected strong z-score, got %.4f", zscore)
	}
}

func TestResolveDetectorOutcomeUsesRangeSpanThreshold(t *testing.T) {
	event := DetectorEvent{Type: "FAILED_SWEEP_UP"}

	if outcome := resolveDetectorOutcome(event, 100.0, 98.5, 2.0); outcome != "SUCCESS" {
		t.Fatalf("expected SUCCESS, got %s", outcome)
	}
	if outcome := resolveDetectorOutcome(event, 100.0, 99.6, 2.0); outcome != "PARTIAL" {
		t.Fatalf("expected PARTIAL, got %s", outcome)
	}
	if outcome := resolveDetectorOutcome(event, 100.0, 100.2, 2.0); outcome != "FAILED" {
		t.Fatalf("expected FAILED, got %s", outcome)
	}
}
