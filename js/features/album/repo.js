import { uid } from '../../models/schema.js';
import { blobStore } from '../../core/blob-store.js';
import { LABELS_PER_ITEM, normalizeLabel } from '../../core/label-input.js';

/**
 * アルバムのデータ。
 *
 * @typedef {Object} Photo
 * @property {string} id
 * @property {number} w  @property {number} h   大きさ（縮小後）
 * @property {string} addedAt
 * @property {string} [name]   元のファイル名
 *
 * @typedef {Object} Album
 * @property {string} id
 * @property {string} title
 * @property {string} note        説明
 * @property {string[]} labels
 * @property {string | null} coverId   表紙にする写真（なければ最初の写真）
 * @property {Photo[]} photos
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * アルバムの情報（題名・ラベル・写真の一覧）は localStorage、
 * 写真そのものは IndexedDB（core/blob-store.js）に保存します。
 *   u:<ID>:album:p:<写真ID>    大きい写真      u:<ID>:album:t:<写真ID>    小さい写真（一覧用）
 *   u:<ID>:album:h:p:<写真ID>  非表示（暗号化） u:<ID>:album:h:t:<写真ID>
 */

export const TITLE_MAX = 40;
export const NOTE_MAX = 300;
export const PHOTOS_PER_ADD = 50;

const chars = (s) => [...String(s ?? '')].length;

function clean(input) {
  const title = String(input.title ?? '').trim();
  if (!title) throw Object.assign(new Error('アルバムの名前を入力してください。'), { field: 'title' });
  if (chars(title) > TITLE_MAX) throw Object.assign(new Error(`名前は${TITLE_MAX}文字以内にしてください。`), { field: 'title' });
  const note = String(input.note ?? '').trim();
  if (chars(note) > NOTE_MAX) throw Object.assign(new Error(`説明は${NOTE_MAX}文字以内にしてください。`), { field: 'note' });
  const labels = [...new Set((input.labels ?? []).map(normalizeLabel).filter(Boolean))].slice(0, LABELS_PER_ITEM);
  return { title, note, labels };
}

/** 写真を縮小して JPEG のバイト列にする */
async function shrink(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hh = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hh;
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, hh);
    c.drawImage(img, 0, 0, w, hh);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('写真を変換できませんでした。');
    return { w, h: hh, data: await blob.arrayBuffer() };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {Object} io
 * @param {() => Album[]} io.read
 * @param {(albums: Album[]) => (void|Promise<void>)} io.write
 * @param {string} io.blobPrefix         'u:<ID>:album:' または 'u:<ID>:album:h:'
 * @param {(buf: ArrayBuffer) => Promise<object>} io.pack     保存する形にする（非表示なら暗号化）
 * @param {(rec: object) => Promise<ArrayBuffer>} io.unpack   取り出す（非表示なら復号）
 */
export function makeAlbumList(io) {
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const save = async (albums) => { await io.write(albums); emit(); };
  const urls = new Map(); // 写真ID:種類 → object URL（同じ写真を何度も読み込まない）
  const key = (photoId, kind) => `${io.blobPrefix}${kind}:${photoId}`;

  const api = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    all() { return [...io.read()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    get(id) { return io.read().find((a) => a.id === id) ?? null; },
    count() { return io.read().length; },
    photoCount() { return io.read().reduce((n, a) => n + a.photos.length, 0); },

    async create(input) {
      const now = new Date().toISOString();
      const album = { id: uid(), ...clean(input), coverId: null, photos: [], createdAt: now, updatedAt: now };
      await save([...io.read(), album]);
      return album;
    },

    async update(id, input) {
      const albums = io.read().map((a) => (a.id === id ? { ...a, ...clean({ ...a, ...input }), updatedAt: new Date().toISOString() } : a));
      await save(albums);
      return albums.find((a) => a.id === id);
    },

    /** アルバムごと消す（写真も消える） */
    async remove(id) {
      const album = api.get(id);
      if (!album) return;
      await save(io.read().filter((a) => a.id !== id));
      await blobStore.deleteMany(album.photos.flatMap((p) => [key(p.id, 'p'), key(p.id, 't')]));
      api.forget(album.photos.map((p) => p.id));
    },

    /**
     * 写真を足す
     * @param {File[]} files
     * @param {(done: number, total: number) => void} [onProgress]
     * @returns {Promise<{ added: number, failed: number }>}
     */
    async addPhotos(albumId, files, onProgress) {
      const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(f.name)).slice(0, PHOTOS_PER_ADD);
      const added = [];
      let failed = 0;
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        try {
          const big = await shrink(file, 1920, 0.85);
          const small = await shrink(file, 420, 0.75);
          const id = uid();
          await blobStore.put(key(id, 'p'), await io.pack(big.data));
          await blobStore.put(key(id, 't'), await io.pack(small.data));
          added.push({ id, w: big.w, h: big.h, addedAt: new Date().toISOString(), name: file.name.slice(0, 80) });
        } catch (err) {
          if (/容量/.test(err?.message ?? '')) { failed += list.length - i; break; }
          failed++;
        }
        onProgress?.(i + 1, list.length);
      }
      if (added.length) {
        const albums = io.read().map((a) => (a.id === albumId ? { ...a, photos: [...a.photos, ...added], updatedAt: new Date().toISOString() } : a));
        await save(albums);
      }
      return { added: added.length, failed, skipped: Math.max(0, files.length - list.length - failed) };
    },

    async removePhotos(albumId, photoIds) {
      const set = new Set(photoIds);
      const albums = io.read().map((a) => (a.id !== albumId ? a : {
        ...a,
        photos: a.photos.filter((p) => !set.has(p.id)),
        coverId: set.has(a.coverId) ? null : a.coverId,
        updatedAt: new Date().toISOString(),
      }));
      await save(albums);
      await blobStore.deleteMany(photoIds.flatMap((id) => [key(id, 'p'), key(id, 't')]));
      api.forget(photoIds);
    },

    async setCover(albumId, photoId) {
      await save(io.read().map((a) => (a.id === albumId ? { ...a, coverId: photoId } : a)));
    },

    coverOf(album) {
      return album.photos.find((p) => p.id === album.coverId) ?? album.photos[0] ?? null;
    },

    /** 写真を表示する URL（kind: 'p' 大きい / 't' 小さい）。なければ null */
    async url(photoId, kind = 't') {
      const k = `${photoId}:${kind}`;
      if (urls.has(k)) return urls.get(k);
      const rec = await blobStore.get(key(photoId, kind));
      if (!rec) return null;
      const buf = await io.unpack(rec);
      const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      urls.set(k, url);
      return url;
    },

    /** 写真のバイト列（ほかのリストへ移すとき・保存するとき） */
    async bytes(photoId, kind) {
      const rec = await blobStore.get(key(photoId, kind));
      return rec ? io.unpack(rec) : null;
    },

    /** 別のリストから写真ごと移す（非表示にする / やめる） */
    async adopt(album, readBytes, onProgress) {
      let i = 0;
      for (const p of album.photos) {
        for (const kind of ['p', 't']) {
          const buf = await readBytes(p.id, kind);
          if (buf) await blobStore.put(key(p.id, kind), await io.pack(buf));
        }
        onProgress?.(++i, album.photos.length);
      }
      await save([...io.read().filter((a) => a.id !== album.id), album]);
    },

    /** 写真のデータは残したまま、一覧からだけ外す（移したあと元の方を片付ける） */
    async detach(albumId) {
      const album = api.get(albumId);
      await save(io.read().filter((a) => a.id !== albumId));
      if (album) {
        await blobStore.deleteMany(album.photos.flatMap((p) => [key(p.id, 'p'), key(p.id, 't')]));
        api.forget(album.photos.map((p) => p.id));
      }
    },

    forget(photoIds) {
      for (const id of photoIds) for (const kind of ['p', 't']) {
        const k = `${id}:${kind}`;
        if (urls.has(k)) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
      }
    },

    /** 画面を離れるとき、作った URL を片付ける */
    dispose() {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },

    labels() {
      const counts = {};
      for (const a of io.read()) for (const l of a.labels) counts[l] = (counts[l] ?? 0) + 1;
      return { names: Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'ja')), counts };
    },

    async renameLabel(from, to) {
      await save(io.read().map((a) => {
        if (!a.labels.includes(from)) return a;
        return { ...a, labels: to ? [...new Set(a.labels.map((l) => (l === from ? to : l)))] : a.labels.filter((l) => l !== from) };
      }));
    },
  };
  return api;
}

/** ふつうのアルバム */
export function createAlbumRepo(store, userId) {
  return makeAlbumList({
    read: () => { const v = store.get('albums', []); return Array.isArray(v) ? v : []; },
    write: (albums) => { if (!store.set('albums', albums)) throw new Error('端末の保存容量がいっぱいで保存できませんでした。'); },
    blobPrefix: `u:${userId}:album:`,
    pack: async (data) => ({ type: 'image/jpeg', data }),
    unpack: async (rec) => rec.data,
  });
}

/** 非表示のアルバム（vault が開いているときだけ） */
export async function openHiddenAlbums(store, userId, vault) {
  let cache = (await vault.decryptJSON(store.get('hidden', null))) ?? [];
  let queue = Promise.resolve();
  return makeAlbumList({
    read: () => cache,
    write: (albums) => {
      cache = albums;
      queue = queue.catch(() => {}).then(async () => {
        if (!store.set('hidden', await vault.encryptJSON(cache))) throw new Error('端末の保存容量がいっぱいで保存できませんでした。');
      });
      return queue;
    },
    blobPrefix: `u:${userId}:album:h:`,
    pack: async (data) => { const r = await vault.encryptBytes(data); return { type: 'image/jpeg', iv: r.iv, data: r.data }; },
    unpack: async (rec) => vault.decryptBytes(rec.iv, rec.data),
  });
}

/** 検索：空白で区切った言葉が、すべてタイトルか説明に入っているもの */
export function matchesAlbum(album, words) {
  if (!words.length) return true;
  const text = `${album.title}\n${album.note}`.normalize('NFKC').toLowerCase();
  return words.every((w) => text.includes(w));
}
