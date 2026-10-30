import { createStore } from '../../core/storage.js';
import { createRoutineRepo } from '../routine/repo.js';
import { createCalendarRepo } from '../calendar/repo.js';

/**
 * ほかの機能のデータを「読むだけ」で使うための窓口。
 *  - ルーティンの「睡眠」の予定 → 睡眠の目安（就寝・起床）
 *  - カレンダーの予定 → その日の予定の件数
 * ほかの機能のデータは書きかえません。
 */

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const wraps = (b) => toMin(b.end) <= toMin(b.start);
const length = (b) => (wraps(b) ? toMin(b.end) + 1440 - toMin(b.start) : toMin(b.end) - toMin(b.start));

function shift(date, days) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ルーティンをまだ使っていなければ null（勝手に初期データを作らないため） */
function routineRepo(userId) {
  const store = createStore(`u:${userId}:routine`);
  const patterns = store.get('patterns', null);
  if (!Array.isArray(patterns) || !patterns.length) return null;
  return createRoutineRepo(store);
}

/** パターンの中の「夜の睡眠」（日付をまたぐか、午前中に始まる睡眠のうち一番長いもの） */
function nightSleep(pattern) {
  return (pattern?.blocks ?? [])
    .filter((b) => b.category === 'sleep' && (wraps(b) || toMin(b.start) < 12 * 60))
    .sort((a, b) => length(b) - length(a))[0] ?? null;
}

/**
 * その日の朝に起きる分の、ルーティン上の睡眠予定
 * 就寝は前の日のパターン、起床はその日のパターンから取る（平日と休日で起きる時間が違っても合う）
 * @returns {{ bed: string, wake: string, minutes: number, patternName: string } | null}
 */
export function plannedSleep(userId, date) {
  const repo = routineRepo(userId);
  if (!repo) return null;
  const today = repo.pattern(repo.patternFor(date).patternId);
  const yesterday = repo.pattern(repo.patternFor(shift(date, -1)).patternId);
  const wakeBlock = nightSleep(today);
  if (!wakeBlock) return null;
  const prevBlock = nightSleep(yesterday);
  const bed = prevBlock && wraps(prevBlock) ? prevBlock.start : wakeBlock.start;
  const wake = wakeBlock.end;
  let minutes = toMin(wake) - toMin(bed);
  if (minutes <= 0) minutes += 1440;
  return { bed, wake, minutes, patternName: today.name };
}

/** その日のカレンダーの予定 */
export function calendarEvents(userId, date) {
  const store = createStore(`u:${userId}:calendar`);
  if (!Array.isArray(store.get('events', null))) return [];
  return createCalendarRepo(store).eventsOn(date);
}
