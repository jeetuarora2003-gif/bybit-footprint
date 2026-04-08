package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type persistenceStore struct {
	mu sync.Mutex

	barsPath  string
	tapePath  string
	depthPath string

	barEntries   int
	tapeEntries  int
	depthEntries int
}

func newPersistenceStore(baseDir string) (*persistenceStore, error) {
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, err
	}
	return &persistenceStore{
		barsPath:  filepath.Join(baseDir, "bars.jsonl"),
		tapePath:  filepath.Join(baseDir, "tape.jsonl"),
		depthPath: filepath.Join(baseDir, "depth.jsonl"),
	}, nil
}

func (ps *persistenceStore) Load() ([]BroadcastMsg, []TapeTrade, []DepthSnapshot, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	bars, err := loadJSONLines[BroadcastMsg](ps.barsPath, maxHistory)
	if err != nil {
		return nil, nil, nil, err
	}
	tape, err := loadJSONLines[TapeTrade](ps.tapePath, maxRecentTrades)
	if err != nil {
		return nil, nil, nil, err
	}
	depth, err := loadJSONLines[DepthSnapshot](ps.depthPath, maxRecentDepthSnapshots)
	if err != nil {
		return nil, nil, nil, err
	}

	if err := rewriteJSONLines(ps.barsPath, bars); err != nil {
		return nil, nil, nil, err
	}
	if err := rewriteJSONLines(ps.tapePath, tape); err != nil {
		return nil, nil, nil, err
	}
	if err := rewriteJSONLines(ps.depthPath, depth); err != nil {
		return nil, nil, nil, err
	}

	ps.barEntries = len(bars)
	ps.tapeEntries = len(tape)
	ps.depthEntries = len(depth)

	return bars, tape, depth, nil
}

func (ps *persistenceStore) AppendBar(item BroadcastMsg, retained []BroadcastMsg) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if err := appendJSONLine(ps.barsPath, item); err != nil {
		return err
	}
	ps.barEntries++
	if ps.barEntries > maxHistory*2 {
		if err := rewriteJSONLines(ps.barsPath, retained); err != nil {
			return err
		}
		ps.barEntries = len(retained)
	}
	return nil
}

func (ps *persistenceStore) AppendTrade(item TapeTrade, retained []TapeTrade) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if err := appendJSONLine(ps.tapePath, item); err != nil {
		return err
	}
	ps.tapeEntries++
	if ps.tapeEntries > maxRecentTrades*20 {
		if err := rewriteJSONLines(ps.tapePath, retained); err != nil {
			return err
		}
		ps.tapeEntries = len(retained)
	}
	return nil
}

func (ps *persistenceStore) AppendDepth(item DepthSnapshot, retained []DepthSnapshot) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if err := appendJSONLine(ps.depthPath, item); err != nil {
		return err
	}
	ps.depthEntries++
	if ps.depthEntries > maxRecentDepthSnapshots*2 {
		if err := rewriteJSONLines(ps.depthPath, retained); err != nil {
			return err
		}
		ps.depthEntries = len(retained)
	}
	return nil
}

func (ps *persistenceStore) ReplaceBars(retained []BroadcastMsg) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if err := rewriteJSONLines(ps.barsPath, retained); err != nil {
		return err
	}
	ps.barEntries = len(retained)
	return nil
}

func (ps *persistenceStore) ReplaceTrades(retained []TapeTrade) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if err := rewriteJSONLines(ps.tapePath, retained); err != nil {
		return err
	}
	ps.tapeEntries = len(retained)
	return nil
}

func appendJSONLine(path string, value any) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	return encoder.Encode(value)
}

func rewriteJSONLines[T any](path string, items []T) error {
	tempPath := path + ".tmp"
	file, err := os.Create(tempPath)
	if err != nil {
		return err
	}

	encoder := json.NewEncoder(file)
	for _, item := range items {
		if err := encoder.Encode(item); err != nil {
			file.Close()
			_ = os.Remove(tempPath)
			return err
		}
	}

	if err := file.Close(); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return os.Rename(tempPath, path)
}

func loadJSONLines[T any](path string, limit int) ([]T, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)

	items := make([]T, 0, limit)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var item T
		if err := json.Unmarshal(line, &item); err != nil {
			continue
		}

		if limit > 0 && len(items) == limit {
			copy(items, items[1:])
			items[len(items)-1] = item
		} else {
			items = append(items, item)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
