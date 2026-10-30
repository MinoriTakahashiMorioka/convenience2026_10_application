import { h } from './dom.js';
import { icon } from './icons.js';
import { router } from './router.js';
import { makeContext } from './context.js';
import { FEATURES } from './registry.js';

/**
 * 機能どうしの「日付でつながる」しくみ。
 *
 * 機能の定義（defineFeature）に次の2つを書くと、カレンダーや日記の「この日の記録」に出てきます。
 *   dayInfo(ctx, '2026-10-23') → [{ title, detail, href, icon? }]   その日の記録（なければ []）
 *   recordDates(ctx)           → Set<'YYYY-MM-DD'>                    記録のある日（カレンダーの印に使う）
 *
 * ほかの機能のデータは「読むだけ」。書きかえはそれぞれの機能の画面で行います。
 */

const providers = (exclude) => FEATURES.filter((f) => f.id !== exclude && typeof f.dayInfo === 'function');

/** その日の、ほかの機能の記録 */
export function dayLinks(date, { exclude } = {}) {
  return providers(exclude).flatMap((feature) => {
    try {
      return (feature.dayInfo(makeContext(feature), date) ?? []).map((item) => ({ ...item, feature }));
    } catch (error) {
      console.error(error);
      return [];
    }
  });
}

/** 記録のある日付（機能ごと） @returns {{ feature, dates: Set<string> }[]} */
export function recordDates({ exclude } = {}) {
  return FEATURES.filter((f) => f.id !== exclude && typeof f.recordDates === 'function').map((feature) => {
    try {
      return { feature, dates: feature.recordDates(makeContext(feature)) };
    } catch (error) {
      console.error(error);
      return { feature, dates: new Set() };
    }
  });
}

/**
 * 「この日のほかの記録」の一覧
 * @param {string} date
 * @param {{ exclude?: string, title?: string, emptyText?: string | null, skip?: (item) => boolean }} [options]
 *        emptyText を null にすると、記録がないときは何も出さない
 */
export function dayLinksSection(date, { exclude, title = 'この日のほかの記録', emptyText = 'ほかの機能の記録はありません', skip } = {}) {
  const items = dayLinks(date, { exclude }).filter((item) => !skip?.(item));
  if (!items.length && emptyText == null) return null;
  return h('section', { class: 'day-links', 'aria-label': title },
    h('h3', { class: 'day-links-title' }, icon('list'), title),
    items.length
      ? h('ul', { class: 'day-links-list' }, items.map((item) => h('li', {},
        h('button', {
          type: 'button',
          class: 'day-link',
          style: { '--feature': item.feature.color },
          onClick: () => router.navigate(item.href),
        },
          item.image
            ? h('img', { class: 'day-link-img', src: item.image, alt: '' })
            : h('span', { class: 'day-link-icon' }, icon(item.icon ?? item.feature.icon)),
          h('span', { class: 'day-link-body' },
            h('span', { class: 'day-link-feature' }, item.label ?? item.feature.title),
            h('span', { class: 'day-link-title' }, item.title),
            item.detail && h('span', { class: 'day-link-detail' }, item.detail),
          ),
          h('span', { class: 'day-link-chev' }, icon('chevronRight')),
        ))))
      : h('p', { class: 'day-links-empty' }, emptyText),
  );
}
