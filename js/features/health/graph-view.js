import { h } from '../../core/dom.js';
import { toDateKey } from '../../models/schema.js';
import { addDays, shortLabel } from '../diary/dates.js';
import { CONDITIONS, MOODS, average, formatSleep, sleepMinutes } from './repo.js';
import { plannedSleep } from './links.js';
import { barChart, lineChart } from './charts.js';

/**
 * グラフ：睡眠時間・体重・気分と体調。期間は 7日 / 30日 / 90日。
 */

const RANGES = [7, 30, 90];

const md = (key) => { const [, m, d] = key.split('-').map(Number); return `${m}/${d}`; };
const hm = (mins) => { const m = ((Math.round(mins) % 1440) + 1440) % 1440; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}`;

export function mountGraphView(root, { repo, user }) {
  let range = RANGES.includes(repo.pref('range', 7)) ? repo.pref('range', 7) : 7;
  const cleanups = [];

  const chips = h('div', { class: 'hl-range', role: 'group', 'aria-label': '期間' },
    RANGES.map((n) => h('button', {
      type: 'button', class: 'chip chip-sm', 'data-n': n,
      onClick: () => { range = n; repo.setPref('range', n); },
    }, `${n}日`)));
  const body = h('div', { class: 'hl-graphs' });
  root.append(h('div', { class: 'hl-graph-view' }, chips, body));

  const section = (kind, title, stats, chart, extra) => h('section', { class: 'hl-graph', 'data-kind': kind },
    h('header', { class: 'hl-graph-head' }, h('h2', {}, title), h('div', { class: 'hl-graph-stats' }, stats)),
    chart, extra);
  const stat = (label, value) => h('div', { class: 'hl-mini' }, h('span', {}, label), h('strong', {}, value));
  const empty = (text) => h('p', { class: 'hl-graph-empty' }, text);
  const tip = (key, ...lines) => [h('strong', {}, shortLabel(key)), ...lines.map((l) => h('span', {}, l))];

  let rendering = false;
  function render() {
    // 描き直しの途中で入力欄が外れて change が起きることがあるので、重ねて描かない
    if (rendering) { queueMicrotask(render); return; }
    rendering = true;
    try { draw(); } finally { rendering = false; }
  }

  function draw() {
    for (const fn of cleanups.splice(0)) fn();
    for (const b of chips.children) b.setAttribute('aria-pressed', String(Number(b.dataset.n) === range));

    const today = toDateKey();
    const keys = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1));
    const days = new Map(repo.between(keys[0], today).map((d) => [d.date, d]));
    const labels = keys.map(md);

    // ---------- 睡眠 ----------
    const sleeps = keys.map((k) => sleepMinutes(days.get(k)));
    const recorded = sleeps.filter((v) => v != null);
    const plans = keys.map((k) => plannedSleep(user.id, k)).filter(Boolean);
    const planAvg = plans.length ? plans.reduce((a, p) => a + p.minutes, 0) / plans.length : null;
    const beds = keys.map((k) => days.get(k)?.bed).filter(Boolean).map((t) => { const [hh, mm] = t.split(':').map(Number); const v = hh * 60 + mm; return v < 12 * 60 ? v + 1440 : v; });
    const wakes = keys.map((k) => days.get(k)?.wake).filter(Boolean).map((t) => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; });
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const sleepChart = recorded.length
      ? barChart({
        className: 'is-sleep',
        ariaLabel: `睡眠時間のグラフ。平均 ${formatSleep(Math.round(mean(recorded)))}`,
        data: keys.map((k, i) => ({
          label: labels[i],
          value: sleeps[i] == null ? null : sleeps[i] / 60,
          tip: tip(k, sleeps[i] == null ? '記録なし' : `${formatSleep(sleeps[i])}（${days.get(k).bed}〜${days.get(k).wake}）`),
        })),
        format: (v) => `${v}h`,
        ref: planAvg ? { value: planAvg / 60, label: `ルーティンの予定 ${(planAvg / 60).toFixed(1)}h` } : null,
      })
      : empty('この期間の睡眠の記録はまだありません。');
    if (sleepChart.cleanup) cleanups.push(sleepChart.cleanup);

    // ---------- 体重 ----------
    const weights = keys.map((k) => days.get(k)?.weight ?? null);
    const wRecorded = weights.filter((v) => v != null);
    const goal = repo.pref('goalWeight', null);
    const weightChart = wRecorded.length
      ? lineChart({
        className: 'is-weight',
        ariaLabel: `体重のグラフ。最新 ${wRecorded.at(-1).toFixed(1)}kg`,
        labels,
        series: [{ name: '体重', cls: 's-weight', values: weights }],
        tips: keys.map((k, i) => tip(k, weights[i] == null ? '記録なし' : `${weights[i].toFixed(1)}kg`)),
        format: (v) => `${v}`,
        ref: goal ? { value: goal, label: `目安 ${goal}kg` } : null,
      })
      : empty('この期間の体重の記録はまだありません。');
    if (weightChart.cleanup) cleanups.push(weightChart.cleanup);

    const goalInput = h('input', { class: 'text-input hl-goal', type: 'number', step: '0.1', inputmode: 'decimal', value: goal ?? '', placeholder: '未設定', 'aria-label': '目安の体重（kg）' });
    goalInput.addEventListener('change', () => {
      const n = Number(goalInput.value);
      repo.setPref('goalWeight', goalInput.value && n >= 10 && n <= 300 ? Math.round(n * 10) / 10 : null);
    });

    // ---------- 気分・体調 ----------
    const moods = keys.map((k) => average(days.get(k)?.mood));
    const conds = keys.map((k) => average(days.get(k)?.condition));
    const anyFeel = moods.some((v) => v != null) || conds.some((v) => v != null);
    const name = (list, v) => (v == null ? '記録なし' : `${list[Math.round(v) - 1].name}（${v.toFixed(1)}）`);
    const feelChart = anyFeel
      ? lineChart({
        className: 'is-feel',
        ariaLabel: '気分と体調のグラフ（1 つらい 〜 5 とてもよい）',
        labels,
        series: [
          { name: '気分', cls: 's-mood', values: moods },
          { name: '体調', cls: 's-cond', values: conds },
        ],
        tips: keys.map((k, i) => tip(k, `気分 ${moods[i] == null ? '記録なし' : `${MOODS[Math.round(moods[i]) - 1].face} ${name(MOODS, moods[i])}`}`, `体調 ${name(CONDITIONS, conds[i])}`)),
        min: 1, max: 5, ticks: [1, 2, 3, 4, 5],
        format: (v) => ['', 'つらい', '', 'ふつう', '', 'よい'][v] ?? '',
      })
      : empty('この期間の気分・体調の記録はまだありません。');
    if (feelChart.cleanup) cleanups.push(feelChart.cleanup);

    // ---------- 症状 ----------
    const counts = new Map();
    for (const k of keys) for (const s of days.get(k)?.symptoms ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);
    const symptoms = [...counts].sort((a, b) => b[1] - a[1]);

    const mAvg = moods.filter((v) => v != null);
    const cAvg = conds.filter((v) => v != null);

    body.replaceChildren(
      section('sleep', '睡眠時間', [
        stat('平均', recorded.length ? formatSleep(Math.round(mean(recorded))) : '—'),
        stat('平均の就寝', beds.length ? hm(mean(beds)) : '—'),
        stat('平均の起床', wakes.length ? hm(mean(wakes)) : '—'),
      ], sleepChart),
      section('weight', '体重', [
        stat('最新', wRecorded.length ? `${wRecorded.at(-1).toFixed(1)}kg` : '—'),
        stat('期間の変化', wRecorded.length > 1 ? `${signed(wRecorded.at(-1) - wRecorded[0])}kg` : '—'),
        stat('はば', wRecorded.length > 1 ? `${Math.min(...wRecorded).toFixed(1)}〜${Math.max(...wRecorded).toFixed(1)}` : '—'),
      ], weightChart, h('label', { class: 'hl-goal-row' }, h('span', {}, '目安の線を引く'), goalInput, h('span', {}, 'kg'))),
      section('feel', '気分・体調', [
        stat('気分の平均', mAvg.length ? `${MOODS[Math.round(mean(mAvg)) - 1].face} ${mean(mAvg).toFixed(1)}` : '—'),
        stat('体調の平均', cAvg.length ? mean(cAvg).toFixed(1) : '—'),
      ], feelChart,
      anyFeel && h('p', { class: 'hl-key' },
        h('span', { class: 'hl-key-item s-mood' }, h('i'), '気分'),
        h('span', { class: 'hl-key-item s-cond' }, h('i'), '体調'),
        h('span', { class: 'hl-key-note' }, '1日の平均（朝・昼・夜）'))),
      section('symptoms', '気になったこと', [],
        symptoms.length
          ? h('ul', { class: 'hl-sym-list' }, symptoms.map(([s, n]) => h('li', {}, h('span', {}, s), h('span', { class: 'hl-sym-bar', style: { '--w': `${(n / symptoms[0][1]) * 100}%` } }), h('strong', {}, `${n}日`))))
          : empty('この期間はありません。')),
    );
  }

  render();
  const unsubscribe = repo.subscribe(render);
  return () => { unsubscribe(); for (const fn of cleanups) fn(); };
}
