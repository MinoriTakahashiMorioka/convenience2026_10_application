import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { router } from '../../core/router.js';
import { showToast } from '../../core/toast.js';
import { dayLinksSection } from '../../core/day-links.js';
import { toDateKey } from '../../models/schema.js';
import { createStore } from '../../core/storage.js';
import { createDiaryRepo } from '../diary/repo.js';
import { KINDS, kindOf } from './repo.js';
import { cover, dateText, stars, subline } from './parts.js';

const SORTS = [
  { id: 'new', name: '新しい順' },
  { id: 'old', name: '古い順' },
  { id: 'rating', name: '評価が高い順' },
  { id: 'title', name: 'タイトル順' },
];

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();

/**
 * 一覧（本棚のようにカードを並べる）
 *  - 種類（すべて・本・映画・場所・その他）、言葉で探す、並べ替え、☆で絞り込み
 */
export function mountListView(root, { repo, kind, go, write }) {
  let q = repo.pref('q', '');
  let sort = repo.pref('sort', 'new');
  let minStar = repo.pref('minStar', 0);

  const tabs = h('div', { class: 'md-tabs', role: 'tablist', 'aria-label': '種類' });
  const search = h('input', { class: 'text-input', type: 'search', placeholder: 'タイトル・作者・感想から探す', value: q, 'aria-label': '探す', enterKeyHint: 'search' });
  search.addEventListener('input', () => { q = search.value; repo.setPref('q', q); render(); });
  const sortSel = h('select', { class: 'text-input md-sort', 'aria-label': '並べ替え' }, SORTS.map((s) => h('option', { value: s.id }, s.name)));
  sortSel.value = sort;
  sortSel.addEventListener('change', () => { sort = sortSel.value; repo.setPref('sort', sort); render(); });
  const starSel = h('select', { class: 'text-input md-sort', 'aria-label': '評価で絞り込む' },
    h('option', { value: '0' }, 'すべての評価'),
    [5, 4, 3].map((n) => h('option', { value: String(n) }, `☆${n}${n < 5 ? '以上' : ''}`)));
  starSel.value = String(minStar);
  starSel.addEventListener('change', () => { minStar = Number(starSel.value); repo.setPref('minStar', minStar); render(); });

  const stats = h('div', { class: 'md-stats' });
  const grid = h('div', { class: 'md-grid' });
  const resultNote = h('p', { class: 'md-result', role: 'status' });

  root.append(
    stats,
    tabs,
    h('div', { class: 'md-tools' }, h('div', { class: 'md-search' }, icon('search'), search), sortSel, starSel),
    resultNote,
    grid,
  );

  function render() {
    const all = repo.all();
    const year = toDateKey().slice(0, 4);
    const thisYear = all.filter((i) => i.date.startsWith(year));

    stats.replaceChildren(
      h('p', { class: 'md-stats-title' }, `${year}年の記録`),
      ...KINDS.map((k) => {
        const n = thisYear.filter((i) => i.kind === k.id).length;
        return h('div', { class: 'md-stat', 'data-kind': k.id }, icon(k.icon), h('span', {}, `${k.verb}${k.name === 'その他' ? 'もの' : k.name}`), h('strong', {}, n, h('small', {}, k.unit)));
      }),
    );

    tabs.replaceChildren(...[{ id: 'all', name: 'すべて', icon: 'list' }, ...KINDS].map((k) => {
      const n = k.id === 'all' ? all.length : all.filter((i) => i.kind === k.id).length;
      return h('button', {
        type: 'button', role: 'tab', class: 'md-tab', 'data-kind': k.id,
        'aria-selected': String(k.id === kind),
        onClick: () => { if (k.id !== kind) go(k.id === 'all' ? 'list' : `list/${k.id}`, { replace: true }); },
      }, icon(k.icon), h('span', {}, k.name), h('span', { class: 'md-count' }, n));
    }));

    const words = norm(q).trim();
    let items = all.filter((i) => (kind === 'all' || i.kind === kind) && i.rating >= minStar
      && (!words || norm(`${i.title} ${i.creator} ${i.where} ${i.area} ${i.review}`).includes(words)));
    if (sort === 'old') items = items.reverse();
    if (sort === 'rating') items.sort((a, b) => b.rating - a.rating || b.date.localeCompare(a.date));
    if (sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title, 'ja'));

    const filtered = words || minStar;
    resultNote.textContent = filtered ? `${items.length}件見つかりました` : '';
    resultNote.hidden = !filtered;

    if (!items.length) {
      const k = kind === 'all' ? null : kindOf(kind);
      grid.replaceChildren(h('div', { class: 'md-empty' },
        icon(k?.icon ?? 'sparkle'),
        h('p', {}, filtered ? '条件に合う記録がありません。' : k ? `まだ${k.verb}${k.name}の記録がありません。` : 'まだ記録がありません。読んだ本・観た映画・行った場所を残してみましょう。'),
        !filtered && h('button', { type: 'button', class: 'btn btn-primary', onClick: () => write({ kind: k?.id ?? 'book' }) }, icon('plus'), '記録する'),
      ));
      return;
    }
    grid.replaceChildren(...items.map((item) => h('button', {
      type: 'button', class: 'md-card', 'data-kind': item.kind,
      onClick: () => go(`item/${item.id}`),
    },
      cover(item),
      h('span', { class: 'md-card-body' },
        h('span', { class: 'md-card-kind' }, icon(kindOf(item.kind).icon), kindOf(item.kind).name),
        h('span', { class: 'md-card-title' }, item.title),
        subline(item) && h('span', { class: 'md-card-sub' }, subline(item)),
        h('span', { class: 'md-card-foot' }, item.rating ? stars(item.rating, { size: 'sm' }) : h('span', { class: 'md-muted' }, '未評価'), h('time', { dateTime: item.date }, item.date.slice(5).replace('-', '/').replace(/^0/, ''))),
      ),
    )));
  }

  render();
  return repo.subscribe(render);
}

/**
 * 1件の詳しい表示。下に「この日の日記」と、ほかの機能のその日の記録。
 */
export function mountDetailView(root, { repo, id, go, back, user, edit }) {
  const wrap = h('div', { class: 'md-detail' });
  root.append(wrap);

  function render() {
    const item = repo.get(id);
    if (!item) {
      wrap.replaceChildren(h('div', { class: 'md-empty' }, h('p', {}, 'この記録は見つかりません（削除されたかもしれません）。'),
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => go('list', { replace: true }) }, '一覧に戻る')));
      return;
    }
    const k = kindOf(item.kind);
    const diary = createDiaryRepo(createStore(`u:${user.id}:diary`)).get(item.date);

    const actions = h('div', { class: 'md-detail-actions' });
    const renderActions = () => actions.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-danger-text btn-sm', onClick: askDelete }, icon('trash'), '削除'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => edit(item) }, icon('pencil'), '編集'),
    );
    function askDelete() {
      actions.replaceChildren(
        h('p', { class: 'confirm-text' }, `「${item.title}」を削除しますか？`),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: renderActions }, 'やめる'),
        h('button', {
          type: 'button', class: 'btn btn-danger btn-sm',
          onClick: () => {
            repo.remove(item.id);
            showToast(`「${item.title}」を削除しました`, { action: { label: '元に戻す', onClick: () => { repo.restore(item); go(`item/${item.id}`); } } });
            back('list');
          },
        }, '削除する'),
      );
    }
    renderActions();

    const diaryBox = h('section', { class: 'md-diary', 'aria-label': 'この日の日記' },
      h('h3', {}, icon('book2'), `${dateText(item.date)}の日記`),
      diary
        ? h('button', { type: 'button', class: 'md-diary-card', onClick: () => router.navigate(`/app/diary/day/${item.date}`) },
          h('span', { class: 'md-diary-text' }, diary.text),
          h('span', { class: 'md-diary-go' }, '日記を開く', icon('chevronRight')))
        : h('div', { class: 'md-diary-empty' },
          h('p', {}, 'この日の日記はまだありません。今日のできごととあわせて書いておくと、あとで思い出しやすくなります。'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => router.navigate(`/app/diary/day/${item.date}`) }, icon('pencil'), 'この日の日記を書く')),
    );

    wrap.replaceChildren(
      h('article', { class: 'md-sheet', 'data-kind': item.kind },
        h('div', { class: 'md-sheet-cover' }, cover(item, { size: 'large' })),
        h('div', { class: 'md-sheet-body' },
          h('span', { class: 'md-pill', 'data-kind': item.kind }, icon(k.icon), k.name),
          h('h2', { class: 'md-sheet-title' }, item.title),
          subline(item) && h('p', { class: 'md-sheet-sub' }, item.kind === 'book' ? `${item.creator}` : subline(item)),
          h('div', { class: 'md-sheet-meta' },
            stars(item.rating, { size: 'lg' }),
            h('span', {}, `${k.dateLabel}：`, h('time', { dateTime: item.date }, dateText(item.date))),
          ),
          item.review
            ? h('div', { class: 'md-review-text' }, item.review)
            : h('p', { class: 'md-muted' }, '感想はまだ書いていません。'),
          actions,
        ),
      ),
      diaryBox,
      // 日記は上に出しているので除く。自分自身も出さない
      dayLinksSection(item.date, { exclude: 'diary', title: 'この日のほかの記録', emptyText: null, skip: (link) => link.href === `/app/media/item/${item.id}` }),
    );
  }

  render();
  return repo.subscribe(render);
}
