const BYBIT_BASE_URL = "https://api.bybit.com";
const MINUTE_MS = 60_000;
const MAX_LIMIT = 5000;
const MAX_BACKFILL_PAGES = 16;
const MAX_OI_PAGES = 16;
const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_ROW_SIZE = 0.1;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/health") {
      return withCors(json({ ok: true }));
    }

    if (url.pathname === "/history") {
      return handleHistoryRequest(url);
    }

    return withCors(json({ error: "Not found" }, 404));
  },
};

async function handleHistoryRequest(url) {
  const symbol = (url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const limit = clampInt(url.searchParams.get("limit"), 1, MAX_LIMIT, 5000);

  try {
    const klines = await fetchRecentKlines(symbol, limit);
    const bars = klines.map((kline) => ({
      candle_open_time: kline.openTime,
      open: round6(kline.open),
      high: round6(kline.high),
      low: round6(kline.low),
      close: round6(kline.close),
      row_size: DEFAULT_ROW_SIZE,
      clusters: [],
      candle_delta: 0,
      cvd: 0,
      buy_trades: 0,
      sell_trades: 0,
      total_volume: round6(kline.volume),
      buy_volume: 0,
      sell_volume: 0,
      oi: 0,
      oi_delta: 0,
      best_bid: 0,
      best_bid_size: 0,
      best_ask: 0,
      best_ask_size: 0,
      bids: [],
      asks: [],
      unfinished_low: false,
      unfinished_high: false,
      absorption_low: false,
      absorption_high: false,
      exhaustion_low: false,
      exhaustion_high: false,
      sweep_buy: false,
      sweep_sell: false,
      delta_divergence_bull: false,
      delta_divergence_bear: false,
      alerts: [],
      orderflow_coverage: 0,
      data_source: "bybit_kline_backfill",
    }));

    if (bars.length > 0) {
      const oiSnapshots = await fetchOpenInterestHistory(
        symbol,
        bars[0].candle_open_time,
        bars.at(-1).candle_open_time + MINUTE_MS,
      );
      applyOpenInterest(bars, oiSnapshots);
    }

    return withCors(json(bars));
  } catch (error) {
    return withCors(json({
      error: "history_fetch_failed",
      detail: error instanceof Error ? error.message : String(error),
    }, 502));
  }
}

async function fetchRecentKlines(symbol, limit) {
  const pageLimit = Math.min(1000, limit);
  const barsByOpenTime = new Map();
  let nextEnd = Date.now();

  for (let page = 0; page < MAX_BACKFILL_PAGES && barsByOpenTime.size < limit; page += 1) {
    const result = await fetchBybitJson("/v5/market/kline", {
      category: "linear",
      symbol,
      interval: "1",
      limit: String(pageLimit),
      end: String(nextEnd),
    });

    const items = Array.isArray(result?.list) ? result.list : [];
    if (items.length === 0) {
      break;
    }

    let oldestTs = 0;
    for (const item of items) {
      if (!Array.isArray(item) || item.length < 6) continue;
      const openTime = Number.parseInt(item[0], 10);
      const open = Number.parseFloat(item[1]);
      const high = Number.parseFloat(item[2]);
      const low = Number.parseFloat(item[3]);
      const close = Number.parseFloat(item[4]);
      const volume = Number.parseFloat(item[5]);
      if (![openTime, open, high, low, close, volume].every(Number.isFinite)) continue;

      barsByOpenTime.set(openTime, {
        openTime,
        open,
        high,
        low,
        close,
        volume,
      });

      if (!oldestTs || openTime < oldestTs) {
        oldestTs = openTime;
      }
    }

    if (!oldestTs) {
      break;
    }
    nextEnd = oldestTs - MINUTE_MS;
  }

  return [...barsByOpenTime.values()]
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-limit);
}

async function fetchOpenInterestHistory(symbol, startTime, endTime) {
  let cursor = "";
  const snapshotsByTs = new Map();

  for (let page = 0; page < MAX_OI_PAGES; page += 1) {
    const params = {
      category: "linear",
      symbol,
      intervalTime: "5min",
      limit: "200",
      startTime: String(startTime),
      endTime: String(endTime),
    };
    if (cursor) {
      params.cursor = cursor;
    }

    const result = await fetchBybitJson("/v5/market/open-interest", params);
    const items = Array.isArray(result?.list) ? result.list : [];
    if (items.length === 0) {
      break;
    }

    let oldestTs = 0;
    for (const item of items) {
      const ts = Number.parseInt(item?.timestamp, 10);
      const openInterest = Number.parseFloat(item?.openInterest);
      if (!Number.isFinite(ts) || !Number.isFinite(openInterest)) continue;
      snapshotsByTs.set(ts, { timestamp: ts, openInterest: round6(openInterest) });
      if (!oldestTs || ts < oldestTs) {
        oldestTs = ts;
      }
    }

    if (!result?.nextPageCursor || oldestTs <= startTime) {
      break;
    }
    cursor = result.nextPageCursor;
  }

  return [...snapshotsByTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function applyOpenInterest(bars, snapshots) {
  if (!bars.length || !snapshots.length) return;

  let snapshotIndex = 0;
  let currentOi = 0;
  let hasOi = false;
  let previousOi = 0;
  let previousAssigned = false;

  for (const bar of bars) {
    const closeTs = bar.candle_open_time + MINUTE_MS;
    while (snapshotIndex < snapshots.length && snapshots[snapshotIndex].timestamp <= closeTs) {
      currentOi = snapshots[snapshotIndex].openInterest;
      hasOi = true;
      snapshotIndex += 1;
    }
    if (!hasOi) continue;

    bar.oi = currentOi;
    bar.oi_delta = previousAssigned ? round6(currentOi - previousOi) : 0;
    previousOi = currentOi;
    previousAssigned = true;
  }
}

async function fetchBybitJson(path, params) {
  const url = new URL(`${BYBIT_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "bybit-footprint-proxy/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Bybit returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.retCode !== 0) {
    throw new Error(`Bybit retCode=${payload?.retCode} retMsg=${payload?.retMsg}`);
  }
  return payload.result;
}

function clampInt(value, min, max, fallback) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function round6(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
