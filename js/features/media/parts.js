import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { kindOf } from './repo.js';

/** ☆の表示（0〜5） */
export function stars(rating, { size = 'md' } = {}) {
  return h('span', { class: `md-stars md-stars-${size}`, role: 'img', 'aria-label': rating ? `☆${rating}つ` : '評価なし' },
    [1, 2, 3, 4, 5].map((n) => h('span', { class: n <= rating ? 'is-on' : null, 'aria-hidden': 'true' }, icon(n <= rating ? 'starFill' : 'star'))));
}

/** ☆を選ぶ（同じ☆をもう一度押すと 0 に戻る） */
export function starPicker(value, onChange) {
  let current = value ?? 0;
  const label = h('span', { class: 'md-star-label' });
  const words = ['未評価', 'いまいち', 'まあまあ', 'よかった', 'とてもよかった', '最高！'];
  const buttons = [1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button',
    class: 'md-star-btn',
    'aria-label': `☆${n}`,
    onClick: () => { current = current === n ? 0 : n; render(); onChange(current); },
  }));
  function render() {
    buttons.forEach((b, i) => {
      const on = i < current;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(i + 1 === current));
      b.replaceChildren(icon(on ? 'starFill' : 'star'));
    });
    label.textContent = words[current];
  }
  render();
  return h('div', { class: 'md-star-picker', role: 'group', 'aria-label': '評価' }, buttons, label);
}

/** 表紙・写真（なければ種類のアイコンと題名の入った代わりの絵） */
export function cover(item, { size = 'card' } = {}) {
  const kind = kindOf(item.kind);
  if (item.photo) return h('div', { class: `md-cover is-${size}`, 'data-kind': kind.id }, h('img', { src: item.photo, alt: `${item.title}の${kind.photoLabel}`, loading: 'lazy' }));
  return h('div', { class: `md-cover is-${size} is-blank`, 'data-kind': kind.id, 'aria-hidden': 'true' },
    icon(kind.icon),
    h('span', {}, item.title));
}

/** 'YYYY-MM-DD' → '2026年10月23日' */
export function dateText(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/** 本なら作者、映画ならどこで、場所ならエリア… の一言 */
export function subline(item) {
  if (item.kind === 'book') return item.creator;
  if (item.kind === 'movie') return item.where;
  if (item.kind === 'place') return item.area;
  return item.creator;
}
