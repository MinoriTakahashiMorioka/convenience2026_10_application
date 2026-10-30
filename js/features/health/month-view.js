import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { toDateKey } from '../../models/schema.js';
import { monthWeeks, shiftMonth } from '../diary/dates.js';
import { MOODS, average, formatSleep, sleepMinutes } from './repo.js';

/**
 * 月のカレンダー。1マスに「気分の顔」「睡眠時間」「体重」を小さく表示し、タップでその日の記録へ。
 */
export function mountMonthView(root, { repo, month, go }) {
  const today = toDateKey();
  const weeks = monthWeeks(month);
  const days = repo.between(`${month}-01`, `${month}-31`);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const [y, m] = month.split('-').map(Number);

  const faceOf = (v) => (v == null ? null : MOODS[Math.min(4, Math.max(0, Math.round(v) - 1))]);

  // その月のまとめ
  const sleeps = days.map(sleepMinutes).filter((v) => v != null);
  const moods = days.map((d) => average(d.mood)).filter((v) => v != null);
  const weights = days.filter((d) => d.weight != null);
  const avgSleep = sleeps.length ? Math.round(sleeps.reduce((a, b) => a + b, 0) / sleeps.length) : null;
  const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;

  const stat = (label, value, sub) => h('div', { class: 'hl-stat' }, h('span', {}, label), h('strong', {}, value), sub && h('small', {}, sub));

  const head = h('div', { class: 'hl-month-head' },
    h('button', { type: 'button', class: 'nav-btn', 'aria-label': '前の月', onClick: () => go(`month/${shiftMonth(month, -1)}`, { replace: true }) }, icon('chevronLeft')),
    h('h2', {}, h('small', {}, `${y}年`), `${m}月`),
    h('button', { type: 'button', class: 'nav-btn', 'aria-label': '次の月', disabled: month >= today.slice(0, 7), onClick: () => go(`month/${shiftMonth(month, 1)}`, { replace: true }) }, icon('chevronRight')),
    month !== today.slice(0, 7) && h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => go(`month/${today.slice(0, 7)}`, { replace: true }) }, '今月'),
  );

  const stats = h('div', { class: 'hl-stats' },
    stat('記録した日', `${days.length}日`),
    stat('平均の睡眠', avgSleep == null ? '—' : formatSleep(avgSleep), sleeps.length ? `${sleeps.length}日分` : null),
    stat('気分の平均', avgMood == null ? '—' : `${faceOf(avgMood).face} ${avgMood.toFixed(1)}`),
    stat('体重', weights.length ? `${weights.at(-1).weight.toFixed(1)}kg` : '—', weights.length > 1 ? `月初から ${signed(weights.at(-1).weight - weights[0].weight)}kg` : null),
  );

  const grid = h('div', { class: 'hl-cal', role: 'grid', 'aria-label': `${y}年${m}月の記録` },
    h('div', { class: 'hl-cal-row is-head', role: 'row' }, ['月', '火', '水', '木', '金', '土', '日'].map((w, i) => h('span', { role: 'columnheader', class: i === 5 ? 'is-sat' : i === 6 ? 'is-sun' : null }, w))),
    weeks.map((week) => h('div', { class: 'hl-cal-row', role: 'row' }, week.map((key) => {
      const d = byDate.get(key);
      const inMonth = key.startsWith(month);
      const mood = faceOf(average(d?.mood));
      const sleep = sleepMinutes(d);
      const future = key > today;
      const label = [`${Number(key.slice(8))}日`, mood && `気分 ${mood.name}`, sleep != null && `睡眠 ${formatSleep(sleep)}`, d?.weight != null && `体重 ${d.weight}kg`].filter(Boolean).join('、');
      return h('button', {
        type: 'button',
        role: 'gridcell',
        class: ['hl-cell', !inMonth && 'is-out', key === today && 'is-today', d && 'has-record', future && 'is-future'].filter(Boolean).join(' '),
        disabled: future,
        'aria-label': label,
        style: mood ? { '--mood': `var(--mood-${mood.value})` } : null,
        onClick: () => go(`day/${key}`),
      },
        h('span', { class: 'hl-cell-num' }, Number(key.slice(8))),
        mood && h('span', { class: 'hl-cell-face', 'aria-hidden': 'true' }, mood.face),
        sleep != null && h('span', { class: 'hl-cell-sleep' }, `${(sleep / 60).toFixed(1)}h`),
        d?.weight != null && h('span', { class: 'hl-cell-weight' }, d.weight.toFixed(1)),
        (d?.symptoms?.length ?? 0) > 0 && h('i', { class: 'hl-cell-sym', title: d.symptoms.join('・') }),
      );
    }))),
  );

  const legend = h('p', { class: 'hl-legend' },
    h('span', {}, '😄 気分'), h('span', {}, '7.5h 睡眠'), h('span', {}, '52.0 体重'), h('span', {}, h('i', { class: 'hl-cell-sym' }), ' 気になる症状あり'));

  root.append(h('div', { class: 'hl-month' }, head, stats, grid, legend));
  return () => {};
}

const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n * 10) / 10).toFixed(1)}`;
