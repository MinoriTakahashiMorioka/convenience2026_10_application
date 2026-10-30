import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { defineFeature } from '../../core/feature.js';
import { showToast } from '../../core/toast.js';
import { createVault } from '../../core/vault.js';
import { openVaultSettings, renderVaultGate, withOpenVault } from '../../core/vault-ui.js';
import { createAlbumRepo, openHiddenAlbums } from './repo.js';
import { mountAlbumDetail, mountAlbumList } from './views.js';

/**
 * アルバム
 *
 *   index.js  … 画面の切り替え、非表示リストの鍵（このファイル）
 *   repo.js   … アルバムと写真のデータ（写真は IndexedDB）、写真の縮小
 *   views.js  … 一覧・1冊の中身・写真を大きく見る画面
 *
 * 画面のURL
 *   #/app/album/list              一覧
 *   #/app/album/a/<ID>            1冊の中身
 *   #/app/album/hidden/list       非表示のアルバム（パスワードが必要。メモと同じパスワード）
 *   #/app/album/hidden/a/<ID>
 */

const prefsOf = (store, scope) => ({
  get: (key, fallback) => store.get(`pref.${scope}.${key}`, fallback),
  set: (key, value) => store.set(`pref.${scope}.${key}`, value),
});


export default defineFeature({
  id: 'album',
  title: 'アルバム',
  subtitle: '写真をラベルで整理',
  icon: 'album',
  color: '#D0517A',
  keywords: ['アルバム', '写真', 'しゃしん', 'フォト', 'photo', 'ラベル', '非表示'],

  summary(ctx) {
    const repo = createAlbumRepo(ctx.store, ctx.user.id);
    const n = repo.count();
    return n ? `${n}冊・写真${repo.photoCount()}枚` : 'まだアルバムがありません';
  },

  mount(root, ctx) {
    const repo = createAlbumRepo(ctx.store, ctx.user.id);
    const vault = createVault(ctx.user.id);

    const parts = (ctx.subpath || '').split('/');
    const hidden = parts[0] === 'hidden';
    const [view, id] = hidden ? parts.slice(1) : parts;
    const base = hidden ? 'hidden/' : '';
    if (!(view === 'list' || (view === 'a' && id))) {
      queueMicrotask(() => ctx.go(`${base}list`, { replace: true }));
      return () => {};
    }

    const panel = h('div', { class: 'al' });
    root.append(panel);

    // ---------- ふつうのアルバム ----------
    if (!hidden) {
      ctx.toolbar?.append(h('button', { type: 'button', class: 'tool-btn', onClick: () => ctx.go('hidden/list') }, icon('lock'), h('span', { class: 'mm-tool-label' }, '非表示のアルバム')));
      const move = (album, onProgress) => withOpenVault(vault, 'アルバム', async () => {
        const target = await openHiddenAlbums(ctx.store, ctx.user.id, vault);
        await target.adopt(album, (pid, kind) => repo.bytes(pid, kind), onProgress);
        await repo.detach(album.id);
        target.dispose();
        vault.close();
        showToast(`「${album.title}」を非表示にしました`, { action: { label: '非表示のアルバムを見る', onClick: () => ctx.go('hidden/list') } });
      });
      const cleanup = view === 'list'
        ? mountAlbumList(panel, { repo, hidden: false, base, go: ctx.go, prefs: prefsOf(ctx.store, 'list'), header: null })
        : mountAlbumDetail(panel, { repo, id, hidden: false, base, go: ctx.go, back: ctx.back, move });
      return () => { cleanup?.(); repo.dispose(); };
    }

    // ---------- 非表示のアルバム ----------
    // 非表示の画面どうしを移るあいだは鍵を閉じない（一覧 → 1件 で毎回パスワードを聞かないため）
    vault.hold();
    let cleanupView = null;
    let hiddenRepo = null;
    const keepAlive = () => vault.touch();
    panel.addEventListener('pointerdown', keepAlive);

    async function show() {
      cleanupView?.();
      cleanupView = null;
      hiddenRepo?.dispose();
      hiddenRepo = null;
      panel.replaceChildren();
      if (!vault.isOpen()) {
        const gate = h('div', { class: 'vault-wrap' });
        panel.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm mm-back', onClick: () => ctx.go('list') }, icon('chevronLeft'), 'ふつうのアルバムへ'), gate);
        renderVaultGate(gate, { vault, what: 'アルバム' });
        return;
      }
      panel.append(h('div', { class: 'mm-loading' }, h('span', { class: 'spinner' }), '開いています…'));
      try {
        hiddenRepo = await openHiddenAlbums(ctx.store, ctx.user.id, vault);
      } catch {
        panel.replaceChildren(h('p', { class: 'form-error' }, icon('alert'), '非表示のアルバムを開けませんでした。'));
        return;
      }
      panel.replaceChildren();
      const header = h('div', { class: 'mm-hidden-bar' },
        h('span', {}, icon('lock'), h('strong', {}, '非表示のアルバム'), h('small', {}, '5分さわらないと鍵がかかります')),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => openVaultSettings({ vault }) }, 'パスワードを変える'),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => { vault.close(); ctx.go('list'); } }, icon('lock'), '鍵をかける'),
      );
      const move = async (album, onProgress) => {
        await repo.adopt(album, (pid, kind) => hiddenRepo.bytes(pid, kind), onProgress);
        await hiddenRepo.detach(album.id);
        showToast(`「${album.title}」を非表示からもどしました`);
        return true;
      };
      cleanupView = view === 'list'
        ? mountAlbumList(panel, { repo: hiddenRepo, hidden: true, base, go: ctx.go, prefs: prefsOf(ctx.store, 'hidden'), header })
        : mountAlbumDetail(panel, { repo: hiddenRepo, id, hidden: true, base, go: ctx.go, back: ctx.back, move });
    }

    let wasOpen = vault.isOpen();
    const unsubscribe = vault.subscribe(() => {
      if (vault.isOpen() === wasOpen && vault.isSetUp()) return;
      wasOpen = vault.isOpen();
      show();
    });
    show();

    return () => {
      unsubscribe();
      cleanupView?.();
      hiddenRepo?.dispose();
      repo.dispose();
      vault.release();
    };
  },
});
