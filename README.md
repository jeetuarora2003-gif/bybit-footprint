# Bybit Footprint

A market-data visualization project connecting a Go backend to a React frontend through WebSockets. Custom Canvas rendering displays footprint charts and related market information.

## Architecture
- **Go backend:** connects to Bybit V5 market-data streams, aggregates trade/order-book information and broadcasts data to browser clients.
- **React frontend:** receives streaming updates and renders charts using the Canvas 2D API.
- **Interaction:** chart navigation, zoom and display controls.

## Stack
Go · React · JavaScript · Vite · WebSockets · HTML Canvas

## Run locally
Install Go and Node.js versions compatible with `backend/go.mod` and `frontend/package.json`.

Start the backend:
```sh
cd backend
go build -o footprint .
```
Run the resulting binary (`./footprint` on Unix or `.\footprint.exe` on Windows).

In a separate terminal:
```sh
cd frontend
npm install
npm run dev
```

## Scope and verification
This is a development and data-visualization project. Market connectivity and runtime performance depend on configuration, network conditions and the upstream API. No independently verified throughput, latency or frame-rate benchmark is claimed.

The repository contains historical compiled binaries; build from source when evaluating the project. A packaged public release is not documented here.
