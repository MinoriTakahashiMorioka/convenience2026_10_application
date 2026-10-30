import { uid } from '../../models/schema.js';
import { LABELS_PER_ITEM, normalizeLabel } from '../../core/label-input.js';

/**
 * メモのデータ。
 *
 * @typedef {Object} Memo
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {string[]} labels
 * @property {boolean} pinned     一覧のいちばん上に固定
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * ふつうのメモは localStorage にそのまま、非表示のメモは暗号化して 'hidden' に保存します。
 * どちらも同じ操作（makeMemoList）で扱えるようにしています。
 */

export const TITLE_MAX = 100;
export const BODY_MAX = 10000;

const chars = (s) => [...String(s ?? '')].length;

function clean(input) {
  const title = String(input.title ?? '').replace(/\n/g, ' ');
  const body = String(input.body ?? '');
  if (chars(title) > TITLE_MAX) throw new Error(`タイトルは${TITLE_MAX}文字以内にしてください。`);
  if (chars(body) > BODY_MAX) throw new Error(`本文は${BODY_MAX}文字以内にしてください。`);
  const labels = [...new Set((input.labels ?? []).map(normalizeLabel).filter(Boolean))].slice(0, LABELS_PER_ITEM);
  return { title, body, labels, pinned: !!input.pinned };
}

export const isBlank = (m) => !m.title.trim() && !m.body.trim();

/**
 * @param {{ read: () => Memo[], write: (memos: Memo[]) => (void | Promise<void>) }} io
 */
export function makeMemoList(io) {
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const save = async (memos) => { await io.write(memos); emit(); };

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** ピン留め → 更新が新しい順 */
    all() {
      return [...io.read()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    },
    get(id) { return io.read().find((m) => m.id === id) ?? null; },
    count() { return io.read().length; },

    async create(input) {
      const now = new Date().toISOString();
      const memo = { id: uid(), ...clean(input), createdAt: now, updatedAt: now };
      await save([...io.read(), memo]);
      return memo;
    },

    async update(id, input, { touch = true } = {}) {
      const memos = io.read().map((m) => (m.id === id ? { ...m, ...clean({ ...m, ...input }), updatedAt: touch ? new Date().toISOString() : m.updatedAt } : m));
      await save(memos);
      return memos.find((m) => m.id === id) ?? null;
    },

    async remove(id) {
      const memo = this.get(id);
      await save(io.read().filter((m) => m.id !== id));
      return memo;
    },

    /** 別のリストから移す・元に戻す（id・日時はそのまま） */
    async insert(memo) {
      if (io.read().some((m) => m.id === memo.id)) return;
      await save([...io.read(), memo]);
    },

    /** 使っているラベル（多い順）と件数 */
    labels() {
      const counts = {};
      for (const m of io.read()) for (const l of m.labels) counts[l] = (counts[l] ?? 0) + 1;
      return { names: Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'ja')), counts };
    },

    /** ラベルの名前を変える・消す（name が null なら消す） */
    async renameLabel(from, to) {
      const memos = io.read().map((m) => {
        if (!m.labels.includes(from)) return m;
        const labels = to ? [...new Set(m.labels.map((l) => (l === from ? to : l)))] : m.labels.filter((l) => l !== from);
        return { ...m, labels };
      });
      await save(memos);
    },
  };
}

/** ふつうのメモ */
export function createMemoRepo(store) {
  return makeMemoList({
    read: () => { const v = store.get('memos', []); return Array.isArray(v) ? v : []; },
    write: (memos) => {
      if (!store.set('memos', memos)) throw new Error('端末の保存容量がいっぱいで保存できませんでした。');
    },
  });
}

/**
 * 非表示のメモ（vault が開いているときだけ使える）
 * 開いたときに復号してメモリに置き、変えるたびに暗号化して保存します。
 */
export async function openHiddenMemos(store, vault) {
  let cache = (await vault.decryptJSON(store.get('hidden', null))) ?? [];
  let queue = Promise.resolve();
  return makeMemoList({
    read: () => cache,
    write: (memos) => {
      cache = memos;
      // 保存は順番に（速く続けて書いても、最後の内容が残るように）
      queue = queue.catch(() => {}).then(async () => {
        const box = await vault.encryptJSON(cache);
        if (!store.set('hidden', box)) throw new Error('端末の保存容量がいっぱいで保存できませんでした。');
      });
      return queue;
    },
  });
}

/** 検索：空白で区切った言葉が、すべてタイトルか本文に入っているもの */
export function searchWords(q) {
  return String(q ?? '').normalize('NFKC').toLowerCase().split(/[\s　]+/).filter(Boolean);
}
export function matches(memo, words) {
  if (!words.length) return true;
  const text = `${memo.title}\n${memo.body}`.normalize('NFKC').toLowerCase();
  return words.every((w) => text.includes(w));
}
