# CVD, OI, Footprint, and Liquidity Playbook

This note turns the research into a software blueprint. It is not a promise of "perfect trades." The best use of these tools is to improve context, timing, and invalidation.

## What each input should mean

- Footprint / delta:
  Shows who was aggressive inside the bar and whether price accepted or rejected that aggression.
- CVD:
  Best used as a structure comparison tool against price, not as a standalone trigger.
- Open interest:
  Helps separate new positioning from liquidation or covering.
- Visible liquidity:
  Helps explain whether price is moving into support, resistance, a vacuum, or absorption.

## Core read combinations

- Price up + CVD or delta up + OI up:
  Fresh longs are more likely building.
- Price up + CVD or delta up + OI down:
  Short covering is more likely driving the move.
- Price down + CVD or delta down + OI up:
  Fresh shorts are more likely building.
- Price down + CVD or delta down + OI down:
  Long liquidation is more likely driving the move.
- Price up + CVD or delta down:
  Possible passive sell absorption, late-buyer trap, or weakening auction.
- Price down + CVD or delta up:
  Possible buyer absorption, seller exhaustion, or weakening downside auction.

## Liquidity overlay

- Heavy bid liquidity just below price:
  Stronger support context, especially if sells hit into it and price does not extend.
- Heavy ask liquidity just above price:
  Stronger resistance context, especially if buys hit into it and price stalls.
- Stacked imbalance zones:
  Good revisit locations. Exocharts documents these as potential support or resistance on revisit.

## Data-quality constraints we need to respect

- Bybit WebSocket ticker carries `openInterest` for live OI context:
  [Bybit ticker docs](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker)
- Bybit REST open interest history is interval-based, and `5min` is the smallest supported interval:
  [Bybit open interest docs](https://bybit-exchange.github.io/docs/v5/market/open-interest)
- Bybit orderbook is a snapshot + delta stream, so replay quality depends on capturing those updates accurately:
  [Bybit orderbook docs](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook)
- Tick size and instrument metadata should come from exchange metadata, not hardcoding:
  [Bybit instruments info docs](https://bybit-exchange.github.io/docs/v5/market/instrument)

## Vendor workflow ideas worth copying

- Exocharts lets users tune imbalance thresholds and ignore zero prints, which matters for noise control:
  [Exocharts VA / POC / Imbalance settings](https://help.exocharts.com/hc/en-us/articles/4408108187537-VA-Value-area-POC-point-of-control-Imbalance-settings)
- Exocharts describes stacked imbalances as revisit levels that may act as support or resistance:
  [Exocharts stacked imbalance basic concept](https://help.exocharts.com/hc/en-us/articles/12476160004497-Basic-concept)
- Bookmap emphasizes that absorption can reveal passive or hidden liquidity that is not obvious from the heatmap alone:
  [Bookmap absorption](https://bookmap.com/absorption/)
- Bookmap also treats record/replay and depth-aware review as a first-class workflow:
  [Bookmap features](https://bookmap.com/en/features)

## Product direction

- Show the trader plain-English participation reads:
  `Fresh longs`, `short covering`, `long liquidation`, `seller absorption`, `bid support below`, `ask wall above`
- Keep the data quality explicit:
  `Live footprint`, `history OI only`, `visible book snapshot`
- Do not fake historical CVD:
  Show gaps or muted states when the app does not have raw trade history
- Treat footprint as the trigger layer, not the location layer:
  Best signals come when the read happens at pre-marked levels, profiles, or session edges
