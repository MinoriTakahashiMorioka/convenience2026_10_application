import { uid, toDateKey } from '../../models/schema.js';

/**
 * エンタメ記録帳のデータ。
 *
 * @typedef {Object} MediaItem
 * @property {string} id
 * @property {'book' | 'movie' | 'place' | 'other'} kind
 * @property {string} title          タイトル・場所の名前（必須）
 * @property {string} creator        本: 作者・著者 / その他: ジャンル
 * @property {string} where          映画: どこで観たか（映画館・配信など）
 * @property {string} area           場所: 住所・エリア
 * @property {string} date           読んだ・観た・行った日 'YYYY-MM-DD'（日記と同じ日付でつながる）
 * @property {number} rating         ☆ 0〜5（0 = つけない）
 * @property {string} review         感想
 * @property {string | null} photo   表紙・写真（小さくした JPEG の data URL）
 * @property {string} createdAt
 * @property {string} updatedAt
 */

export const KINDS = [
  { id: 'book', name: '本', unit: '冊', verb: '読んだ', icon: 'book', dateLabel: '読んだ日', photoLabel: '表紙の写真', titleLabel: 'タイトル', titlePlaceholder: '例: 星の王子さま' },
  { id: 'movie', name: '映画', unit: '本', verb: '観た', icon: 'film', dateLabel: '観た日', photoLabel: '映画の写真', titleLabel: 'タイトル', titlePlaceholder: '例: となりのトトロ' },
  { id: 'place', name: '場所', unit: 'か所', verb: '行った', icon: 'mapPin', dateLabel: '行った日', photoLabel: '写真', titleLabel: '場所の名前', titlePlaceholder: '例: 江の島' },
  { id: 'other', name: 'その他', unit: '件', verb: '楽しんだ', icon: 'sparkle', dateLabel: '日付', photoLabel: '写真', titleLabel: 'タイトル', titlePlaceholder: '例: ライブ、ドラマ、ゲーム' },
];
export const kindOf = (id) => KINDS.find((k) => k.id === id) ?? KINDS[3];

export const MOVIE_WHERE = ['映画館', '配信', 'テレビ', 'DVD・ブルーレイ'];
export const OTHER_GENRES = ['ドラマ', 'アニメ', '音楽', 'ライブ・舞台', 'ゲーム', 'マンガ', 'スポーツ観戦', 'イベント'];

export const TITLE_MAX = 60;
export const CREATOR_MAX = 40;
export const REVIEW_MAX = 1000;

const count = (s) => [...String(s ?? '')].length;
const text = (v, max) => String(v ?? '').trim().slice(0, max * 2);

/** @param {ReturnType<import('../../core/storage.js').createStore>} store */
export function createMediaRepo(store) {
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };

  /** @returns {MediaItem[]} */
  const read = () => { const v = store.get('items', []); return Array.isArray(v) ? v : []; };
  function write(items, previous) {
    if (!store.set('items', items)) {
      // 端末の容量がいっぱい（写真が多いとき）。元に戻して知らせる
      store.set('items', previous);
      throw new Error('端末の保存容量がいっぱいで保存できませんでした。写真を外すか、使わない記録を消してからもう一度お試しください。');
    }
    emit();
  }

  function check(input) {
    const kind = kindOf(input.kind).id;
    const title = text(input.title, TITLE_MAX);
    if (!title) throw Object.assign(new Error(`${kindOf(kind).titleLabel}を入力してください。`), { field: 'title' });
    if (count(title) > TITLE_MAX) throw Object.assign(new Error(`${TITLE_MAX}文字以内にしてください。`), { field: 'title' });
    const review = String(input.review ?? '');
    if (count(review) > REVIEW_MAX) throw Object.assign(new Error(`感想は${REVIEW_MAX}文字以内にしてください。`), { field: 'review' });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? input.date : toDateKey();
    const rating = Number.isInteger(input.rating) && input.rating >= 0 && input.rating <= 5 ? input.rating : 0;
    const photo = typeof input.photo === 'string' && input.photo.startsWith('data:image/') ? input.photo : null;
    return {
      kind,
      title,
      creator: text(input.creator, CREATOR_MAX),
      where: text(input.where, 20),
      area: text(input.area, CREATOR_MAX),
      date,
      rating,
      review: review.trim(),
      photo,
    };
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** 新しい日付順 */
    all() {
      return [...read()].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    },

    get(id) {
      return read().find((i) => i.id === id) ?? null;
    },

    on(date) {
      return this.all().filter((i) => i.date === date);
    },

    count() {
      return read().length;
    },

    add(input) {
      const items = read();
      const now = new Date().toISOString();
      const item = { id: uid(), ...check(input), createdAt: now, updatedAt: now };
      write([...items, item], items);
      return item;
    },

    update(id, input) {
      const items = read();
      const index = items.findIndex((i) => i.id === id);
      if (index < 0) throw new Error('記録が見つかりません。');
      const next = [...items];
      next[index] = { ...items[index], ...check({ ...items[index], ...input }), updatedAt: new Date().toISOString() };
      write(next, items);
      return next[index];
    },

    remove(id) {
      const items = read();
      write(items.filter((i) => i.id !== id), items);
    },

    restore(item) {
      const items = read();
      if (!items.some((i) => i.id === item.id)) write([...items, item], items);
    },

    pref(key, fallback) { return store.get(`pref.${key}`, fallback); },
    setPref(key, value) { store.set(`pref.${key}`, value); },
  };
}

/**
 * 写真を小さくして data URL にする（端末の保存容量を節約するため、長い辺を 520px に）
 * @param {File} file
 */
export async function shrinkPhoto(file, { maxSide = 520, quality = 0.74 } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('画像ファイルを選んでください。');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode().catch(() => { throw new Error('この画像は読み込めませんでした。別の画像を選んでください。'); });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
