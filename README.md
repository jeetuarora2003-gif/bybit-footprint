# Bybit Footprint Engine

A high-performance, professional-grade cryptocurrency orderflow aggregation terminal natively built for Bybit V5.

This platform bridges the gap between raw data streams and institutional-level insights by executing tick-precision aggregations directly over WebSocket, delivering Exocharts/TradingView-tier visualizations entirely in the browser using a custom-built HTML5 Canvas Engine.

## Core Architecture

The architecture consists of an immensely fast, decoupled backend/frontend system:

1. **Go Aggregation Backend**: Engineered in Go 1.23, the server subscribes directly to Bybit's V5 `publicTrade`, `orderbook.50`, and `tickers` WebSockets. It acts as a highly optimized pipeline—deduplicating ticks, strictly aligning order sequence numbers, aggregating Volume Deltas, tracking continuous Open Interest (OI), and broadcasting sanitized DOM states to the frontend client at low latencies.
2. **React/HTML5 Canvas Frontend**: Built purely out of custom raw `Canvas 2D` API draw loops powered by Vite + React. This completely detaches from the heavy DOM, leveraging hardware acceleration to flawlessly render tens of thousands of complex footprint clusters without stuttering. It uses sub-pixel kinetic physics for unbounded, 60fps TradingView-style navigation and zooming.

## Features

- **Advanced Footprint Clusters**: Deep inspection into real-time order matching. Supports Data Modes for raw Volume, Delta, Imbalance, and Bid-Ask distributions.
- **Custom Shading Toggles**: Toggle footprint row aesthetic styling via Adaptive Scaling or Current Rotation profiles directly from the toolbar.
- **TPO Market Profiles & Value Areas**: Advanced volume distribution metrics overlaying the price action—identifying the POC (Point of Control) and generating TPO distributions completely dynamically.
- **Real-Time Orderbook (DOM)**: Renders live liquidity directly alongside the price-axis dynamically.
- **Interactive UI Terminal**: Exocharts-styled professional workspace loaded with dedicated component tabs (TSize, vWAP, Rekt, FPBS) and custom configuration panels.
- **Continuous Session Stats**: A live tracking ribbon displaying continuous Cumulative Volume Delta (CVD), Open Interest (OI) divergence, real-time bid:ask ratios, and sub-panel histogram integrations.

## Running the Application

Because this architecture isolates the engine processing from the display client, both layers must be spun up:

### Backend Installation
Ensure you have Go installed on your machine.
```bash
cd backend
go build -o footprint .
./footprint
```

### Frontend Installation
You will need Node installed.
```bash
cd frontend
npm install
npm run dev
```
Navigate to `http://localhost:5173/` in your browser.

## Philosophy
Standard financial chart libraries (like `lightweight-charts` or raw `chart.js`) restrict traders from drawing granular nested cell clusters inside individual candlesticks. This engine relies on entirely custom aggregation functions and manual render loops to give the builder ultimate control over how data is processed, styled, and visualized.
