# Footprint Report Review And Software Roadmap

Source report reviewed:

- `C:\Users\jeetu\Downloads\BTC Footprint Charts  Sniper Usage and Top‑Tier Execution.md`

This note reviews that report from a product-design perspective, not a trading-performance perspective.
The goal is to turn the useful parts of the research into concrete software requirements for an Exocharts-class orderflow platform.

## Verdict

The report is useful, but only as a trader-behavior and workflow document.
It is not strong enough by itself to serve as the software specification.

What it gets right:

- Context first, footprint second.
- Absorption, imbalances, stacked imbalances, and delta divergence are core pattern families.
- Volume profile plus footprint is the right pairing.
- Replay and journaling are essential if the product is meant to improve execution quality.

What is missing or too soft:

- Exact software-level definitions for each signal.
- Exact data requirements for DOM, heatmap, and replay fidelity.
- Session controls, data filters, tick-size handling, and workspace behavior.
- Separation between educational claims and measurable platform features.

## Problems In The Original Report

### 1. Source quality is mixed

The report cites blogs and YouTube material alongside useful concepts.
That is acceptable for idea discovery, but not for platform requirements.
Platform design should lean much more heavily on:

- official Exocharts help/manual pages
- official exchange market-data docs
- official platform docs from comparable products

### 2. Several concepts need stricter definitions

Terms like absorption, exhaustion, delta divergence, and trap need software-ready rules.
For the app, each must become:

- a calculation definition
- a threshold set
- a visualization mode
- a replay/testable event

Without that, two users can look at the same bar and disagree on whether a pattern exists.

### 3. The report under-specifies data fidelity requirements

A true footprint tool is not just a chart renderer.
To support heatmap, DOM, and meaningful replay, the platform needs:

- raw trade events
- full orderbook snapshot/delta handling
- symbol metadata including tick size
- session-aware aggregation
- event recording with bounded retention

### 4. It treats workflow ideas as if they are already platform features

The report recommends:

- profile context
- session-aware trading
- replay
- pattern journaling
- structural stops

Those are good ideas, but they must be surfaced in product design through settings, overlays, replay, tagging, screenshots, templates, and analytics.

### 5. The report file itself has encoding issues

The downloaded markdown contains visible mojibake (`â€`, `â€“`, etc.).
If we reuse it in-product or in docs, it should be cleaned first.

## Official-Docs Additions That Matter For The Software

### Exocharts-style settings and workflow

Official Exocharts help shows that a strong orderflow platform is not only about footprint bars.
It also includes:

- configurable footprint bar statistics rows like volume, delta, CVD, POC, high/low, time, and trade count
- configurable VA / POC / imbalance settings
- session controls and time-zone controls
- chart period setup and multiple chart types
- data-source filters such as market-order-only mode and small/large trade filters
- workspaces, templates, and desktop-oriented workflow

This means our app should not stop at “draw bid/ask numbers in candles.”
It needs a broader workstation model.

### Stacked imbalances should behave like zones, not one-bar decorations

Exocharts’ own help treats stacked imbalances as levels that can matter again when revisited.
So in our software they should become:

- persistent zones
- extend-right visuals
- revisit alerts
- replay-verifiable reactions

Not just temporary colored cells.

### Value area and POC need richer options

Official Exocharts documentation exposes more nuance than a basic VA/POC toggle:

- raw POC handling
- VA percentage controls
- naked POC / naked VA extension behavior
- line/ray modes
- imbalance thresholds

Our platform should expose those as first-class settings if the goal is Exocharts-level depth.

### Heatmap and DOM require deeper orderbook handling

Bookmap’s official product pages emphasize:

- full market depth visibility
- liquidity heatmap
- order-book plus trade interaction
- record-and-replay with depth context

That is a strong confirmation that a “best-in-class” tool cannot rely only on sampled top-of-book snapshots.
It needs better orderbook event capture and replay.

### Bybit-specific data rules matter

Bybit’s official docs add several important engineering constraints:

- `orderbook` streams publish `snapshot` and `delta`, and local books must be updated correctly
- linear futures support multiple depths, including deeper books than level 50
- `publicTrade` messages can batch many trades in one message, and the same `seq` can appear across multiple messages
- best bid/ask and sizes are also available through the ticker channel
- instrument metadata includes `tickSize`

That means we should remove hardcoded symbol/tick assumptions and build from exchange metadata.

## What This Means For Our Product Roadmap

### Tier 1: Must-have foundation

1. Dynamic instrument metadata
   - Pull `tickSize`, quantity precision, and symbol metadata from Bybit instrument info.

2. Session system
   - Add chart session templates, time-zone controls, day-start markers, and session resets.

3. Data-source filters
   - Add trade-size filtering, market-order-only views, and optional filtered-vs-OHLC behavior.

4. Stronger event recording
   - Keep bounded raw trade storage and improve bounded depth-event retention.

### Tier 2: Exocharts-class footprint behavior

1. Full VA / POC / imbalance settings panel
   - Configurable VA percent, raw POC, naked POC, naked VA, imbalance threshold, ignore-zero behavior.

2. Persistent stacked-imbalance zones
   - Extend-right zone rendering, revisit highlighting, and per-zone alerts.

3. Better signal taxonomy
   - Absorption, exhaustion, unfinished auction, sweeps, divergences, large trades.
   - All signals should be configurable and testable.

4. FPBS-style statistics rows
   - Volume, delta, CVD, POC, H/L, time, trades count as optional rows.

### Tier 3: Market microstructure depth

1. Better DOM
   - More depth levels, faster update path, stronger ladder presentation.

2. True heatmap
   - Replayable liquidity-history visualization based on depth changes, not just sparse snapshots.

3. Event replay
   - Replay trades and orderbook events together, not just rebuilt candles.

### Tier 4: Workstation quality

1. Templates and workspaces
   - Save layouts, modes, studies, sessions, symbol presets.

2. Journaling workflow
   - One-click screenshot, tags, notes, outcome labels, replay bookmarks.

3. Execution ergonomics
   - Ladder actions, chart trading, bracket logic, quick cancel/flatten once execution is in scope.

## How This Maps To The Current Code

Current strengths:

- The app already computes imbalance, stacked imbalance, absorption, exhaustion, sweeps, and divergence-style alerts in:
  - `frontend/src/market/aggregate.js`
- The worker now records bounded raw trade history and drives replay from worker-side state:
  - `frontend/src/workers/marketDataWorker.js`
- The chart already supports footprint rendering, DOM overlay, and a depth-history heatmap path:
  - `frontend/src/components/ChartCanvas.jsx`

Current gaps:

- tick size is still effectively fixed in the frontend aggregation path
- sessions/time-zone controls are missing
- trade-source filters are missing
- stacked imbalances are not yet persistent revisit zones
- heatmap is still based on limited retained depth snapshots rather than a fuller orderbook-history model
- replay is stronger than before but still not full orderbook-delta replay

## Recommended Next Build Order

1. Dynamic symbol metadata and tick-size plumbing
2. Session/time-zone/day-start system
3. VA / POC / imbalance settings panel
4. Persistent stacked-imbalance zones
5. Trade-size filters and filtered data modes
6. Improved orderbook capture for better heatmap / DOM replay
7. Journaling and replay bookmarks

## Research Sources Used For This Review

- Exocharts Help: Main settings
- Exocharts Help: Volume Profile
- Exocharts Help: VA / POC / Imbalance settings
- Exocharts Help: Stacked Imbalance basic concept
- Exocharts Help: Data source settings
- Exocharts Help: Session settings
- Exocharts Help: Chart Period Setup
- Exocharts Help: Desktop release notes
- Bookmap official features page
- Bybit official docs: WebSocket orderbook, public trade, ticker, and instruments info
