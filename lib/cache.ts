import type { Mistake } from "./analyzer";

const DB_NAME = "mistake-trainer";
const DB_VERSION = 1;
const STORE = "analyses";

type CacheEntry = {
  gameUrl: string;
  mistakes: Mistake[];
  analyzedAt: number;
  depth: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "gameUrl" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAnalysis(
  gameUrl: string,
  mistakes: Mistake[],
  depth: number
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const entry: CacheEntry = {
      gameUrl,
      mistakes,
      depth,
      analyzedAt: Date.now(),
    };
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function loadAnalysis(
  gameUrl: string
): Promise<CacheEntry | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(gameUrl);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as CacheEntry) || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function loadAnalysesForUrls(
  urls: string[]
): Promise<Map<string, CacheEntry>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const results = new Map<string, CacheEntry>();
    let pending = urls.length;
    if (pending === 0) {
      db.close();
      return resolve(results);
    }
    for (const url of urls) {
      const req = store.get(url);
      req.onsuccess = () => {
        if (req.result) results.set(url, req.result as CacheEntry);
        pending--;
        if (pending === 0) {
          db.close();
          resolve(results);
        }
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    }
  });
}

export async function clearCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}