import { forgetMemory } from './storage.js';
import { blobStore, bytesToBase64, base64ToBytes } from './blob-store.js';

/**
 * データのバックアップ（書き出し・読み込み）と削除。
 * そのユーザーのデータ（benri:v1:u:<ID>:...）だけを扱います。
 * アルバムの写真（IndexedDB の u:<ID>:...）もいっしょに書き出し・読み込み・削除します。
 */

const PREFIX = 'benri:v1:';
const FORMAT = 'benri-backup';

const userPrefix = (userId) => `${PREFIX}u:${userId}:`;

function storage() {
  try { return window.localStorage; } catch { return null; }
}

/** そのユーザーの保存キーの一覧 */
function userKeys(userId) {
  const ls = storage();
  if (!ls) return [];
  const prefix = userPrefix(userId);
  const keys = [];
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/** バックアップ用のデータを作る */
export function collectUserData(userId) {
  const ls = storage();
  const prefix = userPrefix(userId);
  const data = {};
  for (const key of userKeys(userId)) {
    try { data[key.slice(prefix.length)] = JSON.parse(ls.getItem(key)); } catch { /* 壊れた値は飛ばす */ }
  }
  return { format: FORMAT, version: 1, app: '総合便利アプリ', exportedAt: new Date().toISOString(), userId, data };
}

/** 写真など（IndexedDB）を Base64 にして集める */
async function collectBlobs(userId) {
  const prefix = `u:${userId}:`;
  const out = {};
  const entries = await blobStore.entries(prefix);
  for (const [key, rec] of Object.entries(entries)) {
    if (!rec?.data) continue;
    out[key.slice(prefix.length)] = { type: rec.type ?? 'image/jpeg', iv: rec.iv ?? null, data: bytesToBase64(rec.data) };
  }
  return out;
}

/** JSON ファイルとしてダウンロードする（写真も入る） */
export async function downloadBackup(userId) {
  const backup = { ...collectUserData(userId), version: 2, blobs: await collectBlobs(userId) };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `benri-backup-${userId}-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return Object.keys(backup.data).length + Object.keys(backup.blobs).length;
}

/**
 * 選んだファイルを読み込んで中身を確かめる
 * @returns {Promise<{ exportedAt: string, userId: string, data: Record<string, unknown>, count: number }>}
 */
export async function readBackupFile(file) {
  if (!file) throw new Error('ファイルを選んでください。');
  if (file.size > 1024 * 1024 * 1024) throw new Error('ファイルが大きすぎます。');
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('バックアップのファイル（.json）ではないようです。'); }
  if (parsed?.format !== FORMAT || typeof parsed.data !== 'object' || parsed.data === null) {
    throw new Error('このアプリのバックアップではないようです。');
  }
  const blobs = parsed.blobs && typeof parsed.blobs === 'object' ? parsed.blobs : {};
  return { exportedAt: parsed.exportedAt, userId: parsed.userId, data: parsed.data, blobs, count: Object.keys(parsed.data).length + Object.keys(blobs).length };
}

/** 今のデータを消して、バックアップの中身で置き換える（写真も） */
export async function restoreUserData(userId, backup) {
  const ls = storage();
  if (!ls) throw new Error('この環境ではデータを保存できません。');
  const prefix = userPrefix(userId);
  const previous = collectUserData(userId).data;

  deleteUserData(userId);
  try {
    for (const [key, value] of Object.entries(backup.data)) {
      if (typeof key !== 'string' || key.includes('\n')) continue;
      ls.setItem(prefix + key, JSON.stringify(value));
    }
  } catch {
    // 容量オーバーなどで失敗したら、元のデータに戻す
    deleteUserData(userId);
    for (const [key, value] of Object.entries(previous)) {
      try { ls.setItem(prefix + key, JSON.stringify(value)); } catch { /* 戻せないものは諦める */ }
    }
    throw new Error('容量が足りず、読み込めませんでした。元のデータはそのままです。');
  }
  forgetMemory(`u:${userId}:`);
  // 写真：古いものを消して入れなおす
  await blobStore.deletePrefix(`u:${userId}:`);
  for (const [key, rec] of Object.entries(backup.blobs ?? {})) {
    if (typeof rec?.data !== 'string') continue;
    await blobStore.put(`u:${userId}:${key}`, { type: rec.type ?? 'image/jpeg', ...(rec.iv ? { iv: rec.iv } : {}), data: base64ToBytes(rec.data) });
  }
}

/** そのユーザーのデータをすべて消す（写真も） */
export async function deleteUserData(userId) {
  const ls = storage();
  for (const key of userKeys(userId)) {
    try { ls.removeItem(key); } catch { /* 消せないものは飛ばす */ }
  }
  forgetMemory(`u:${userId}:`);
  try { await blobStore.deletePrefix(`u:${userId}:`); } catch { /* 写真が消せなくても続ける */ }
}
