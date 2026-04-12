# Bybit Footprint Engine

BTCUSD inverse footprint workstation for Bybit, with a browser-rendered chart and a local desktop launcher.

## Current Architecture

- `frontend/`
  - React + Vite UI
  - Browser `Web Worker` connects to Bybit inverse public streams
  - Aggregates footprint bars, CVD, DOM snapshots, replay cache, and derived studies locally
- `backend/cmd/desktop/`
  - Small local desktop server used by the double-click app
  - Serves the built frontend plus `/api/history`, `/api/instrument`, and `/api/interpret`
- `backend/`
  - Root Go backend path kept for the standalone backend/server workflow
- `cloudflare/`
  - Lightweight REST proxy path for the online-first deployment flow

## Data Source

- Symbol: `BTCUSD`
- Category: `inverse`
- Live streams:
  - `publicTrade.BTCUSD`
  - `orderbook.200.BTCUSD`
  - `tickers.BTCUSD`

The desktop and root backend paths are aligned to BTCUSD inverse. Current footprint volume is exchange-native inverse contract volume so cluster sizes match Exocharts-style BTCUSD displays more closely.

## Local Development

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Root Go backend

```bash
cd backend
go test ./...
go build -o footprint .
./footprint
```

## Desktop App

To rebuild the desktop launcher:

```bash
powershell -ExecutionPolicy Bypass -File .\build-desktop.ps1
```

That generates:

```text
desktop-app/Bybit Footprint.exe
```

And refreshes the desktop shortcut:

```text
Desktop/Bybit Footprint.lnk
```

## Verification

```bash
cd frontend
npm run lint
npm run build
```

```bash
cd backend
go test ./...
```

## Notes

- Historical backfill comes from Bybit REST and is used mainly for price/history continuity.
- Live footprint, delta, CVD, and DOM behavior come from captured trade and book streams.
- IndexedDB is used as a bounded local cache in the browser/desktop UI path.
