import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openSheet } from '../../core/sheet.js';
import { showToast } from '../../core/toast.js';
import { labelFilter, labelInput } from '../../core/label-input.js';
import { BODY_MAX, TITLE_MAX, isBlank, matches, searchWords } from './repo.js';

/**
 * メモの一覧と、1件を書く画面。ふつうのメモ・非表示のメモで共通です。
 *
 * deps
 *   repo      … makeMemoList() で作ったもの
 *   hidden    … 非表示のメモか
 *   base      … URL の頭（'' または 'hidden/'）
 *   go / back … 画面の移動
 *   prefs     … { get(key, fallback), set(key, value) } 一覧の条件を覚える
 *   move      … (memo) => Promise  反対のリストへ移す（非表示にする / 非表示をやめる）
 */

const SORTS = [
  { id: 'updated', name: '更新が新しい順' },
  { id: 'created', name: '作った順（新しい）' },
  { id: 'title', name: 'タイトル順' },
];

const firstLine = (text) => text.split('\n').find((l) => l.trim())?.trim() ?? '';
const when = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

/** 検索語を <mark> で囲む */
function highlight(text, words) {
  if (!words.length) return text;
  const lower = text.normalize('NFKC').toLowerCase();
  if (lower.length !== text.length) return text; // 文字数が変わる文字（合字など）があればそのまま
  const marks = [];
  for (const w of words) {
    let at = lower.indexOf(w);
    while (at !== -1) { marks.push([at, at + w.length]); at = lower.indexOf(w, at + w.length); }
  }
  if (!marks.length) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const out = [];
  let i = 0;
  for (const [s, e] of marks) {
    if (s < i) continue;
    out.push(text.slice(i, s), h('mark', {}, text.slice(s, e)));
    i = e;
  }
  out.push(text.slice(i));
  return out;
}

/** 本文の、検索語のまわりを切り出す（長い本文の途中に言葉があっても見えるように） */
function excerpt(body, words) {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!words.length) return flat.slice(0, 160);
  const at = flat.normalize('NFKC').toLowerCase().indexOf(words[0]);
  if (at < 40) return flat.slice(0, 160);
  return `…${flat.slice(at - 30, at + 130)}`;
}

export function mountMemoList(root, { repo, hidden, base, go, prefs, header }) {
  let q = prefs.get('q', '');
  let label = prefs.get('label', null);
  let sort = prefs.get('sort', 'updated');

  const search = h('input', { class: 'text-input', type: 'search', value: q, placeholder: 'タイトル・本文の言葉で探す', 'aria-label': 'メモを探す', enterKeyHint: 'search' });
  search.addEventListener('input', () => { q = search.value; prefs.set('q', q); render(); });
  const sortSel = h('select', { class: 'text-input mm-sort', 'aria-label': '並べ替え' }, SORTS.map((s) => h('option', { value: s.id }, s.name)));
  sortSel.value = sort;
  sortSel.addEventListener('change', () => { sort = sortSel.value; prefs.set('sort', sort); render(); });

  const filters = h('div', { class: 'mm-filters' });
  const note = h('p', { class: 'mm-result', role: 'status' });
  const list = h('div', { class: 'mm-grid' });

  root.append(
    ...[header].filter(Boolean),
    h('div', { class: 'mm-tools' }, h('div', { class: 'mm-search' }, icon('search'), search), sortSel),
    filters,
    note,
    list,
    h('button', { type: 'button', class: 'fab mm-fab', onClick: () => go(`${base}new`) }, icon('plus'), '新しいメモ'),
  );

  function render() {
    const { names, counts } = repo.labels();
    const all = repo.all();
    if (label && label !== '__none' && !names.includes(label)) label = null;
    counts.__all = all.length;
    const unlabeled = all.filter((m) => !m.labels.length).length;
    filters.replaceChildren(...[
      (names.length || unlabeled < all.length) && labelFilter({ labels: names, current: label, counts, unlabeledCount: names.length ? unlabeled : 0, onPick: (l) => { label = l; prefs.set('label', l); render(); } }),
      names.length > 0 && h('button', { type: 'button', class: 'btn btn-ghost btn-sm mm-label-manage', onClick: () => openLabelManager(repo) }, icon('tag'), 'ラベルを整理'),
    ].filter(Boolean));

    const words = searchWords(q);
    let memos = all.filter((m) => (label == null || (label === '__none' ? !m.labels.length : m.labels.includes(label))) && matches(m, words));
    if (sort === 'created') memos.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
    if (sort === 'title') memos.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.title || firstLine(a.body)).localeCompare(b.title || firstLine(b.body), 'ja'));

    const filtered = words.length || label;
    note.hidden = !filtered;
    note.textContent = filtered ? `${memos.length}件${words.length ? `（「${q.trim()}」で探しています）` : ''}` : '';

    if (!memos.length) {
      list.replaceChildren(h('div', { class: 'mm-empty' },
        icon(hidden ? 'lock' : 'doc'),
        h('p', {}, filtered ? '条件に合うメモはありません。' : hidden ? '非表示のメモはまだありません。ふつうのメモの「非表示にする」から移せます。ここで新しく書くこともできます。' : 'まだメモがありません。右下の「新しいメモ」から書けます。'),
        filtered && h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { q = ''; search.value = ''; label = null; prefs.set('q', ''); prefs.set('label', null); render(); } }, '条件をクリア'),
      ));
      return;
    }
    list.replaceChildren(...memos.map((m) => {
      const title = m.title.trim() || firstLine(m.body) || '（空のメモ）';
      const body = m.title.trim() ? m.body : m.body.split('\n').slice(1).join('\n');
      return h('button', { type: 'button', class: `mm-card${m.pinned ? ' is-pinned' : ''}`, onClick: () => go(`${base}edit/${m.id}`) },
        h('span', { class: 'mm-card-head' },
          m.pinned && h('span', { class: 'mm-pin', title: 'ピン留め' }, icon('pin')),
          h('span', { class: `mm-card-title${m.title.trim() ? '' : ' is-untitled'}` }, highlight(title, words)),
        ),
        body.trim() && h('span', { class: 'mm-card-body' }, highlight(excerpt(body, words), words)),
        h('span', { class: 'mm-card-foot' },
          h('span', { class: 'mm-card-labels' }, m.labels.map((l) => h('span', { class: 'lbl-chip is-sm' }, l))),
          h('time', { dateTime: m.updatedAt }, when(m.updatedAt)),
        ),
      );
    }));
  }

  render();
  return repo.subscribe(render);
}

/** ラベルの名前を変える・消す */
function openLabelManager(repo) {
  openSheet({
    title: 'ラベルを整理',
    render(sheet) {
      const body = h('div', { class: 'mm-label-list' });
      const renderList = () => {
        const { names, counts } = repo.labels();
        body.replaceChildren(...(names.length ? names.map((name) => {
          const input = h('input', { class: 'text-input', type: 'text', value: name, maxlength: '12', 'aria-label': `ラベル「${name}」の名前` });
          return h('div', { class: 'mm-label-row' },
            icon('tag'), input, h('span', { class: 'lbl-count' }, `${counts[name]}件`),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: async () => { const to = input.value.trim(); if (to && to !== name) { await repo.renameLabel(name, to); showToast(`「${name}」を「${to}」に変えました`); renderList(); } } }, '名前を変える'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `ラベル「${name}」を消す`, onClick: async () => { await repo.renameLabel(name, null); showToast(`ラベル「${name}」を外しました（メモは消えません）`); renderList(); } }, icon('trash')),
          );
        }) : [h('p', { class: 'muted' }, 'ラベルはありません。')]));
      };
      renderList();
      return h('div', { class: 'form' },
        h('p', { class: 'sheet-note' }, '名前を変えると、そのラベルのついたメモがまとめて変わります。消してもメモは消えません。'),
        body,
        h('div', { class: 'sheet-actions' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn btn-primary', onClick: sheet.close }, '閉じる')));
    },
  });
}

/**
 * 1件のメモを書く・読む画面（入れたそばから自動で保存）
 * id が null なら新しいメモ（何か書いた時点で作る）
 */
export function mountMemoEditor(root, { repo, id, hidden, base, back, move, onCreate }) {
  let memo = id ? repo.get(id) : null;
  if (id && !memo) {
    root.append(h('div', { class: 'mm-empty' }, h('p', {}, 'このメモは見つかりません（削除されたかもしれません）。'),
      h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => back(`${base}list`) }, '一覧に戻る')));
    return () => {};
  }
  let labels = memo?.labels ?? [];
  let pinned = memo?.pinned ?? false;
  let timer = null;
  let saving = Promise.resolve();

  const status = h('span', { class: 'mm-status', role: 'status' });
  const title = h('input', { class: 'mm-title', type: 'text', maxlength: String(TITLE_MAX), placeholder: 'タイトル', value: memo?.title ?? '', 'aria-label': 'タイトル' });
  const body = h('textarea', { class: 'mm-body', maxlength: String(BODY_MAX), placeholder: '本文を書く', 'aria-label': '本文' });
  body.value = memo?.body ?? '';
  const count = h('span', { class: 'char-count' });
  const labelRow = h('div', { class: 'mm-labels' });
  const actions = h('div', { class: 'mm-actions' });

  const grow = () => { body.style.height = 'auto'; body.style.height = `${Math.max(body.scrollHeight, 240)}px`; };
  const updateCount = () => { count.textContent = `${[...body.value].length.toLocaleString()} / ${BODY_MAX.toLocaleString()}文字`; };

  function setStatus(text, state = 'ok') { status.textContent = text; status.dataset.state = state; }

  /** 今の内容を保存（新しいメモなら作る） */
  function flush() {
    clearTimeout(timer);
    const input = { title: title.value, body: body.value, labels, pinned };
    saving = saving.then(async () => {
      try {
        if (!memo) {
          if (isBlank({ title: input.title, body: input.body }) && !labels.length) return;
          memo = await repo.create(input);
          onCreate?.(memo);
        } else {
          const same = memo.title === input.title && memo.body === input.body && memo.pinned === input.pinned && memo.labels.join('\n') === input.labels.join('\n');
          if (same) return;
          memo = await repo.update(memo.id, input);
        }
        setStatus('保存しました');
        renderActions();
      } catch (err) {
        setStatus(err.message, 'error');
      }
    });
    return saving;
  }
  const schedule = () => { setStatus('入力中…', 'typing'); clearTimeout(timer); timer = setTimeout(flush, 500); };
  title.addEventListener('input', schedule);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); body.focus(); } });
  body.addEventListener('input', () => { grow(); updateCount(); schedule(); });

  function renderLabels() {
    labelRow.replaceChildren(
      ...labels.map((l) => h('span', { class: 'lbl-chip is-on is-sm' }, icon('tag'), l)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: editLabels }, icon('tag'), labels.length ? 'ラベルを変える' : 'ラベルをつける'),
    );
  }
  function editLabels() {
    openSheet({
      title: 'ラベル',
      render(sheet) {
        const picker = labelInput({ value: labels, suggestions: repo.labels().names, id: 'mm-label-input' });
        return h('form', {
          class: 'form', novalidate: true,
          onSubmit: (e) => { e.preventDefault(); labels = picker.get(); renderLabels(); flush(); sheet.close(); },
        },
          picker.el,
          h('div', { class: 'sheet-actions' }, h('span', { class: 'spacer' }),
            h('button', { type: 'button', class: 'btn btn-ghost', onClick: sheet.close }, 'キャンセル'),
            h('button', { type: 'submit', class: 'btn btn-primary' }, icon('check'), '決定')));
      },
    });
  }

  function renderActions() {
    actions.replaceChildren(
      h('button', {
        type: 'button', class: `btn btn-ghost btn-sm${pinned ? ' is-on' : ''}`, 'aria-pressed': String(pinned),
        onClick: () => { pinned = !pinned; renderActions(); flush(); },
      }, icon('pin'), pinned ? 'ピン留め中' : 'ピン留め'),
      memo && h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: doMove }, icon(hidden ? 'eye' : 'eyeOff'), hidden ? '非表示をやめる' : '非表示にする'),
      memo && h('button', { type: 'button', class: 'btn btn-danger-text btn-sm', onClick: askDelete }, icon('trash'), '削除'),
    );
  }
  function askDelete() {
    actions.replaceChildren(
      h('span', { class: 'confirm-text' }, 'このメモを削除しますか？'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: renderActions }, 'やめる'),
      h('button', {
        type: 'button', class: 'btn btn-danger btn-sm',
        onClick: async () => {
          clearTimeout(timer);
          await saving;
          const removed = await repo.remove(memo.id);
          memo = null;
          deleted = true;
          showToast('メモを削除しました', { action: { label: '元に戻す', onClick: () => repo.insert(removed) } });
          back(`${base}list`);
        },
      }, '削除する'),
    );
  }
  async function doMove() {
    await flush();
    const ok = await move(memo);
    if (ok) { deleted = true; back(`${base}list`); }
  }

  let deleted = false;
  root.append(h('article', { class: `mm-editor${hidden ? ' is-hidden' : ''}` },
    h('div', { class: 'mm-editor-top' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => back(`${base}list`) }, icon('chevronLeft'), hidden ? '非表示の一覧' : '一覧'),
      hidden && h('span', { class: 'mm-hidden-tag' }, icon('lock'), '非表示'),
      status,
    ),
    title,
    labelRow,
    body,
    h('div', { class: 'mm-editor-foot' }, count, actions),
  ));
  renderLabels();
  renderActions();
  updateCount();
  requestAnimationFrame(grow);
  if (!memo) title.focus();

  return () => {
    // 画面を離れるとき：書きかけを保存。何も書いていない・全部消したメモは残さない
    clearTimeout(timer);
    if (deleted) return;
    flush().then(() => { if (memo && isBlank(memo) && !memo.labels.length) repo.remove(memo.id); });
  };
}
