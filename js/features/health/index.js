import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { defineFeature } from '../../core/feature.js';
import { toDateKey } from '../../models/schema.js';
import { addDays, isDateKey, isMonthKey } from '../diary/dates.js';
import { MOODS, average, createHealthRepo, formatSleep, sleepMinutes } from './repo.js';
import { mountDayView } from './day-view.js';
import { mountMonthView } from './month-view.js';
import { mountGraphView } from './graph-view.js';

/**
 * 体調ログ（体調・コンディションの記録）
 *
 *   index.js       … ハブ・カレンダーに出す情報、表示の切り替え（このファイル）
 *   repo.js        … 記録のデータ（1日1件）、気分・体調の段階
 *   links.js       … ルーティンの睡眠予定・カレンダーの予定を読む
 *   day-view.js    … 1日の記録（入力と閲覧。自動保存）
 *   month-view.js  … 月のカレンダー
 *   graph-view.js  … 睡眠・体重・気分と体調のグラフ
 *   charts.js      … グラフ部品（SVG）
 *
 * 画面のURL
 *   #/app/health/day/2026-10-23   その日の記録
 *   #/app/health/month/2026-10    月のカレンダー
 *   #/app/health/graphs           グラフ
 */

const VIEWS = [
  { id: 'day', label: '記録', icon: 'pencil' },
  { id: 'month', label: 'カレンダー', icon: 'calendar' },
  { id: 'graphs', label: 'グラフ', icon: 'chart' },
];

/** demo アカウントにだけ、ここ3週間ほどのサンプルを入れる（初回のみ） */
function seedDemo(ctx, repo) {
  if (ctx.user.id !== 'demo' || ctx.store.get('demoSeeded', false)) return;
  ctx.store.set('demoSeeded', true);
  if (repo.count() > 0) return;
  const today = toDateKey();
  const pad = (n) => String(n).padStart(2, '0');
  const time = (mins) => `${pad(Math.floor(((mins % 1440) + 1440) % 1440 / 60))}:${pad(((mins % 60) + 60) % 60)}`;
  // 決まった並びの「ゆらぎ」（毎回同じサンプルになるように乱数は使わない）
  const wiggle = [0, 20, -15, 35, -30, 10, 45, -5, 25, -20, 60, 0, -40, 15, 30, -10, 5, 50, -25, 20, 0];
  for (let i = 20; i >= 1; i--) {
    if (i === 6 || i === 13) continue; // つけ忘れた日
    const date = addDays(today, -i);
    const w = wiggle[i];
    const bed = 23 * 60 + 15 + w;
    const wake = 6 * 60 + 30 + Math.round(w / 3);
    const good = w < 20;
    repo.patch(date, {
      bed: time(bed),
      wake: time(wake),
      sleepQuality: w > 40 ? 1 : good ? 3 : 2,
      weight: Math.round((52.6 + Math.sin(i / 3) * 0.5 - (20 - i) * 0.02) * 10) / 10,
      mood: { morning: good ? 4 : 3, night: w > 40 ? 2 : good ? 4 : 3, ...(i % 3 === 0 ? { noon: 5 } : {}) },
      condition: { morning: w > 40 ? 2 : 4, night: good ? 4 : 3 },
      symptoms: w > 40 ? ['眠い', 'だるい'] : i % 7 === 2 ? ['頭痛'] : [],
      note: w > 40 ? '寝るのが遅くなって一日中眠かった。' : i % 7 === 2 ? '昼すぎに頭痛。水を飲んで少し休んだら楽になった。' : '',
    });
  }
}

/** ハブ・カレンダー用のひとこと */
function describe(day) {
  const parts = [];
  const sleep = sleepMinutes(day);
  if (sleep != null) parts.push(`睡眠 ${formatSleep(sleep)}`);
  const mood = average(day.mood);
  if (mood != null) parts.push(`気分 ${MOODS[Math.round(mood) - 1].face}`);
  if (day.weight != null) parts.push(`${day.weight.toFixed(1)}kg`);
  if (day.symptoms?.length) parts.push(day.symptoms.join('・'));
  return parts.join('・') || 'メモあり';
}

export default defineFeature({
  id: 'health',
  title: '体調ログ',
  subtitle: '睡眠・体重・気分・体調',
  icon: 'pulse',
  color: '#2C7FB8',
  keywords: ['体調', 'コンディション', '睡眠', '体重', '気分', '健康', 'たいちょう', 'すいみん', 'ログ'],

  summary(ctx) {
    const repo = createHealthRepo(ctx.store);
    seedDemo(ctx, repo);
    const today = repo.get(toDateKey());
    const streak = repo.streak(toDateKey());
    const head = today ? `今日 ${describe(today)}` : '今日はまだ記録していません';
    return streak > 1 ? `${head}・${streak}日連続` : head;
  },

  dayInfo(ctx, date) {
    const day = createHealthRepo(ctx.store).get(date);
    return day ? [{ title: describe(day), detail: day.note || null, href: `/app/health/day/${date}` }] : [];
  },

  recordDates(ctx) {
    return new Set(createHealthRepo(ctx.store).dates());
  },

  mount(root, ctx) {
    const repo = createHealthRepo(ctx.store);
    seedDemo(ctx, repo);
    const today = toDateKey();

    const [viewId, param] = (ctx.subpath || '').split('/');
    const view = VIEWS.find((v) => v.id === viewId);
    const valid = view && (view.id === 'graphs' || (view.id === 'day' && isDateKey(param)) || (view.id === 'month' && isMonthKey(param)));
    if (!valid) {
      const last = view?.id ?? repo.pref('view', 'day');
      const sub = { day: `day/${today}`, month: `month/${today.slice(0, 7)}`, graphs: 'graphs' }[last] ?? `day/${today}`;
      queueMicrotask(() => ctx.go(sub, { replace: true }));
      return () => {};
    }
    repo.setPref('view', view.id);

    const tabs = h('div', { class: 'tabs hl-tabs', role: 'tablist', 'aria-label': '表示' },
      VIEWS.map((v) => h('button', {
        type: 'button', role: 'tab', class: 'tab',
        'aria-selected': String(v.id === view.id),
        tabIndex: v.id === view.id ? 0 : -1,
        onClick: () => {
          if (v.id === view.id) return;
          const anchor = view.id === 'day' ? param : today;
          ctx.go({ day: `day/${view.id === 'month' ? today : anchor}`, month: `month/${anchor.slice(0, 7)}`, graphs: 'graphs' }[v.id], { replace: true });
        },
      }, icon(v.icon), h('span', {}, v.label))));

    const panel = h('section', { class: 'hl-panel', role: 'tabpanel' });
    root.append(h('div', { class: 'hl' }, tabs, panel));

    // 日の画面は「戻る」で月に戻れるよう履歴に積む。タブの切り替えは積まない
    const go = (sub, options) => ctx.go(sub, options);
    if (view.id === 'day') return mountDayView(panel, { repo, user: ctx.user, date: param, go });
    if (view.id === 'month') return mountMonthView(panel, { repo, month: param, go });
    return mountGraphView(panel, { repo, user: ctx.user });
  },
});
