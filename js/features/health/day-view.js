import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { router } from '../../core/router.js';
import { dayLinksSection } from '../../core/day-links.js';
import { toDateKey } from '../../models/schema.js';
import { addDays, longLabel } from '../diary/dates.js';
import {
  CONDITIONS, MOODS, NOTE_MAX, QUALITIES, SYMPTOMS, TIMES, formatSleep, sleepMinutes,
} from './repo.js';
import { plannedSleep } from './links.js';

/**
 * 1日分の記録（入力と閲覧を兼ねる）。
 * 入れたそばから自動で保存されます（保存ボタンなし）。
 */
export function mountDayView(root, { repo, user, date, go }) {
  const today = toDateKey();
  let day = repo.get(date) ?? {};
  const plan = plannedSleep(user.id, date);

  // ---------- 保存と「保存しました」 ----------
  const status = h('p', { class: 'hl-status', role: 'status' });
  let statusTimer = null;
  function save(changes) {
    try {
      day = repo.patch(date, changes) ?? {};
      if (repo.saveFailed) {
        status.dataset.state = 'error';
        status.replaceChildren(icon('alert'), '端末に保存できませんでした（容量がいっぱいかもしれません）');
      } else {
        status.dataset.state = 'ok';
        status.replaceChildren(icon('check'), '保存しました');
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => { status.dataset.state = ''; }, 1600);
      }
    } catch (err) {
      status.dataset.state = 'error';
      status.replaceChildren(icon('alert'), err.message);
    }
    refresh();
  }

  // ---------- 日付の切り替え ----------
  const jump = h('input', { class: 'text-input hl-jump', type: 'date', value: date, max: today, 'aria-label': '日付を選ぶ' });
  jump.addEventListener('change', () => { if (jump.value) go(`day/${jump.value}`, { replace: true }); });
  const nav = h('div', { class: 'hl-daynav' },
    h('button', { type: 'button', class: 'nav-btn', 'aria-label': '前の日', onClick: () => go(`day/${addDays(date, -1)}`, { replace: true }) }, icon('chevronLeft')),
    h('div', { class: 'hl-daytitle' },
      h('h2', {}, longLabel(date)),
      jump,
    ),
    h('button', { type: 'button', class: 'nav-btn', 'aria-label': '次の日', disabled: date >= today, onClick: () => go(`day/${addDays(date, 1)}`, { replace: true }) }, icon('chevronRight')),
    date !== today && h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => go(`day/${today}`, { replace: true }) }, '今日'),
  );

  if (date > today) {
    root.append(h('div', { class: 'hl-day' }, nav, h('p', { class: 'hl-future' }, 'まだ来ていない日です。今日までの記録をつけられます。')));
    return () => {};
  }

  const card = (kind, title, sub, ...body) => h('section', { class: 'hl-card', 'data-kind': kind, 'aria-label': title },
    h('header', { class: 'hl-card-head' },
      h('span', { class: 'hl-card-icon' }, icon({ sleep: 'moon', weight: 'scale', mood: 'smile', condition: 'pulse', note: 'pencil' }[kind])),
      h('h3', {}, title),
      sub && h('small', {}, sub),
    ),
    ...body);

  // ---------- 睡眠 ----------
  const bed = h('input', { class: 'text-input hl-time', type: 'time', value: day.bed ?? '', 'aria-label': '寝た時刻' });
  const wake = h('input', { class: 'text-input hl-time', type: 'time', value: day.wake ?? '', 'aria-label': '起きた時刻' });
  bed.addEventListener('change', () => save({ bed: bed.value || null }));
  wake.addEventListener('change', () => save({ wake: wake.value || null }));
  const sleepTotal = h('p', { class: 'hl-big' });
  const sleepDiff = h('p', { class: 'hl-diff' });
  const qualityBtns = QUALITIES.map((q) => h('button', {
    type: 'button', class: 'hl-chip', 'data-value': q.value,
    onClick: () => save({ sleepQuality: day.sleepQuality === q.value ? null : q.value }),
  }, q.name));

  const planBox = plan
    ? h('div', { class: 'hl-plan' },
      h('p', {}, h('span', { class: 'hl-plan-tag' }, 'ルーティン'), `${plan.bed} 〜 ${plan.wake}（${formatSleep(plan.minutes)}）`),
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onClick: () => { bed.value = plan.bed; wake.value = plan.wake; save({ bed: plan.bed, wake: plan.wake }); },
      }, icon('check'), '予定どおりに入れる'))
    : h('p', { class: 'hl-plan is-empty' },
      'ルーティンに「睡眠」の予定を入れると、ここに目安が出て、ワンタップで入力できます。',
      h('button', { type: 'button', class: 'hl-link', onClick: () => router.navigate('/app/routine') }, 'ルーティンを開く'));

  const sleepCard = card('sleep', '睡眠', '前の夜に寝て、この日の朝に起きた分',
    sleepTotal,
    h('div', { class: 'hl-times' },
      h('label', {}, h('span', {}, '寝た'), bed),
      h('span', { class: 'hl-arrow', 'aria-hidden': 'true' }, '→'),
      h('label', {}, h('span', {}, '起きた'), wake),
    ),
    sleepDiff,
    planBox,
    h('div', { class: 'hl-row' }, h('span', { class: 'hl-row-label' }, '眠りの深さ'), h('div', { class: 'hl-chips' }, qualityBtns)),
  );

  // ---------- 体重 ----------
  const weight = h('input', {
    class: 'text-input hl-weight', type: 'number', inputmode: 'decimal', step: '0.1', min: '10', max: '300',
    value: day.weight ?? '', placeholder: '0.0', 'aria-label': '体重（kg）',
  });
  weight.addEventListener('change', () => save({ weight: weight.value === '' ? null : Number(weight.value) }));
  weight.addEventListener('keydown', (e) => { if (e.key === 'Enter') weight.blur(); });
  const weightPrev = h('p', { class: 'hl-diff' });
  const weightCard = card('weight', '体重', null,
    h('div', { class: 'hl-weight-row' }, weight, h('span', { class: 'hl-unit' }, 'kg')),
    weightPrev,
  );

  // ---------- 気分・体調（朝・昼・夜） ----------
  function levelRows(key, options, render) {
    return h('div', { class: 'hl-levels' }, TIMES.map((t) => h('div', { class: 'hl-level-row', role: 'group', 'aria-label': `${t.name}の${key === 'mood' ? '気分' : '体調'}` },
      h('span', { class: 'hl-row-label' }, t.name),
      h('div', { class: 'hl-level-btns' }, options.map((o) => h('button', {
        type: 'button',
        class: `hl-level is-${key}`,
        'data-key': key, 'data-time': t.id, 'data-value': o.value,
        title: o.name,
        'aria-label': o.name,
        onClick: () => {
          const current = { ...(day[key] ?? {}) };
          if (current[t.id] === o.value) delete current[t.id]; else current[t.id] = o.value;
          save({ [key]: current });
        },
      }, render(o)))),
    )));
  }
  const moodChange = h('p', { class: 'hl-change' });
  const condChange = h('p', { class: 'hl-change' });
  const moodCard = card('mood', '気分', '朝・昼・夜でつけられます（同じものをもう一度押すと消える）',
    levelRows('mood', MOODS, (o) => h('span', { class: 'hl-face' }, o.face)),
    moodChange,
  );
  const symptomBtns = SYMPTOMS.map((name) => h('button', {
    type: 'button', class: 'hl-chip is-symptom', 'data-name': name,
    onClick: () => {
      const set = new Set(day.symptoms ?? []);
      if (set.has(name)) set.delete(name); else set.add(name);
      save({ symptoms: [...set] });
    },
  }, name));
  const condCard = card('condition', '体調', null,
    levelRows('condition', CONDITIONS, (o) => h('span', { class: 'hl-num' }, o.value, h('small', {}, o.name))),
    condChange,
    h('div', { class: 'hl-row is-top' }, h('span', { class: 'hl-row-label' }, '気になること'), h('div', { class: 'hl-chips' }, symptomBtns)),
  );

  // ---------- メモ ----------
  const note = h('textarea', { class: 'text-input hl-note', rows: 3, maxlength: String(NOTE_MAX), placeholder: '体調や気分の変化で気づいたこと（例: 昼すぎに頭痛、薬を飲んだら楽になった）', 'aria-label': 'メモ' });
  note.value = day.note ?? '';
  const noteCount = h('span', { class: 'char-count' });
  let noteTimer = null;
  note.addEventListener('input', () => {
    noteCount.textContent = `${[...note.value].length}/${NOTE_MAX}`;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => save({ note: note.value }), 600);
  });
  note.addEventListener('blur', () => { clearTimeout(noteTimer); if ((day.note ?? '') !== note.value) save({ note: note.value }); });
  const noteCard = card('note', 'メモ', null, note, h('div', { class: 'hl-note-foot' }, noteCount));

  // ---------- 消す ----------
  const danger = h('div', { class: 'hl-danger' });
  function renderDanger() {
    danger.hidden = !repo.get(date);
    danger.replaceChildren(h('button', { type: 'button', class: 'btn btn-danger-text btn-sm', onClick: askClear }, icon('trash'), 'この日の記録をすべて消す'));
  }
  function askClear() {
    danger.replaceChildren(
      h('p', { class: 'confirm-text' }, `${longLabel(date)}の記録をすべて消しますか？`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: renderDanger }, 'やめる'),
      h('button', {
        type: 'button', class: 'btn btn-danger btn-sm',
        onClick: () => {
          repo.remove(date);
          day = {};
          bed.value = ''; wake.value = ''; weight.value = ''; note.value = '';
          refresh();
        },
      }, '消す'),
    );
  }

  // ---------- 表示の更新（入力欄はそのまま、数字や選択状態だけ直す） ----------
  function refresh() {
    const mins = sleepMinutes(day);
    sleepTotal.replaceChildren(mins == null ? h('span', { class: 'is-empty' }, '寝た時刻と起きた時刻を入れてください') : formatSleep(mins));
    sleepDiff.replaceChildren();
    if (mins != null && plan) {
      const d = mins - plan.minutes;
      sleepDiff.append(Math.abs(d) < 10 ? 'ルーティンの予定どおり' : `ルーティンの予定より ${formatSleep(Math.abs(d))} ${d > 0 ? '長い' : '短い'}`);
      sleepDiff.dataset.tone = Math.abs(d) < 10 ? 'ok' : d < -60 ? 'short' : '';
    }
    for (const b of qualityBtns) b.setAttribute('aria-pressed', String(day.sleepQuality === Number(b.dataset.value)));

    const prev = repo.previousWeight(date);
    weightPrev.replaceChildren();
    if (prev) {
      const [, m, d] = prev.date.split('-').map(Number);
      const diff = day.weight != null ? Math.round((day.weight - prev.weight) * 10) / 10 : null;
      weightPrev.append(`前回 ${prev.weight.toFixed(1)}kg（${m}/${d}）`, diff != null ? ` から ${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff).toFixed(1)}kg` : '');
    }

    for (const btn of root.querySelectorAll('.hl-level')) {
      btn.setAttribute('aria-pressed', String(day[btn.dataset.key]?.[btn.dataset.time] === Number(btn.dataset.value)));
    }
    const changeText = (key, list, fmt) => {
      const marks = TIMES.filter((t) => day[key]?.[t.id]).map((t) => `${t.name} ${fmt(list.find((o) => o.value === day[key][t.id]))}`);
      return marks.length > 1 ? `変化：${marks.join(' → ')}` : '';
    };
    moodChange.textContent = changeText('mood', MOODS, (o) => o.face);
    condChange.textContent = changeText('condition', CONDITIONS, (o) => o.name);
    for (const b of symptomBtns) b.setAttribute('aria-pressed', String((day.symptoms ?? []).includes(b.dataset.name)));
    noteCount.textContent = `${[...note.value].length}/${NOTE_MAX}`;
    renderDanger();
  }

  root.append(h('div', { class: 'hl-day' },
    nav,
    status,
    h('div', { class: 'hl-cards' }, sleepCard, moodCard, weightCard, condCard, noteCard),
    dayLinksSection(date, { exclude: 'health', emptyText: 'この日の予定・日記・エンタメ記録はありません' }),
    danger,
  ));
  refresh();

  return () => { clearTimeout(noteTimer); clearTimeout(statusTimer); if ((day.note ?? '') !== note.value) repo.patch(date, { note: note.value }); };
}
