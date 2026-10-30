import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { defineFeature } from '../../core/feature.js';
import { showToast } from '../../core/toast.js';
import { toDateKey } from '../../models/schema.js';
import { addDays } from '../diary/dates.js';
import { KINDS, createMediaRepo, kindOf } from './repo.js';
import { openMediaEditor } from './editor.js';
import { mountDetailView, mountListView } from './views.js';

/**
 * エンタメ記録帳（読んだ本・観た映画・行った場所などのレビュー）
 *
 *   index.js   … ハブ・カレンダー・日記に出す情報、画面の切り替え（このファイル）
 *   repo.js    … 記録のデータ、写真を小さくする処理
 *   parts.js   … ☆・表紙などの部品
 *   editor.js  … 記録する・直すシート
 *   views.js   … 一覧（本棚）と1件の詳しい表示
 *
 * 画面のURL
 *   #/app/media/list          すべて
 *   #/app/media/list/book     本だけ（movie / place / other）
 *   #/app/media/item/<ID>     1件の表示
 *
 * 日記とのつながり：記録の「日付」が日記の日付と同じなら、日記のページに出てきます（逆も同じ）。
 */

function seedDemo(ctx, repo) {
  if (ctx.user.id !== 'demo' || ctx.store.get('demoSeeded', false)) return;
  ctx.store.set('demoSeeded', true);
  if (repo.count() > 0) return;
  const today = toDateKey();
  const samples = [
    { kind: 'book', title: '星の王子さま', creator: 'サン＝テグジュペリ', date: addDays(today, -3), rating: 5, review: '「大切なものは目に見えない」という言葉が、子どものころに読んだときより深く響いた。キツネとの場面が一番好き。' },
    { kind: 'movie', title: 'となりのトトロ', where: '配信', date: addDays(today, -1), rating: 4, review: '何回観ても雨のバス停の場面がいい。音楽を聴くだけで夏休みの気分になる。' },
    { kind: 'place', title: '江の島', area: '神奈川県藤沢市', date: addDays(today, -10), rating: 4, review: '友だちと日帰りで。展望灯台からの景色がきれいだった。しらす丼がおいしい。次は夕方に行きたい。' },
    { kind: 'book', title: '走れメロス', creator: '太宰治', date: addDays(today, -15), rating: 3, review: '短いのに一気に読ませる勢いがある。' },
    { kind: 'other', title: '好きなバンドのライブ', creator: 'ライブ・舞台', date: addDays(today, -20), rating: 5, review: 'アンコールの曲で泣きそうになった。' },
  ];
  for (const s of samples) repo.add(s);
}

const snippet = (text, n = 40) => (text.length > n ? `${text.slice(0, n)}…` : text);

export default defineFeature({
  id: 'media',
  title: 'エンタメ記録帳',
  subtitle: '読んだ本・観た映画・行った場所',
  icon: 'sparkle',
  color: '#8A4FC4',
  keywords: ['エンタメ', '読書', '本', '映画', '旅行', 'おでかけ', 'レビュー', '感想', '記録帳', 'どくしょ', 'えいが'],

  summary(ctx) {
    const repo = createMediaRepo(ctx.store);
    seedDemo(ctx, repo);
    const year = toDateKey().slice(0, 4);
    const items = repo.all().filter((i) => i.date.startsWith(year));
    if (!repo.count()) return 'まだ記録がありません';
    const parts = KINDS.slice(0, 3).map((k) => `${k.name}${items.filter((i) => i.kind === k.id).length}${k.unit}`);
    return `今年 ${parts.join('・')}`;
  },

  dayInfo(ctx, date) {
    return createMediaRepo(ctx.store).on(date).map((item) => {
      const k = kindOf(item.kind);
      return {
        label: `${k.verb}${k.id === 'other' ? 'もの' : k.name}`,
        title: item.title,
        detail: [item.rating ? '★'.repeat(item.rating) : null, item.review ? snippet(item.review) : null].filter(Boolean).join(' '),
        href: `/app/media/item/${item.id}`,
        icon: k.icon,
        image: item.photo,
      };
    });
  },

  recordDates(ctx) {
    return new Set(createMediaRepo(ctx.store).all().map((i) => i.date));
  },

  mount(root, ctx) {
    const repo = createMediaRepo(ctx.store);
    seedDemo(ctx, repo);

    const [viewId, param] = (ctx.subpath || '').split('/');
    const isList = viewId === 'list' && (!param || KINDS.some((k) => k.id === param));
    const isItem = viewId === 'item' && param;
    // 日記などから「この日を記録」で来たとき：#/app/media/new/2026-10-23
    if (viewId === 'new') {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(param ?? '') && param <= toDateKey() ? param : toDateKey();
      queueMicrotask(() => {
        ctx.go('list', { replace: true });
        queueMicrotask(() => openMediaEditor({
          repo, date,
          onSaved: (item) => { showToast(`「${item.title}」を記録しました`); ctx.go(`item/${item.id}`); },
        }));
      });
      return () => {};
    }
    if (!isList && !isItem) {
      const last = repo.pref('kind', 'all');
      queueMicrotask(() => ctx.go(last === 'all' ? 'list' : `list/${last}`, { replace: true }));
      return () => {};
    }

    /** 記録する（kind は一覧で選んでいる種類） */
    const write = ({ kind, date } = {}) => openMediaEditor({
      repo,
      kind: kind ?? (isList && param ? param : 'book'),
      date,
      onSaved: (item, { isNew }) => {
        showToast(isNew ? `「${item.title}」を記録しました` : '記録を更新しました');
        if (isNew) ctx.go(`item/${item.id}`);
      },
    });
    const edit = (item) => openMediaEditor({ repo, item, onSaved: () => showToast('記録を更新しました') });

    ctx.toolbar?.append(h('button', { type: 'button', class: 'tool-btn', onClick: () => write() }, icon('plus'), '記録する'));

    const panel = h('div', { class: 'md' });
    root.append(panel);

    if (isItem) {
      panel.prepend(h('button', { type: 'button', class: 'btn btn-ghost btn-sm md-back', onClick: () => ctx.back(repo.pref('kind', 'all') === 'all' ? 'list' : `list/${repo.pref('kind', 'all')}`) }, icon('chevronLeft'), '一覧へ'));
      return mountDetailView(panel, { repo, id: param, go: ctx.go, back: ctx.back, user: ctx.user, edit });
    }
    const kind = param ?? 'all';
    repo.setPref('kind', kind);
    return mountListView(panel, { repo, kind, go: ctx.go, write });
  },
});
