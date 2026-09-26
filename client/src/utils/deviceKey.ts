// client/src/utils/deviceKey.ts
// A random AES-GCM key the extension creates once and keeps in its own
// IndexedDB as a *non-extractable* CryptoKey. It encrypts the saved NVIDIA key
// at rest so the key never sits in chrome.storage as plain text — without a
// passphrase. (It protects against casual reading of storage files; anyone in
// full control of the Windows account/Chrome profile can still recover it.)

const DB_NAME = "rbg-keys";
const STORE = "keys";
const KEY_ID = "device-aes-gcm";

type KeyProvider = () => Promise<CryptoKey>;

let override: KeyProvider | null = null;
let cached: Promise<CryptoKey> | null = null;

/** Tests (no IndexedDB in node) inject their own key. */
export function setDeviceKeyProviderForTests(provider: KeyProvider | null): void {
  override = provider;
  cached = null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function idbGet(db: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY_ID);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error ?? new Error("indexedDB read failed"));
  });
}

function idbPut(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB write failed"));
  });
}

async function loadOrCreate(): Promise<CryptoKey> {
  const db = await openDb();
  try {
    const existing = await idbGet(db);
    if (existing !== undefined) {
      return existing;
    }
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbPut(db, key);
    return key;
  } finally {
    db.close();
  }
}

/** The extension's device key (created on first use). */
export function getDeviceKey(): Promise<CryptoKey> {
  if (override !== null) {
    return override();
  }
  if (cached === null) {
    cached = loadOrCreate().catch((err: unknown) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}
