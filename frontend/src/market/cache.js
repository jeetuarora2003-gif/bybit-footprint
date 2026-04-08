const DB_NAME = "exo-footprint-cache";
const DB_VERSION = 1;
const BARS_STORE = "bars";
const DEPTH_STORE = "depth";

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

export async function loadCacheSnapshot() {
  const db = await openDb();
  if (!db) {
    return { bars: [], depth: [] };
  }

  const [bars, depth] = await Promise.all([
    getAllFromStore(db, BARS_STORE),
    getAllFromStore(db, DEPTH_STORE),
  ]);

  bars.sort((a, b) => a.candle_open_time - b.candle_open_time);
  depth.sort((a, b) => a.timestamp - b.timestamp);
  return { bars, depth };
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
