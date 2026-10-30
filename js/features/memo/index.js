import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { defineFeature } from '../../core/feature.js';
import { router } from '../../core/router.js';
import { showToast } from '../../core/toast.js';
import { createVault } from '../../core/vault.js';
import { openVaultSettings, renderVaultGate, withOpenVault } from '../../core/vault-ui.js';
import { createMemoRepo, openHiddenMemos } from './repo.js';
import { mountMemoEditor, mountMemoList } from './views.js';

/**
 * メモ
 *
 *   index.js  … 画面の切り替え、非表示リストの鍵（このファイル）
 *   repo.js   … メモのデータ（ふつう・非表示）、検索
 *   views.js  … 一覧と、1件を書く画面
 *   （パスワードと暗号化は core/vault.js、入口の画面は core/vault-ui.js。アルバムと共通）
 *
 * 画面のURL
 *   #/app/memo/list               一覧
 *   #/app/memo/new                新しいメモ（書き始めると edit/<ID> に変わる）
 *   #/app/memo/edit/<ID>          メモを書く・読む
 *   #/app/memo/hidden/list        非表示のメモ（パスワードが必要）
 *   #/app/memo/hidden/edit/<ID>
 */

function seedDemo(ctx, repo) {
  if (ctx.user.id !== 'demo' || ctx.store.get('demoSeeded', false)) return;
  ctx.store.set('demoSeeded', true);
  if (repo.count() > 0) return;
  const samples = [
    { title: '買い物リスト', body: '・牛乳\n・食パン\n・卵（10個）\n・洗剤\n・ノート（B5）', labels: ['買い物'], pinned: true },
    { title: '英語の小テスト 範囲', body: 'Unit 5〜6\n単語帳 p.40〜52\n不規則動詞の過去形をもう一回見る', labels: ['勉強'] },
    { title: '行きたいカフェ', body: '駅前の新しいカフェ。ホットサンドがおいしいらしい。土日は混むので平日の夕方がいい。', labels: ['おでかけ'] },
    { title: 'アイデア', body: '文化祭の出し物：\n・謎解き\n・写真展\n・手作りゲーム', labels: ['学校'] },
    { title: '', body: '明日 8:10 に駅で待ち合わせ', labels: [] },
  ];
  for (const m of [...samples].reverse()) repo.create(m);
}

const prefsOf = (store, scope) => ({
  get: (key, fallback) => store.get(`pref.${scope}.${key}`, fallback),
  set: (key, value) => store.set(`pref.${scope}.${key}`, value),
});


export default defineFeature({
  id: 'memo',
  title: 'メモ',
  subtitle: 'ラベルで整理・言葉で検索',
  icon: 'memo',
  color: '#C9851B',
  keywords: ['メモ', 'めも', 'ノート', 'note', '覚え書き', 'ラベル', '非表示'],

  summary(ctx) {
    const repo = createMemoRepo(ctx.store);
    seedDemo(ctx, repo);
    const all = repo.all();
    if (!all.length) return 'まだメモがありません';
    const latest = all.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    const name = latest.title.trim() || latest.body.trim().split('\n')[0];
    return `${all.length}件・最近: ${name.length > 14 ? `${name.slice(0, 14)}…` : name}`;
  },

  mount(root, ctx) {
    const repo = createMemoRepo(ctx.store);
    seedDemo(ctx, repo);
    const vault = createVault(ctx.user.id);

    const parts = (ctx.subpath || '').split('/');
    const hidden = parts[0] === 'hidden';
    const [view, id] = hidden ? parts.slice(1) : parts;
    const base = hidden ? 'hidden/' : '';
    if (!['list', 'new', 'edit'].includes(view) || (view === 'edit' && !id)) {
      queueMicrotask(() => ctx.go(`${base}list`, { replace: true }));
      return () => {};
    }

    const panel = h('div', { class: 'mm' });
    root.append(panel);

    // ---------- ふつうのメモ ----------
    if (!hidden) {
      ctx.toolbar?.append(h('button', { type: 'button', class: 'tool-btn', onClick: () => ctx.go('hidden/list') }, icon('lock'), h('span', { class: 'mm-tool-label' }, '非表示のメモ')));
      /** 非表示にする：鍵が閉じていれば、その場でパスワードを聞く */
      const move = (memo) => withOpenVault(vault, 'メモ', async () => {
        const hiddenRepo = await openHiddenMemos(ctx.store, vault);
        await hiddenRepo.insert(memo);
        await repo.remove(memo.id);
        vault.close();
        showToast(`「${memo.title.trim() || 'メモ'}」を非表示にしました`, { action: { label: '非表示のメモを見る', onClick: () => ctx.go('hidden/list') } });
      });
      if (view === 'list') {
        return mountMemoList(panel, { repo, hidden: false, base, go: ctx.go, prefs: prefsOf(ctx.store, 'list'), header: null });
      }
      return mountMemoEditor(panel, {
        repo, id: view === 'edit' ? id : null, hidden: false, base, back: ctx.back, move,
        onCreate: (memo) => router.rename(`/app/memo/edit/${memo.id}`),
      });
    }

    // ---------- 非表示のメモ（鍵が開いているときだけ） ----------
    // 非表示の画面どうしを移るあいだは鍵を閉じない（一覧 → 1件 で毎回パスワードを聞かないため）
    vault.hold();
    let cleanupView = null;
    const keepAlive = () => vault.touch();
    panel.addEventListener('pointerdown', keepAlive);
    panel.addEventListener('keydown', keepAlive);

    async function show() {
      cleanupView?.();
      cleanupView = null;
      panel.replaceChildren();
      if (!vault.isOpen()) {
        const gate = h('div', { class: 'vault-wrap' });
        panel.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm mm-back', onClick: () => ctx.go('list') }, icon('chevronLeft'), 'ふつうのメモへ'), gate);
        renderVaultGate(gate, { vault, what: 'メモ' });
        return;
      }
      panel.append(h('div', { class: 'mm-loading' }, h('span', { class: 'spinner' }), '開いています…'));
      let hiddenRepo;
      try {
        hiddenRepo = await openHiddenMemos(ctx.store, vault);
      } catch {
        panel.replaceChildren(h('p', { class: 'form-error' }, icon('alert'), '非表示のメモを開けませんでした。'));
        return;
      }
      panel.replaceChildren();
      const header = h('div', { class: 'mm-hidden-bar' },
        h('span', {}, icon('lock'), h('strong', {}, '非表示のメモ'), h('small', {}, '5分さわらないと鍵がかかります')),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => openVaultSettings({ vault }) }, 'パスワードを変える'),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => { vault.close(); ctx.go('list'); } }, icon('lock'), '鍵をかける'),
      );
      const move = async (memo) => {
        await repo.insert(memo);
        await hiddenRepo.remove(memo.id);
        showToast(`「${memo.title.trim() || 'メモ'}」を非表示からもどしました`);
        return true;
      };
      cleanupView = view === 'list'
        ? mountMemoList(panel, { repo: hiddenRepo, hidden: true, base, go: ctx.go, prefs: prefsOf(ctx.store, 'hidden'), header })
        : mountMemoEditor(panel, {
          repo: hiddenRepo, id: view === 'edit' ? id : null, hidden: true, base, back: ctx.back, move,
          onCreate: (memo) => router.rename(`/app/memo/hidden/edit/${memo.id}`),
        });
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
      panel.removeEventListener('pointerdown', keepAlive);
      vault.release();
    };
  },
});
