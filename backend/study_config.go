package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type StudyConfig struct {
	ImbalanceThreshold       float64 `json:"imbalance_threshold"`
	MinImbalanceVolume       float64 `json:"min_imbalance_volume"`
	StackedLevels            int     `json:"stacked_levels"`
	ValueAreaPercent         float64 `json:"value_area_percent"`
	LargeTradeThreshold      float64 `json:"large_trade_threshold"`
	BidAskRatioThreshold     float64 `json:"bid_ask_ratio_threshold"`
	AbsorptionVolumeFactor   float64 `json:"absorption_volume_factor"`
	AbsorptionRatioThreshold float64 `json:"absorption_ratio_threshold"`
	ExhaustionVolumeFactor   float64 `json:"exhaustion_volume_factor"`
	SweepRangeTicks          float64 `json:"sweep_range_ticks"`
	SweepDeltaRatio          float64 `json:"sweep_delta_ratio"`
	DeltaDivergenceRatio     float64 `json:"delta_divergence_ratio"`
	OpenInterestSource       string  `json:"open_interest_source"`
	CVDSource                string  `json:"cvd_source"`
}

type studyConfigStore struct {
	mu    sync.RWMutex
	path  string
	value StudyConfig
}

var runtimeStudyConfig *studyConfigStore

func defaultStudyConfig() StudyConfig {
	return StudyConfig{
		ImbalanceThreshold:       2.5,
		MinImbalanceVolume:       1,
		StackedLevels:            3,
		ValueAreaPercent:         70,
		LargeTradeThreshold:      15,
		BidAskRatioThreshold:     3,
		AbsorptionVolumeFactor:   2.2,
		AbsorptionRatioThreshold: 1.2,
		ExhaustionVolumeFactor:   0.55,
		SweepRangeTicks:          20,
		SweepDeltaRatio:          0.24,
		DeltaDivergenceRatio:     0.18,
		OpenInterestSource:       "official_bybit_open_interest",
		CVDSource:                "computed_from_official_trades",
	}
}

func newStudyConfigStore(path string) (*studyConfigStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	store := &studyConfigStore{
		path:  path,
		value: defaultStudyConfig(),
	}

	data, err := os.ReadFile(path)
	if err == nil {
		var decoded StudyConfig
		if jsonErr := json.Unmarshal(data, &decoded); jsonErr == nil {
			store.value = normalizeStudyConfig(decoded)
			return store, nil
		}
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := store.persist(store.value); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *studyConfigStore) Get() StudyConfig {
	if s == nil {
		return defaultStudyConfig()
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.value
}

func (s *studyConfigStore) Update(next StudyConfig) error {
	if s == nil {
		return nil
	}
	normalized := normalizeStudyConfig(next)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.persist(normalized); err != nil {
		return err
	}
	s.value = normalized
	return nil
}

func (s *studyConfigStore) persist(value StudyConfig) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

func normalizeStudyConfig(value StudyConfig) StudyConfig {
	defaults := defaultStudyConfig()
	if value.ImbalanceThreshold < 1 {
		value.ImbalanceThreshold = defaults.ImbalanceThreshold
	}
	if value.MinImbalanceVolume < 0 {
		value.MinImbalanceVolume = defaults.MinImbalanceVolume
	}
	if value.StackedLevels < 2 {
		value.StackedLevels = defaults.StackedLevels
	}
	if value.ValueAreaPercent <= 0 || value.ValueAreaPercent >= 100 {
		value.ValueAreaPercent = defaults.ValueAreaPercent
	}
	if value.LargeTradeThreshold <= 0 {
		value.LargeTradeThreshold = defaults.LargeTradeThreshold
	}
	if value.BidAskRatioThreshold < 1 {
		value.BidAskRatioThreshold = defaults.BidAskRatioThreshold
	}
	if value.AbsorptionVolumeFactor < 1 {
		value.AbsorptionVolumeFactor = defaults.AbsorptionVolumeFactor
	}
	if value.AbsorptionRatioThreshold < 1 {
		value.AbsorptionRatioThreshold = defaults.AbsorptionRatioThreshold
	}
	if value.ExhaustionVolumeFactor <= 0 || value.ExhaustionVolumeFactor >= 1 {
		value.ExhaustionVolumeFactor = defaults.ExhaustionVolumeFactor
	}
	if value.SweepRangeTicks < 2 {
		value.SweepRangeTicks = defaults.SweepRangeTicks
	}
	if value.SweepDeltaRatio <= 0 || value.SweepDeltaRatio >= 1 {
		value.SweepDeltaRatio = defaults.SweepDeltaRatio
	}
	if value.DeltaDivergenceRatio <= 0 || value.DeltaDivergenceRatio >= 1 {
		value.DeltaDivergenceRatio = defaults.DeltaDivergenceRatio
	}
	if value.OpenInterestSource == "" {
		value.OpenInterestSource = defaults.OpenInterestSource
	}
	if value.CVDSource == "" {
		value.CVDSource = defaults.CVDSource
	}
	return value
}

func currentStudyConfig() StudyConfig {
	if runtimeStudyConfig == nil {
		return defaultStudyConfig()
	}
	return runtimeStudyConfig.Get()
}
