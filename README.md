# Bybit Footprint Chart

Online-first BTCUSDT footprint chart with a browser-side market-data engine.

## Current Architecture

- `frontend/`
  - React + Vite UI
  - Browser `Web Worker` connects directly to Bybit public WebSocket
  - 1-minute trade aggregation, footprint clusters, DOM snapshots, and replay cache happen in the browser
  - IndexedDB keeps a bounded local cache instead of growing forever
- `cloudflare/`
  - Tiny Cloudflare Worker proxy for REST backfill only
  - Used for kline and open-interest history because Bybit REST is not browser-friendly for direct CORS usage
- `backend/`
  - Existing Go backend kept in the repo as the older local-server path
  - The frontend no longer depends on it for the online deployment path

## Why This Setup

- Lowest latency for live data: browser connects straight to Bybit
- No always-on server in the live path
- Free hosting is realistic because the server only handles light history requests
- Local storage stays bounded because only a fixed recent cache is retained

## Data Flow

1. Browser worker subscribes to:
   - `publicTrade.BTCUSDT`
   - `orderbook.50.BTCUSDT`
   - `tickers.BTCUSDT`
2. Trades are aggregated into 1-minute footprint bars in the browser.
3. Orderbook snapshots are sampled into a rolling depth-history cache.
4. The main thread receives pre-aggregated chart updates every 500 ms.
5. Historical backfill comes from the Cloudflare Worker at `/history`.

## Local Development

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app can run without the proxy, but historical backfill will be missing until a proxy URL is configured.

### Desktop App

If you want a real double-click launcher instead of terminals:

```bash
powershell -ExecutionPolicy Bypass -File .\build-desktop.ps1
```

That generates:

```text
desktop-app/Bybit Footprint.exe
```

The build also drops a shortcut on your Windows desktop:

```text
Desktop/Bybit Footprint.lnk
```

Double-click either the `.exe` or the desktop shortcut and it will:

- start a small local server
- open your browser automatically
- serve the app and `/api/history` locally

### Cloudflare Worker

```bash
cd cloudflare
wrangler dev
```

If you run the worker locally, point the frontend at it:

```bash
cd frontend
copy .env.example .env.local
```

Set:

```bash
VITE_PROXY_BASE_URL=http://127.0.0.1:8787
```

## Deploy

### 1. Deploy the REST proxy

```bash
cd cloudflare
wrangler deploy
```

This creates a worker URL like:

```text
https://your-worker-name.your-subdomain.workers.dev
```

### 2. Deploy the frontend

Use Cloudflare Pages for `frontend/`.

Build settings:

- Build command: `npm run build`
- Output directory: `dist`

Set the Pages environment variable:

```text
VITE_PROXY_BASE_URL=https://your-worker-name.your-subdomain.workers.dev
```

## Storage Model

The browser keeps a rolling local cache using IndexedDB:

- completed footprint bars
- depth-history snapshots

Old data is pruned automatically as new data arrives, so storage is bounded instead of growing without limit.

## Verification

Frontend checks:

```bash
cd frontend
npm run build
npm run lint
```

## Notes

- The current online path is optimized for one user and one symbol: `BTCUSDT`.
- Historical bars from the proxy are OHLCV + open-interest backfill, not full historical raw-trade replay.
- Live footprint, orderflow, and DOM updates come from the direct Bybit WebSocket path in the browser worker.
