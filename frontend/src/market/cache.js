const DB_NAME = "exo-footprint-cache";
const DB_VERSION = 2;
const BARS_STORE = "bars";
const DEPTH_STORE = "depth";
const TRADES_STORE = "trades";

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
        if (!db.objectStoreNames.contains(BARS_STORE)) {
          db.createObjectStore(BARS_STORE, { keyPath: "candle_open_time" });
        }
        if (!db.objectStoreNames.contains(DEPTH_STORE)) {
          db.createObjectStore(DEPTH_STORE, { keyPath: "timestamp" });
        }
        if (!db.objectStoreNames.contains(TRADES_STORE)) {
          db.createObjectStore(TRADES_STORE, { keyPath: "event_id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return openPromise;
}

async function trimStoreByCount(store, maxCount) {
  const total = await requestToPromise(store.count());
  let overflow = total - maxCount;
  if (overflow <= 0) return;

  await new Promise((resolve, reject) => {
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || overflow <= 0) {
        resolve();
        return;
      }
      cursor.delete();
      overflow -= 1;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

async function getAllFromStore(db, storeName) {
  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const rows = await requestToPromise(store.getAll());
  await transactionDone(transaction);
  return rows || [];
}

function sortTrades(trades) {
  return (trades || []).sort((a, b) => {
    const timestampDelta = (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0);
    if (timestampDelta !== 0) return timestampDelta;
    return (Number(a?.seq) || 0) - (Number(b?.seq) || 0);
  });
}

export async function loadCacheSnapshot() {
  const db = await openDb();
  if (!db) {
    return { bars: [], depth: [], trades: [] };
  }

  const [bars, depth, trades] = await Promise.all([
    getAllFromStore(db, BARS_STORE),
    getAllFromStore(db, DEPTH_STORE),
    getAllFromStore(db, TRADES_STORE),
  ]);

  bars.sort((a, b) => a.candle_open_time - b.candle_open_time);
  depth.sort((a, b) => a.timestamp - b.timestamp);
  sortTrades(trades);
  return { bars, depth, trades };
}

export async function replaceBars(items, maxCount) {
  const db = await openDb();
  if (!db) return;

  const retained = (items || []).slice(-maxCount);
  const transaction = db.transaction(BARS_STORE, "readwrite");
  const store = transaction.objectStore(BARS_STORE);
  store.clear();
  for (const item of retained) {
    store.put(item);
  }
  await transactionDone(transaction);
}

export async function appendBar(item, maxCount) {
  const db = await openDb();
  if (!db || !item?.candle_open_time) return;

  const transaction = db.transaction(BARS_STORE, "readwrite");
  const store = transaction.objectStore(BARS_STORE);
  store.put(item);
  await trimStoreByCount(store, maxCount);
  await transactionDone(transaction);
}

export async function replaceDepthSnapshots(items, maxCount) {
  const db = await openDb();
  if (!db) return;

  const retained = (items || []).slice(-maxCount);
  const transaction = db.transaction(DEPTH_STORE, "readwrite");
  const store = transaction.objectStore(DEPTH_STORE);
  store.clear();
  for (const item of retained) {
    store.put(item);
  }
  await transactionDone(transaction);
}

export async function appendDepthSnapshot(item, maxCount) {
  const db = await openDb();
  if (!db || !item?.timestamp) return;

  const transaction = db.transaction(DEPTH_STORE, "readwrite");
  const store = transaction.objectStore(DEPTH_STORE);
  store.put(item);
  await trimStoreByCount(store, maxCount);
  await transactionDone(transaction);
}

export async function appendTrades(items, maxCount) {
  const db = await openDb();
  if (!db || !Array.isArray(items) || items.length === 0) return;

  const transaction = db.transaction(TRADES_STORE, "readwrite");
  const store = transaction.objectStore(TRADES_STORE);
  for (const item of items) {
    if (!item?.event_id) continue;
    store.put(item);
  }
  await trimStoreByCount(store, maxCount);
  await transactionDone(transaction);
}
