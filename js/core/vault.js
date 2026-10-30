import { createStore } from './storage.js';
import { blobStore, bytesToBase64, base64ToBytes } from './blob-store.js';

/**
 * 非表示リストのパスワードと暗号化（メモ・アルバムで共通）。
 *
 * しくみ
 *  - パスワードは保存しない。パスワードから PBKDF2（20万回）で「鍵を包む鍵」を作り、
 *    ランダムな「データの鍵」（AES-GCM 256bit）を包んで保存する
 *  - 非表示のメモ・アルバム・写真は「データの鍵」で暗号化して保存する
 *    → 端末の保存データを直接のぞかれても、パスワードがなければ読めない
 *  - パスワードを変えても「データの鍵」を包み直すだけなので、中身の暗号化はやり直さない
 *  - 開いているあいだだけ鍵をメモリに置き、「鍵をかける」・5分さわらない・非表示リストの画面を離れると忘れる
 *    （写真を選ぶ画面に切り替わっても閉じないよう、アプリの切り替えでは閉じない）
 *
 * パスワードの決まり（どちらか）
 *  - 数字 4〜8桁
 *  - 英字と数字をどちらも使った 10〜20文字
 *
 * ⚠️ 数字4桁は、のぞき見防止にはなりますが、データを持ち出されて総当たりされると破られます。
 *    大事なものは「英字と数字」がおすすめです（画面でもそう案内しています）。
 */

export const KINDS = {
  pin: { name: '数字（4〜8桁）', test: (v) => /^\d{4,8}$/.test(v), hint: '数字だけで4〜8桁', inputmode: 'numeric' },
  text: { name: '英字と数字（10〜20文字）', test: (v) => /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{10,20}$/.test(v), hint: '英字と数字をどちらも使って10〜20文字（記号・全角は使えません）', inputmode: 'text' },
};

/** パスワードの形が正しくなければエラー文、正しければ null */
export function checkPassword(kind, value) {
  const k = KINDS[kind];
  if (!k) return '種類を選んでください。';
  if (!value) return 'パスワードを入力してください。';
  if (kind === 'pin') {
    if (!/^\d+$/.test(value)) return '数字だけで入力してください。';
    if (value.length < 4 || value.length > 8) return '4〜8桁にしてください。';
  } else {
    if (/[^A-Za-z\d]/.test(value)) return '半角の英字と数字だけで入力してください。';
    if (value.length < 10 || value.length > 20) return '10〜20文字にしてください。';
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return '英字と数字をどちらも使ってください。';
  }
  return null;
}

const ITERATIONS = 200_000;
const MAX_TRIES = 5;
const WAIT_MS = 30_000;
const IDLE_MS = 5 * 60_000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('この環境では暗号化が使えません（https で開いてください）。');
  return s;
};

async function wrappingKey(password, saltB64, iterations) {
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function aesEncrypt(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: bytesToBase64(iv), data };
}

async function aesDecrypt(key, iv, data) {
  return subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, data);
}

// ユーザーごとに、開いているあいだの鍵を覚えておく
const openKeys = new Map();   // userId → CryptoKey
const listeners = new Set();
let idleTimer = null;
let releaseTimer = null;

function emit(userId) { for (const fn of [...listeners]) fn(userId); }

function touch(userId) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (openKeys.delete(userId)) emit(userId); }, IDLE_MS);
}


/** @param {string} userId */
export function createVault(userId) {
  const store = createStore(`u:${userId}:vault`);
  const info = () => store.get('info', null);

  async function unwrap(password) {
    const v = info();
    const kek = await wrappingKey(password, v.salt, v.iterations);
    const raw = await aesDecrypt(kek, v.wrapped.iv, base64ToBytes(v.wrapped.data)); // 違うパスワードならここで失敗
    return subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function wrap(password, kind, rawKey) {
    const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    const kek = await wrappingKey(password, salt, ITERATIONS);
    const w = await aesEncrypt(kek, rawKey);
    return { kind, salt, iterations: ITERATIONS, wrapped: { iv: w.iv, data: bytesToBase64(w.data) }, updatedAt: new Date().toISOString() };
  }

  function key() {
    const k = openKeys.get(userId);
    if (!k) throw new Error('鍵がかかっています。もう一度パスワードを入力してください。');
    touch(userId);
    return k;
  }

  return {
    /** 鍵の状態が変わったら呼ばれる（開いた・閉じた・リセット） */
    subscribe(fn) {
      const wrapped = (id) => { if (id === userId) fn(); };
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },

    isSetUp() { return !!info(); },
    kind() { return info()?.kind ?? null; },
    isOpen() { return openKeys.has(userId); },

    /** 非表示の画面に入った（直前の release による「閉じる予約」を取り消す） */
    hold() { clearTimeout(releaseTimer); },

    /** 非表示の画面を出た。別の非表示の画面にすぐ移らなければ鍵をかける */
    release() {
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => { if (openKeys.delete(userId)) emit(userId); }, 400);
    },

    /** 操作があったことを知らせる（5分さわらないと鍵がかかるタイマーを延ばす） */
    touch() { if (openKeys.has(userId)) touch(userId); },

    /** 間違いが続いたとき、あと何秒待つか（0 なら待たなくてよい） */
    waitSeconds() {
      const until = store.get('lockedUntil', 0);
      return Math.max(0, Math.ceil((until - Date.now()) / 1000));
    },

    /** はじめてパスワードを決める */
    async setup(kind, password) {
      const error = checkPassword(kind, password);
      if (error) throw new Error(error);
      if (info()) throw new Error('パスワードはもう決まっています。');
      const raw = crypto.getRandomValues(new Uint8Array(32));
      store.set('info', await wrap(password, kind, raw));
      openKeys.set(userId, await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
      touch(userId);
      emit(userId);
    },

    async open(password) {
      if (!info()) throw new Error('まだパスワードが決まっていません。');
      const wait = this.waitSeconds();
      if (wait) throw new Error(`間違いが続いたので、${wait}秒待ってからもう一度お試しください。`);
      try {
        openKeys.set(userId, await unwrap(password));
      } catch (err) {
        if (err?.message?.includes('https')) throw err;
        const tries = store.get('failures', 0) + 1;
        if (tries >= MAX_TRIES) {
          store.set('failures', 0);
          store.set('lockedUntil', Date.now() + WAIT_MS);
          throw new Error(`パスワードが違います。${MAX_TRIES}回続けて間違えたので、30秒待ってください。`);
        }
        store.set('failures', tries);
        throw new Error(`パスワードが違います（あと${MAX_TRIES - tries}回で30秒待ちになります）。`);
      }
      store.set('failures', 0);
      touch(userId);
      emit(userId);
    },

    close() {
      if (openKeys.delete(userId)) emit(userId);
    },

    /** パスワードを変える（今のパスワードが必要） */
    async change(oldPassword, kind, newPassword) {
      const error = checkPassword(kind, newPassword);
      if (error) throw new Error(error);
      let dataKey;
      const v = info();
      try {
        const kek = await wrappingKey(oldPassword, v.salt, v.iterations);
        dataKey = await aesDecrypt(kek, v.wrapped.iv, base64ToBytes(v.wrapped.data));
      } catch {
        throw new Error('今のパスワードが違います。');
      }
      store.set('info', await wrap(newPassword, kind, dataKey));
    },

    /**
     * パスワードを忘れたとき：非表示のデータをすべて消して、最初からやり直す
     * （暗号化しているので、パスワードなしで中身を取り出す方法はありません）
     */
    async reset() {
      store.remove('info');
      store.remove('failures');
      store.remove('lockedUntil');
      openKeys.delete(userId);
      for (const feature of ['memo', 'album']) createStore(`u:${userId}:${feature}`).remove('hidden');
      await blobStore.deletePrefix(`u:${userId}:album:h:`);
      emit(userId);
    },

    // ---------- 暗号化・復号 ----------

    async encryptJSON(value) {
      const r = await aesEncrypt(key(), enc.encode(JSON.stringify(value)));
      return { iv: r.iv, data: bytesToBase64(r.data) };
    },

    async decryptJSON(box) {
      if (!box) return null;
      const bytes = await aesDecrypt(key(), box.iv, base64ToBytes(box.data));
      return JSON.parse(dec.decode(bytes));
    },

    /** 写真など（ArrayBuffer のまま） */
    async encryptBytes(buffer) {
      return aesEncrypt(key(), buffer);
    },

    async decryptBytes(iv, data) {
      return aesDecrypt(key(), iv, data);
    },
  };
}
