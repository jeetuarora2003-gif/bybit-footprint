# Bybit Footprint Chart

Real-time BTCUSDT footprint chart with volume delta — built on Bybit V5 WebSocket.

![Dashboard](https://img.shields.io/badge/status-production--ready-brightgreen)
![Go](https://img.shields.io/badge/Go-1.23+-00ADD8?logo=go)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![lightweight-charts](https://img.shields.io/badge/lightweight--charts-v4-blueviolet)

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌────────────────────────┐
│  Bybit V5 WSS       │────▶│  Go Backend (:8080)      │────▶│  React Frontend (:5173)│
│  publicTrade.BTCUSDT │     │  • Worker pool (4 workers)│     │  • lightweight-charts  │
│                     │     │  • Exp backoff reconnect  │     │  • Canvas overlay      │
│                     │     │  • 500ms debounce         │     │  • CVD + Delta panels  │
└─────────────────────┘     └──────────────────────────┘     └────────────────────────┘
```

**Data pipeline:**
1. Go backend connects to `wss://stream.bybit.com/v5/public/linear`
2. Subscribes to `publicTrade.BTCUSDT`
3. Worker pool parses JSON, extracts trades (field `S` = taker side, `v` = size, `p` = price)
4. Aggregates into 1-minute candles with volume-at-price clusters (`rowSize = 0.5`)
5. Tracks session CVD (Cumulative Volume Delta) as running total
6. Broadcasts current candle state every 500ms to local WebSocket `ws://localhost:8080`
7. Frontend renders OHLC candles, cluster overlay, CVD line, and delta histogram

---

## Run Locally

### Prerequisites

- [Go 1.23+](https://go.dev/dl/)
- [Node.js 18+](https://nodejs.org/)

### Backend

```bash
cd backend
go build -o footprint.exe .
./footprint.exe
# ▶  Footprint WS server listening on :8080
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** — the dashboard connects to `ws://localhost:8080` automatically.

---

## Run via Docker

```bash
# Build
docker build -t bybit-footprint .

# Run
docker run -p 8080:8080 -p 3000:3000 bybit-footprint
```

- **UI:** http://localhost:3000
- **WebSocket:** ws://localhost:8080

> **Note:** The frontend inside Docker connects to `ws://localhost:8080`. If
> you're accessing the UI from outside the container, both ports must be
> forwarded (`-p 8080:8080 -p 3000:3000`).

---

## specs.md Contract

The file `specs.md.txt` in the project root defines the **exact data contract**
between the Go backend and the React frontend:

### Bybit Inbound Schema

Each push from Bybit's `publicTrade.BTCUSDT` stream is an envelope with a
`data` array. Key trade fields:

| Field | Type   | Description                              |
|-------|--------|------------------------------------------|
| `T`   | number | Execution timestamp (ms)                 |
| `S`   | string | Taker side: `"Buy"` or `"Sell"`          |
| `v`   | string | Trade size (quantity) as string           |
| `p`   | string | Trade price as string                    |

### Volume Delta Formula

```
Volume Delta = Σ(taker buy volume) − Σ(taker sell volume)
```

- `S == "Buy"` → add to buy volume, CVD += vol
- `S == "Sell"` → add to sell volume, CVD -= vol

### Price Bucketing

```
rowSize   = 0.5
rowIndex  = floor(price / rowSize)
bucketPrice = rowIndex × rowSize
```

### Backend → Frontend Output (every 500ms)

```json
{
  "candle_open_time": 1672304460000,
  "open":  16575.00,
  "high":  16580.00,
  "low":   16573.50,
  "close": 16578.50,
  "clusters": [
    { "price": 16573.5, "buyVol": 1.2, "sellVol": 3.4, "delta": -2.2, "totalVol": 4.6 },
    { "price": 16574.0, "buyVol": 5.0, "sellVol": 2.1, "delta":  2.9, "totalVol": 7.1 }
  ],
  "candle_delta": 3.2,
  "cvd": 45.7
}
```

| Field              | Type     | Description                                       |
|--------------------|----------|---------------------------------------------------|
| `candle_open_time` | int64    | Floored minute timestamp (ms)                     |
| `open/high/low/close` | float | Standard OHLC for the 1-min candle               |
| `clusters`         | array    | Volume-at-price rows sorted by price ascending    |
| `clusters[].price` | float    | Canonical bucket price                            |
| `clusters[].buyVol` / `sellVol` | float | Accumulated buy/sell volume at this price |
| `clusters[].delta` | float    | `buyVol - sellVol`                                |
| `clusters[].totalVol` | float | `buyVol + sellVol`                                |
| `candle_delta`     | float    | Sum of delta across all clusters                  |
| `cvd`              | float    | Session-level cumulative volume delta              |

---

## Stress Test

A self-contained stress test simulates 2000 ticks/sec for 10 seconds:

```bash
cd backend/stress_test
go run .
```

Results on 12-core machine:
```
✅ PASS: Broadcast debounce OK (2.10 msg/sec ≤ 2)
✅ PASS: Throughput 2000 ticks/sec (target 2000)
✅ PASS: Memory 0.16 MB (< 50 MB budget)
🎉 ALL CHECKS PASSED — pipeline handles 2000 ticks/sec
```

---

## Production Hardening

| Feature                    | Implementation                                    |
|----------------------------|---------------------------------------------------|
| Worker pool                | 4 goroutines consuming from a 256-slot job channel |
| Exponential backoff        | 1s → 2s → 4s → 8s → 16s → 30s, max 5 retries    |
| Broadcast debounce         | 500ms `time.Ticker` — max 2 messages/sec          |
| Ring buffer                | 8192-slot circular buffer absorbs write bursts     |
| Non-blocking job dispatch  | Drops messages if worker pool is saturated         |
| Auto-reconnect (frontend)  | WebSocket hook reconnects on close after 2s        |

---

## Project Structure

```
bybit/
├── backend/
│   ├── main.go              # Go server (Bybit WS → aggregator → local WS)
│   ├── go.mod / go.sum
│   ├── footprint.exe         # Built binary
│   └── stress_test/          # Self-contained throughput benchmark
│       └── main.go
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Root component
│   │   ├── hooks/
│   │   │   └── useWebSocket.js  # Auto-reconnect WS + candle history
│   │   └── components/
│   │       ├── FootprintChart.jsx / .css  # OHLC + canvas overlay + CVD + histogram
│   │       ├── StatusBar.jsx / .css       # OHLC + delta + CVD info bar
│   │       └── ConnectionPill.jsx / .css  # Fixed connection status pill
│   ├── index.html
│   └── package.json
├── Dockerfile                # Multi-stage (Go + React → Alpine)
├── .dockerignore
├── specs.md.txt              # Data contract specification
└── README.md                 # This file
```

---

## License

MIT
