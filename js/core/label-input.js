import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * 自由に入力できるラベル（メモ・アルバムで共通）。
 *  - 下の候補（今までに使ったラベル）をタップでつける・外す
 *  - 欄に入力して Enter（または「追加」）で新しいラベル
 *  - 1つにつき 12 文字まで、5 つまで
 */
export const LABEL_MAX = 12;
export const LABELS_PER_ITEM = 5;

export const normalizeLabel = (s) => String(s ?? '').normalize('NFKC').replace(/[\s,、]+/g, ' ').trim().slice(0, LABEL_MAX);

/**
 * @param {{ value?: string[], suggestions?: string[], id?: string }} o
 * @returns {{ el: HTMLElement, get: () => string[] }}
 */
export function labelInput({ value = [], suggestions = [], id = 'label-input' } = {}) {
  let labels = [...value];
  const chips = h('div', { class: 'lbl-current', 'aria-live': 'polite' });
  const input = h('input', { id, class: 'text-input', type: 'text', maxlength: String(LABEL_MAX), placeholder: '新しいラベル（例: 買い物）', autocomplete: 'off', enterKeyHint: 'done' });
  const addBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('plus'), '追加');
  const pool = h('div', { class: 'lbl-pool' });
  const note = h('p', { class: 'lbl-note', role: 'status' });

  function add(raw) {
    const name = normalizeLabel(raw);
    if (!name) return;
    if (labels.some((l) => l.toLowerCase() === name.toLowerCase())) { note.textContent = `「${name}」はもうついています`; return; }
    if (labels.length >= LABELS_PER_ITEM) { note.textContent = `ラベルは${LABELS_PER_ITEM}つまでです`; return; }
    labels.push(name);
    note.textContent = '';
    render();
  }
  function remove(name) {
    labels = labels.filter((l) => l !== name);
    note.textContent = '';
    render();
  }

  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); input.value = ''; }
    if (e.key === 'Backspace' && !input.value && labels.length) remove(labels.at(-1));
  });
  addBtn.addEventListener('click', () => { add(input.value); input.value = ''; input.focus(); });

  function render() {
    chips.replaceChildren(...(labels.length
      ? labels.map((l) => h('span', { class: 'lbl-chip is-on' }, icon('tag'), l,
        h('button', { type: 'button', class: 'lbl-x', 'aria-label': `ラベル「${l}」を外す`, onClick: () => remove(l) }, icon('close'))))
      : [h('span', { class: 'lbl-empty' }, 'ラベルなし')]));
    const rest = [...new Set(suggestions)].filter((s) => !labels.includes(s));
    pool.hidden = !rest.length;
    pool.replaceChildren(h('span', { class: 'lbl-pool-label' }, '使ったラベル'),
      ...rest.map((s) => h('button', { type: 'button', class: 'lbl-chip', onClick: () => add(s) }, icon('plus'), s)));
  }
  render();

  return {
    el: h('div', { class: 'lbl-input' }, chips, h('div', { class: 'lbl-add' }, input, addBtn), note, pool),
    /** 入力欄に残った文字もラベルとして足してから返す */
    get() { if (input.value.trim()) { add(input.value); input.value = ''; } return [...labels]; },
  };
}

/** 一覧の上に出す「ラベルで見る」チップ */
export function labelFilter({ labels, current, counts, onPick, unlabeledCount = 0 }) {
  const items = [
    { id: null, name: 'すべて', count: counts.__all },
    ...labels.map((l) => ({ id: l, name: l, count: counts[l] ?? 0 })),
    ...(unlabeledCount ? [{ id: '__none', name: 'ラベルなし', count: unlabeledCount }] : []),
  ];
  return h('div', { class: 'lbl-filter', role: 'group', 'aria-label': 'ラベルで見る' },
    items.map((it) => h('button', {
      type: 'button', class: 'lbl-chip', 'aria-pressed': String(current === it.id),
      onClick: () => onPick(it.id),
    }, it.id && it.id !== '__none' ? icon('tag') : null, it.name, h('span', { class: 'lbl-count' }, it.count))));
}
