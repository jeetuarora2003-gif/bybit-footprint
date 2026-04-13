package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	_ "modernc.org/sqlite"
)

type persistenceStore struct {
	mu sync.Mutex
	db *sql.DB
}

const feedIdentityMetaKey = "feed_identity"

func newPersistenceStore(baseDir string) (*persistenceStore, error) {
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(baseDir, "footprint.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(1)
	store := &persistenceStore{db: db}
	if err := store.initSchema(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (ps *persistenceStore) initSchema() error {
	schema := `
	PRAGMA journal_mode = WAL;
	PRAGMA synchronous = NORMAL;
	CREATE TABLE IF NOT EXISTS bars (
		candle_open_time INTEGER PRIMARY KEY,
		payload TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS tape (
		trade_key TEXT PRIMARY KEY,
		timestamp INTEGER NOT NULL,
		seq INTEGER NOT NULL,
		payload TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_tape_timestamp_seq ON tape(timestamp, seq);
	CREATE TABLE IF NOT EXISTS depth (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp INTEGER NOT NULL,
		payload TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_depth_timestamp ON depth(timestamp);
	CREATE TABLE IF NOT EXISTS metadata (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	`
	_, err := ps.db.Exec(schema)
	return err
}

func (ps *persistenceStore) EnsureFeedIdentity(identity string) (bool, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	var current string
	err := ps.db.QueryRow(`SELECT value FROM metadata WHERE key = ?`, feedIdentityMetaKey).Scan(&current)
	if err != nil && err != sql.ErrNoRows {
		return false, err
	}
	if current == identity {
		return false, nil
	}

	err = ps.withTx(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM bars`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM tape`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM depth`); err != nil {
			return err
		}
		_, err := tx.Exec(`
			INSERT INTO metadata (key, value)
			VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value
		`, feedIdentityMetaKey, identity)
		return err
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

func (ps *persistenceStore) Load() ([]BroadcastMsg, []TapeTrade, []DepthSnapshot, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	bars, err := loadOrderedRows[BroadcastMsg](ps.db, `
		SELECT payload
		FROM (
			SELECT payload, candle_open_time
			FROM bars
			ORDER BY candle_open_time DESC
			LIMIT ?
		)
		ORDER BY candle_open_time ASC
	`, maxHistory)
	if err != nil {
		return nil, nil, nil, err
	}

	tape, err := loadOrderedRows[TapeTrade](ps.db, `
		SELECT payload
		FROM (
			SELECT payload, timestamp, seq
			FROM tape
			ORDER BY timestamp DESC, seq DESC
			LIMIT ?
		)
		ORDER BY timestamp ASC, seq ASC
	`, maxRecentTrades)
	if err != nil {
		return nil, nil, nil, err
	}

	depth, err := loadOrderedRows[DepthSnapshot](ps.db, `
		SELECT payload
		FROM (
			SELECT payload, id
			FROM depth
			ORDER BY id DESC
			LIMIT ?
		)
		ORDER BY id ASC
	`, maxRecentDepthSnapshots)
	if err != nil {
		return nil, nil, nil, err
	}

	return bars, tape, depth, nil
}

func (ps *persistenceStore) AppendBar(item BroadcastMsg, retained []BroadcastMsg) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	return ps.withTx(func(tx *sql.Tx) error {
		if err := upsertBar(tx, item); err != nil {
			return err
		}
		_, err := tx.Exec(`
			DELETE FROM bars
			WHERE candle_open_time NOT IN (
				SELECT candle_open_time
				FROM bars
				ORDER BY candle_open_time DESC
				LIMIT ?
			)
		`, maxHistory)
		return err
	})
}

func (ps *persistenceStore) AppendTrade(item TapeTrade, retained []TapeTrade) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	return ps.withTx(func(tx *sql.Tx) error {
		if err := upsertTrade(tx, item); err != nil {
			return err
		}
		_, err := tx.Exec(`
			DELETE FROM tape
			WHERE trade_key NOT IN (
				SELECT trade_key
				FROM tape
				ORDER BY timestamp DESC, seq DESC
				LIMIT ?
			)
		`, maxRecentTrades)
		return err
	})
}

func (ps *persistenceStore) AppendDepth(item DepthSnapshot, retained []DepthSnapshot) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	return ps.withTx(func(tx *sql.Tx) error {
		if err := insertDepth(tx, item); err != nil {
			return err
		}
		_, err := tx.Exec(`
			DELETE FROM depth
			WHERE id NOT IN (
				SELECT id
				FROM depth
				ORDER BY id DESC
				LIMIT ?
			)
		`, maxRecentDepthSnapshots)
		return err
	})
}

func (ps *persistenceStore) ReplaceBars(retained []BroadcastMsg) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	return ps.withTx(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM bars`); err != nil {
			return err
		}
		for _, item := range retained {
			if err := upsertBar(tx, item); err != nil {
				return err
			}
		}
		return nil
	})
}

func (ps *persistenceStore) ReplaceTrades(retained []TapeTrade) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	return ps.withTx(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM tape`); err != nil {
			return err
		}
		for _, item := range retained {
			if err := upsertTrade(tx, item); err != nil {
				return err
			}
		}
		return nil
	})
}

func (ps *persistenceStore) withTx(fn func(tx *sql.Tx) error) error {
	tx, err := ps.db.Begin()
	if err != nil {
		return err
	}

	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func loadOrderedRows[T any](db *sql.DB, query string, limit int) ([]T, error) {
	rows, err := db.Query(query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]T, 0, limit)
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var item T
		if err := json.Unmarshal([]byte(payload), &item); err != nil {
			continue
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func upsertBar(tx *sql.Tx, item BroadcastMsg) error {
	payload, err := json.Marshal(item)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`
		INSERT INTO bars (candle_open_time, payload)
		VALUES (?, ?)
		ON CONFLICT(candle_open_time) DO UPDATE SET payload = excluded.payload
	`, item.CandleOpenTime, string(payload))
	return err
}

func upsertTrade(tx *sql.Tx, item TapeTrade) error {
	payload, err := json.Marshal(item)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`
		INSERT INTO tape (trade_key, timestamp, seq, payload)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(trade_key) DO UPDATE SET
			timestamp = excluded.timestamp,
			seq = excluded.seq,
			payload = excluded.payload
	`, tradePrimaryKey(item), item.Timestamp, item.Seq, string(payload))
	return err
}

func insertDepth(tx *sql.Tx, item DepthSnapshot) error {
	payload, err := json.Marshal(item)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`
		INSERT INTO depth (timestamp, payload)
		VALUES (?, ?)
	`, item.Timestamp, string(payload))
	return err
}

func tradePrimaryKey(item TapeTrade) string {
	if item.ID != "" {
		return item.ID
	}
	return fmt.Sprintf(
		"%s_%s_%s_%s_%s",
		strconv.FormatInt(item.Timestamp, 10),
		strconv.FormatInt(item.Seq, 10),
		strconv.FormatFloat(item.Price, 'f', 6, 64),
		strconv.FormatFloat(item.Volume, 'f', 6, 64),
		item.Side,
	)
}
