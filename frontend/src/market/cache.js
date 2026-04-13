const DB_NAME = "exo-footprint-cache";
const DB_VERSION = 6;
const BARS_STORE = "bars";
const DEPTH_STORE = "depth";
const TRADES_STORE = "trades";
const DEPTH_EVENTS_STORE = "depth_events";
const KEY_WIDTH = 16;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function normalizeSymbol(symbol) {
  return String(symbol || "BTCUSD").trim().toUpperCase() || "BTCUSD";
}

function paddedKey(value) {
  return String(Number(value) || 0).padStart(KEY_WIDTH, "0");
}

function decorateRecord(storeName, item, symbol) {
  const normalizedSymbol = normalizeSymbol(symbol ?? item?.symbol);
  if (!normalizedSymbol || !item) return null;

  if (storeName === BARS_STORE) {
    const openTime = Number(item?.candle_open_time) || 0;
    if (!openTime) return null;
    return {
      ...item,
      symbol: normalizedSymbol,
      cache_key: `${normalizedSymbol}:${paddedKey(openTime)}`,
    };
  }

  if (storeName === DEPTH_STORE) {
    const timestamp = Number(item?.timestamp) || 0;
    if (!timestamp) return null;
    return {
      ...item,
      symbol: normalizedSymbol,
      cache_key: `${normalizedSymbol}:${paddedKey(timestamp)}`,
    };
  }

  if (storeName === TRADES_STORE) {
    const eventId = String(item?.event_id || "").trim();
    if (!eventId) return null;
    return {
      ...item,
      symbol: normalizedSymbol,
      cache_key: `${normalizedSymbol}:${eventId}`,
    };
  }

  if (storeName === DEPTH_EVENTS_STORE) {
    const eventId = String(item?.event_id || "").trim();
    if (!eventId) return null;
    return {
      ...item,
      symbol: normalizedSymbol,
      cache_key: `${normalizedSymbol}:${eventId}`,
    };
  }

  return null;
}

let openPromise = null;

async function openDb() {
  if (!("indexedDB" in self)) {
    return null;
  }
  if (!openPromise) {
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of [BARS_STORE, DEPTH_STORE, TRADES_STORE, DEPTH_EVENTS_STORE]) {
          if (db.objectStoreNames.contains(name)) {
            db.deleteObjectStore(name);
          }
        }

        const bars = db.createObjectStore(BARS_STORE, { keyPath: "cache_key" });
        bars.createIndex("symbol", "symbol", { unique: false });
        bars.createIndex("candle_open_time", "candle_open_time", { unique: false });

        const depth = db.createObjectStore(DEPTH_STORE, { keyPath: "cache_key" });
        depth.createIndex("symbol", "symbol", { unique: false });
        depth.createIndex("timestamp", "timestamp", { unique: false });

        const trades = db.createObjectStore(TRADES_STORE, { keyPath: "cache_key" });
        trades.createIndex("symbol", "symbol", { unique: false });
        trades.createIndex("timestamp", "timestamp", { unique: false });

        const depthEvents = db.createObjectStore(DEPTH_EVENTS_STORE, { keyPath: "cache_key" });
        depthEvents.createIndex("symbol", "symbol", { unique: false });
        depthEvents.createIndex("timestamp", "timestamp", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return openPromise;
}

async function getAllForSymbol(db, storeName, symbol) {
  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const rows = await requestToPromise(store.index("symbol").getAll(normalizeSymbol(symbol)));
  await transactionDone(transaction);
  return rows || [];
}

async function trimStoreByCountForSymbol(store, symbol, maxCount, sortKey) {
  const rows = await requestToPromise(store.index("symbol").getAll(normalizeSymbol(symbol)));
  if (!rows?.length) return;

  const overflow = rows.length - maxCount;
  if (overflow <= 0) return;

  rows
    .slice()
    .sort((a, b) => {
      const delta = (Number(a?.[sortKey]) || 0) - (Number(b?.[sortKey]) || 0);
      if (delta !== 0) return delta;
      return String(a?.cache_key || "").localeCompare(String(b?.cache_key || ""));
    })
    .slice(0, overflow)
    .forEach((row) => {
      if (row?.cache_key) {
        store.delete(row.cache_key);
      }
    });
}

function sortTrades(trades) {
  return (trades || []).sort((a, b) => {
    const timestampDelta = (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0);
    if (timestampDelta !== 0) return timestampDelta;
    return (Number(a?.seq) || 0) - (Number(b?.seq) || 0);
  });
}

function stripCacheFields(rows) {
  return (rows || []).map((row) => {
    const copy = { ...(row || {}) };
    delete copy.cache_key;
    return copy;
  });
}

export async function loadCacheSnapshot(symbol) {
  const db = await openDb();
  if (!db) {
    return { bars: [], depth: [], trades: [], depthEvents: [] };
  }

  const [bars, depth, trades, depthEvents] = await Promise.all([
    getAllForSymbol(db, BARS_STORE, symbol),
    getAllForSymbol(db, DEPTH_STORE, symbol),
    getAllForSymbol(db, TRADES_STORE, symbol),
    getAllForSymbol(db, DEPTH_EVENTS_STORE, symbol),
  ]);

  const normalizedBars = stripCacheFields(bars).sort((a, b) => a.candle_open_time - b.candle_open_time);
  const normalizedDepth = stripCacheFields(depth).sort((a, b) => a.timestamp - b.timestamp);
  const normalizedTrades = stripCacheFields(trades);
  const normalizedDepthEvents = stripCacheFields(depthEvents).sort((a, b) => {
    const timestampDelta = (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0);
    if (timestampDelta !== 0) return timestampDelta;
    return (Number(a?.seq) || 0) - (Number(b?.seq) || 0);
  });
  sortTrades(normalizedTrades);

  return {
    bars: normalizedBars,
    depth: normalizedDepth,
    trades: normalizedTrades,
    depthEvents: normalizedDepthEvents,
  };
}

export async function replaceBars(items, maxCount, symbol) {
  const db = await openDb();
  if (!db) return;

  const normalizedSymbol = normalizeSymbol(symbol);
  const retained = (items || [])
    .slice(-maxCount)
    .map((item) => decorateRecord(BARS_STORE, item, normalizedSymbol))
    .filter(Boolean);

  const existing = await getAllForSymbol(db, BARS_STORE, normalizedSymbol);
  const transaction = db.transaction(BARS_STORE, "readwrite");
  const store = transaction.objectStore(BARS_STORE);
  existing.forEach((row) => store.delete(row.cache_key));
  retained.forEach((item) => store.put(item));
  await transactionDone(transaction);
}

export async function appendBar(item, maxCount, symbol) {
  const db = await openDb();
  const normalized = decorateRecord(BARS_STORE, item, symbol);
  if (!db || !normalized) return;

  const transaction = db.transaction(BARS_STORE, "readwrite");
  const store = transaction.objectStore(BARS_STORE);
  store.put(normalized);
  await trimStoreByCountForSymbol(store, normalized.symbol, maxCount, "candle_open_time");
  await transactionDone(transaction);
}

export async function replaceDepthSnapshots(items, maxCount, symbol) {
  const db = await openDb();
  if (!db) return;

  const normalizedSymbol = normalizeSymbol(symbol);
  const retained = (items || [])
    .slice(-maxCount)
    .map((item) => decorateRecord(DEPTH_STORE, item, normalizedSymbol))
    .filter(Boolean);

  const existing = await getAllForSymbol(db, DEPTH_STORE, normalizedSymbol);
  const transaction = db.transaction(DEPTH_STORE, "readwrite");
  const store = transaction.objectStore(DEPTH_STORE);
  existing.forEach((row) => store.delete(row.cache_key));
  retained.forEach((item) => store.put(item));
  await transactionDone(transaction);
}

export async function appendDepthSnapshot(item, maxCount, symbol) {
  const db = await openDb();
  const normalized = decorateRecord(DEPTH_STORE, item, symbol);
  if (!db || !normalized) return;

  const transaction = db.transaction(DEPTH_STORE, "readwrite");
  const store = transaction.objectStore(DEPTH_STORE);
  store.put(normalized);
  await trimStoreByCountForSymbol(store, normalized.symbol, maxCount, "timestamp");
  await transactionDone(transaction);
}

export async function appendTrades(items, maxCount, symbol) {
  const db = await openDb();
  if (!db || !Array.isArray(items) || items.length === 0) return;

  const normalizedItems = items
    .map((item) => decorateRecord(TRADES_STORE, item, symbol))
    .filter(Boolean);
  if (!normalizedItems.length) return;

  const transaction = db.transaction(TRADES_STORE, "readwrite");
  const store = transaction.objectStore(TRADES_STORE);
  normalizedItems.forEach((item) => store.put(item));
  await trimStoreByCountForSymbol(store, normalizedItems[0].symbol, maxCount, "timestamp");
  await transactionDone(transaction);
}

export async function appendDepthEvents(items, maxCount, symbol) {
  const db = await openDb();
  if (!db || !Array.isArray(items) || items.length === 0) return;

  const normalizedItems = items
    .map((item) => decorateRecord(DEPTH_EVENTS_STORE, item, symbol))
    .filter(Boolean);
  if (!normalizedItems.length) return;

  const transaction = db.transaction(DEPTH_EVENTS_STORE, "readwrite");
  const store = transaction.objectStore(DEPTH_EVENTS_STORE);
  normalizedItems.forEach((item) => store.put(item));
  await trimStoreByCountForSymbol(store, normalizedItems[0].symbol, maxCount, "timestamp");
  await transactionDone(transaction);
}
