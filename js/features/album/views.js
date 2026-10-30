import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openSheet } from '../../core/sheet.js';
import { showToast } from '../../core/toast.js';
import { labelFilter, labelInput } from '../../core/label-input.js';
import { NOTE_MAX, TITLE_MAX, matchesAlbum } from './repo.js';

/**
 * アルバムの一覧・1冊の中身・写真を大きく見る画面。ふつう・非表示で共通です。
 */

const words = (q) => String(q ?? '').normalize('NFKC').toLowerCase().split(/[\s　]+/).filter(Boolean);

/** 小さい写真を非同期で読み込んで <img> に入れる */
function thumb(repo, photo, { kind = 't', alt = '' } = {}) {
  const img = h('img', { alt, decoding: 'async', class: 'al-img is-loading' });
  repo.url(photo.id, kind).then((url) => {
    if (url) { img.src = url; img.classList.remove('is-loading'); } else img.classList.add('is-missing');
  }).catch(() => img.classList.add('is-missing'));
  return img;
}

// ======================================================================
// 一覧
// ======================================================================

export function mountAlbumList(root, { repo, hidden, base, go, prefs, header }) {
  let q = prefs.get('q', '');
  let label = prefs.get('label', null);

  const search = h('input', { class: 'text-input', type: 'search', value: q, placeholder: 'アルバムの名前・説明で探す', 'aria-label': 'アルバムを探す', enterKeyHint: 'search' });
  search.addEventListener('input', () => { q = search.value; prefs.set('q', q); render(); });
  const filters = h('div', { class: 'al-filters' });
  const stat = h('p', { class: 'al-stat' });
  const grid = h('div', { class: 'al-grid' });

  root.append(
    ...[header].filter(Boolean),
    h('div', { class: 'al-tools' }, h('div', { class: 'al-search' }, icon('search'), search), stat),
    filters,
    grid,
    h('button', { type: 'button', class: 'fab al-fab', onClick: () => openAlbumSheet({ repo, onSaved: (a) => go(`${base}a/${a.id}`) }) }, icon('plus'), '新しいアルバム'),
  );

  function render() {
    const all = repo.all();
    const { names, counts } = repo.labels();
    if (label && label !== '__none' && !names.includes(label)) label = null;
    counts.__all = all.length;
    const unlabeled = all.filter((a) => !a.labels.length).length;
    filters.replaceChildren(...[
      names.length > 0 && labelFilter({ labels: names, current: label, counts, unlabeledCount: unlabeled, onPick: (l) => { label = l; prefs.set('label', l); render(); } }),
    ].filter(Boolean));
    stat.textContent = `${all.length}冊・写真${repo.photoCount()}枚`;

    const w = words(q);
    const albums = all.filter((a) => (label == null || (label === '__none' ? !a.labels.length : a.labels.includes(label))) && matchesAlbum(a, w));
    if (!albums.length) {
      grid.replaceChildren(h('div', { class: 'al-empty' }, icon(hidden ? 'lock' : 'album'),
        h('p', {}, w.length || label ? '条件に合うアルバムはありません。'
          : hidden ? '非表示のアルバムはまだありません。アルバムの「非表示にする」から移せます。ここで新しく作ることもできます。'
            : 'まだアルバムがありません。右下の「新しいアルバム」から作って、写真を追加しましょう。')));
      return;
    }
    grid.replaceChildren(...albums.map((a) => {
      const cover = repo.coverOf(a);
      const others = a.photos.filter((p) => p.id !== cover?.id).slice(0, 2);
      return h('button', { type: 'button', class: 'al-card', onClick: () => go(`${base}a/${a.id}`) },
        h('span', { class: `al-cover${others.length ? ' has-stack' : ''}` },
          cover ? thumb(repo, cover, { alt: '' }) : h('span', { class: 'al-cover-empty' }, icon('image')),
          others.length > 0 && h('span', { class: 'al-cover-side' }, others.map((p) => thumb(repo, p))),
        ),
        h('span', { class: 'al-card-body' },
          h('span', { class: 'al-card-title' }, a.title),
          h('span', { class: 'al-card-meta' }, `${a.photos.length}枚`),
          a.labels.length > 0 && h('span', { class: 'al-card-labels' }, a.labels.map((l) => h('span', { class: 'lbl-chip is-sm' }, l))),
        ),
      );
    }));
  }

  render();
  return repo.subscribe(render);
}

/** アルバムを作る・名前などを変えるシート */
export function openAlbumSheet({ repo, album = null, onSaved }) {
  return openSheet({
    title: album ? 'アルバムの情報' : '新しいアルバム',
    render(sheet) {
      const title = h('input', { id: 'al-title', class: 'text-input', type: 'text', maxlength: String(TITLE_MAX), value: album?.title ?? '', placeholder: '例: 夏休みの旅行', autocomplete: 'off' });
      const note = h('textarea', { id: 'al-note', class: 'text-input', rows: 3, maxlength: String(NOTE_MAX), placeholder: 'どんなアルバムか（検索のときにも使われます）' });
      note.value = album?.note ?? '';
      const labels = labelInput({ value: album?.labels ?? [], suggestions: repo.labels().names, id: 'al-label' });
      const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
      queueMicrotask(() => title.focus());
      return h('form', {
        class: 'form', novalidate: true,
        onSubmit: async (e) => {
          e.preventDefault();
          try {
            const input = { title: title.value, note: note.value, labels: labels.get() };
            const saved = album ? await repo.update(album.id, input) : await repo.create(input);
            sheet.close();
            onSaved?.(saved);
          } catch (er) {
            err.replaceChildren(icon('alert'), h('span', {}, er.message));
            err.hidden = false;
            if (er.field === 'title') title.focus();
          }
        },
      },
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'al-title' }, 'アルバムの名前', h('span', { class: 'field-hint' }, '必須')), title),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'al-note' }, '説明', h('span', { class: 'field-hint' }, '任意')), note),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'al-label' }, 'ラベル', h('span', { class: 'field-hint' }, '任意・5つまで')), labels.el),
        err,
        h('div', { class: 'sheet-actions' }, h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn btn-ghost', onClick: sheet.close }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, icon('check'), album ? '保存' : '作る')),
      );
    },
  });
}

// ======================================================================
// 1冊の中身
// ======================================================================

export function mountAlbumDetail(root, { repo, id, hidden, base, go, back, move }) {
  let selecting = false;
  const selected = new Set();
  let busy = false;

  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', id: 'al-files' });
  const progress = h('div', { class: 'al-progress', role: 'status', hidden: true });
  const head = h('header', { class: 'al-head' });
  const grid = h('div', { class: 'al-photos' });
  const bar = h('div', { class: 'al-select-bar', hidden: true });
  const wrap = h('div', { class: 'al-detail' },
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm al-back', onClick: () => back(`${base}list`) }, icon('chevronLeft'), hidden ? '非表示のアルバム' : 'アルバム一覧'),
    head, progress, grid, bar, fileInput);
  root.append(wrap);

  async function addFiles(files) {
    if (!files?.length || busy) return;
    busy = true;
    progress.hidden = false;
    const setProgress = (d, t) => progress.replaceChildren(h('span', { class: 'spinner' }), `写真を追加しています… ${d} / ${t}`,
      h('span', { class: 'al-progress-bar' }, h('i', { style: { width: `${(d / t) * 100}%` } })));
    setProgress(0, files.length);
    try {
      const r = await repo.addPhotos(id, files, setProgress);
      const extra = [r.failed && `${r.failed}枚は追加できませんでした`, r.skipped && `一度に追加できるのは50枚までです`].filter(Boolean).join('・');
      showToast(`${r.added}枚追加しました${extra ? `（${extra}）` : ''}`);
    } catch (err) {
      showToast(err.message);
    } finally {
      busy = false;
      progress.hidden = true;
    }
  }
  fileInput.addEventListener('change', () => { const files = [...fileInput.files]; fileInput.value = ''; addFiles(files); });
  // PC：写真をドラッグして入れる
  wrap.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); wrap.classList.add('is-drop'); } });
  wrap.addEventListener('dragleave', (e) => { if (e.target === wrap) wrap.classList.remove('is-drop'); });
  wrap.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('is-drop'); addFiles([...e.dataTransfer.files]); });

  const actionsBox = h('div', { class: 'al-head-actions' });

  function render() {
    const album = repo.get(id);
    if (!album) {
      head.replaceChildren(h('p', { class: 'al-empty' }, 'このアルバムは見つかりません（削除されたかもしれません）。'));
      grid.replaceChildren();
      bar.hidden = true;
      return;
    }
    for (const pid of [...selected]) if (!album.photos.some((p) => p.id === pid)) selected.delete(pid);
    renderActions(album);
    head.replaceChildren(
      h('div', { class: 'al-head-text' },
        h('h2', {}, hidden && icon('lock'), album.title),
        album.note && h('p', { class: 'al-note' }, album.note),
        h('p', { class: 'al-head-meta' }, `${album.photos.length}枚`, ...album.labels.map((l) => h('span', { class: 'lbl-chip is-sm' }, icon('tag'), l))),
      ),
      actionsBox,
    );

    if (!album.photos.length) {
      grid.replaceChildren(h('label', { class: 'al-drop', for: 'al-files' }, icon('image'), h('strong', {}, '写真を追加'), h('span', {}, 'タップして選ぶ（PCはここにドラッグしても入ります）。まとめて選べます。')));
    } else {
      grid.replaceChildren(...album.photos.map((p, i) => h('button', {
        type: 'button',
        class: `al-photo${selected.has(p.id) ? ' is-selected' : ''}${(album.coverId ?? album.photos[0].id) === p.id ? ' is-cover' : ''}`,
        'aria-label': `${i + 1}枚目${selected.has(p.id) ? '（選択中）' : ''}`,
        'aria-pressed': selecting ? String(selected.has(p.id)) : null,
        onClick: () => {
          if (selecting) { if (selected.has(p.id)) selected.delete(p.id); else selected.add(p.id); render(); return; }
          openViewer({ repo, album: repo.get(id), index: i });
        },
      }, thumb(repo, p), selecting && h('span', { class: 'al-check' }, icon('check')))));
    }
    renderBar(album);
  }

  function renderActions(album) {
    actionsBox.replaceChildren(
      h('label', { class: 'btn btn-primary btn-sm', for: 'al-files' }, icon('plus'), '写真を追加'),
      album.photos.length > 0 && h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': String(selecting), onClick: () => { selecting = !selecting; selected.clear(); render(); } }, icon('check'), selecting ? '選ぶのをやめる' : '選ぶ'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => openAlbumSheet({ repo, album, onSaved: () => showToast('保存しました') }) }, icon('pencil'), '情報'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => doMove(album) }, icon(hidden ? 'eye' : 'eyeOff'), hidden ? '非表示をやめる' : '非表示にする'),
      h('button', { type: 'button', class: 'btn btn-danger-text btn-sm', onClick: () => askDeleteAlbum(album) }, icon('trash'), '削除'),
    );
  }

  function askDeleteAlbum(album) {
    actionsBox.replaceChildren(h('div', { class: 'al-confirm' },
      h('p', { class: 'confirm-text' }, `「${album.title}」と写真${album.photos.length}枚を削除しますか？元に戻せません。`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: render }, 'やめる'),
      h('button', { type: 'button', class: 'btn btn-danger btn-sm', onClick: async () => { await repo.remove(album.id); showToast(`「${album.title}」を削除しました`); back(`${base}list`); } }, '削除する'),
    ));
  }

  async function doMove(album) {
    if (busy) return;
    busy = true;
    progress.hidden = false;
    progress.replaceChildren(h('span', { class: 'spinner' }), hidden ? '非表示から戻しています…' : '非表示に移しています…');
    try {
      const ok = await move(album, (d, t) => progress.replaceChildren(h('span', { class: 'spinner' }), `移しています… ${d} / ${t}`));
      if (ok) back(`${base}list`);
    } catch (err) {
      showToast(err.message);
    } finally {
      busy = false;
      progress.hidden = true;
    }
  }

  function renderBar(album) {
    bar.hidden = !selecting;
    if (!selecting) return;
    const n = selected.size;
    bar.replaceChildren(
      h('span', { class: 'al-sel-count' }, h('strong', {}, `${n}枚`), 'を選択中'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { album.photos.forEach((p) => selected.add(p.id)); render(); } }, 'すべて選ぶ'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: n !== 1, onClick: async () => { await repo.setCover(id, [...selected][0]); selecting = false; selected.clear(); showToast('表紙にしました'); render(); } }, icon('image'), '表紙にする'),
      h('button', { type: 'button', class: 'btn btn-danger btn-sm', disabled: !n, onClick: () => askDeletePhotos(n) }, icon('trash'), '削除'),
    );
  }

  function askDeletePhotos(n) {
    bar.replaceChildren(
      h('span', { class: 'confirm-text' }, `写真${n}枚を削除しますか？元に戻せません。`),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: render }, 'やめる'),
      h('button', { type: 'button', class: 'btn btn-danger btn-sm', onClick: async () => { await repo.removePhotos(id, [...selected]); selected.clear(); selecting = false; showToast(`${n}枚削除しました`); } }, '削除する'),
    );
  }

  render();
  const off = repo.subscribe(render);
  void go;
  return () => { off(); closeViewer(); };
}

// ======================================================================
// 写真を大きく見る（左右の矢印・スワイプ・← → キー・Esc）
// ======================================================================

let viewer = null;
function closeViewer() { viewer?.close(); }

function openViewer({ repo, album, index }) {
  closeViewer();
  let i = index;
  const img = h('img', { class: 'al-view-img', alt: '' });
  const counter = h('span', { class: 'al-view-count' });
  const prev = h('button', { type: 'button', class: 'al-view-nav is-prev', 'aria-label': '前の写真', onClick: () => show(i - 1) }, icon('chevronLeft'));
  const next = h('button', { type: 'button', class: 'al-view-nav is-next', 'aria-label': '次の写真', onClick: () => show(i + 1) }, icon('chevronRight'));
  const save = h('button', { type: 'button', class: 'al-view-btn', onClick: download }, icon('download'), '保存');
  const dialog = h('div', { class: 'al-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${album.title}の写真` },
    h('div', { class: 'al-view-top' },
      counter,
      h('span', { class: 'spacer' }),
      save,
      h('button', { type: 'button', class: 'al-view-btn', 'aria-label': '閉じる', onClick: () => close() }, icon('close')),
    ),
    h('div', { class: 'al-view-stage' }, img),
    prev, next,
  );

  async function show(n) {
    if (n < 0 || n >= album.photos.length) return;
    i = n;
    const p = album.photos[i];
    counter.textContent = `${i + 1} / ${album.photos.length}`;
    prev.disabled = i === 0;
    next.disabled = i === album.photos.length - 1;
    img.classList.add('is-loading');
    // まず小さい写真を出して、大きい写真が読めたら差しかえる
    const small = await repo.url(p.id, 't');
    if (i === n && small) img.src = small;
    const big = await repo.url(p.id, 'p');
    if (i === n && big) { img.src = big; img.classList.remove('is-loading'); }
  }

  async function download() {
    const p = album.photos[i];
    const url = await repo.url(p.id, 'p');
    if (!url) return;
    const a = h('a', { href: url, download: `${album.title}_${i + 1}.jpg` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
  };
  let touch = null;
  dialog.addEventListener('touchstart', (e) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 60) show(i + (dx < 0 ? 1 : -1));
    else if (dy > 90 && Math.abs(dx) < 60) close(); // 下にスワイプで閉じる
  }, { passive: true });
  dialog.addEventListener('click', (e) => { if (e.target.classList.contains('al-view-stage')) close(); });

  function close() {
    document.removeEventListener('keydown', onKey);
    dialog.remove();
    document.documentElement.classList.remove('sheet-open');
    viewer = null;
  }

  document.addEventListener('keydown', onKey);
  document.body.append(dialog);
  document.documentElement.classList.add('sheet-open');
  viewer = { close };
  show(i);
  dialog.querySelector('.al-view-btn[aria-label="閉じる"]').focus();
}
