/**
 * 写真などの大きなデータの置き場（IndexedDB）。
 *
 * localStorage は 5MB ほどしか入らないので、アルバムの写真はこちらに保存します。
 * キーは「u:<ユーザーID>:<機能ID>:...」の形にして、ユーザーごとに分けます（バックアップ・削除もこの形で探す）。
 *
 * 値は { type: 'image/jpeg', data: ArrayBuffer, iv?: string } の形。
 * iv があるものは暗号化済み（非表示のアルバムの写真）。
 *
 * IndexedDB が使えない環境（古いブラウザのプライベートモードなど）では、
 * メモリに一時保存します（タブを閉じると消える）。
 */

const DB_NAME = 'benri-app';
const STORE = 'blobs';
let dbPromise = null;
const memory = new Map();
let usingMemory = false;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { usingMemory = true; resolve(null); };
      req.onblocked = () => { usingMemory = true; resolve(null); };
    } catch {
      usingMemory = true;
      resolve(null);
    }
  });
  // 端末の空き容量が少ないときでも、なるべく消されないようにお願いする
  try { navigator.storage?.persist?.(); } catch { /* 対応していなければ何もしない */ }
  return dbPromise;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    if (!db) { resolve(fn(null)); return; }
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req && 'onsuccess' in req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('保存に失敗しました。'));
    tx.onabort = () => reject(tx.error?.name === 'QuotaExceededError'
      ? new Error('端末の保存容量がいっぱいです。使わない写真を消してからもう一度お試しください。')
      : (tx.error ?? new Error('保存に失敗しました。')));
  }));
}

const range = (prefix) => IDBKeyRange.bound(prefix, `${prefix}￿`);

export const blobStore = {
  /** IndexedDB が使えず、メモリに一時保存しているか */
  get isTemporary() { return usingMemory; },

  async put(key, value) {
    await run('readwrite', (s) => (s ? s.put(value, key) : memory.set(key, value)));
  },

  async get(key) {
    const db = await open();
    if (!db) return memory.get(key) ?? null;
    return (await run('readonly', (s) => s.get(key))) ?? null;
  },

  async delete(key) {
    await run('readwrite', (s) => (s ? s.delete(key) : memory.delete(key)));
  },

  async deleteMany(keys) {
    if (!keys.length) return;
    await run('readwrite', (s) => {
      for (const k of keys) { if (s) s.delete(k); else memory.delete(k); }
      return null;
    });
  },

  /** prefix で始まるキーの一覧 */
  async keys(prefix) {
    const db = await open();
    if (!db) return [...memory.keys()].filter((k) => k.startsWith(prefix));
    return run('readonly', (s) => s.getAllKeys(range(prefix)));
  },

  /** prefix で始まるものを全部 { key: value } で */
  async entries(prefix) {
    const keys = await this.keys(prefix);
    const out = {};
    for (const k of keys) out[k] = await this.get(k);
    return out;
  },

  async deletePrefix(prefix) {
    const db = await open();
    if (!db) { for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k); return; }
    await run('readwrite', (s) => s.delete(range(prefix)));
  },

  /** 使っている容量のめやす（バイト）。分からなければ null */
  async estimate() {
    try {
      const e = await navigator.storage?.estimate?.();
      return e ? { usage: e.usage ?? null, quota: e.quota ?? null } : null;
    } catch { return null; }
  },
};

// ---------- バイト列 ⇔ Base64（バックアップ用） ----------

export function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
