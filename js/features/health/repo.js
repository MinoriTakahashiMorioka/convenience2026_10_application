/**
 * 体調・コンディションログのデータ。1日に1件（日付がキー）。
 *
 * @typedef {Object} HealthDay
 * @property {string} date               'YYYY-MM-DD'（起きた日。前の晩に寝て、この日の朝に起きた分の睡眠）
 * @property {string | null} bed         就寝 'HH:MM'
 * @property {string | null} wake        起床 'HH:MM'
 * @property {1 | 2 | 3 | null} sleepQuality  1 浅い / 2 ふつう / 3 ぐっすり
 * @property {number | null} weight      体重 kg（小数1けた）
 * @property {{ morning?: number, noon?: number, night?: number }} mood       気分 1〜5（時間帯ごと）
 * @property {{ morning?: number, noon?: number, night?: number }} condition  体調 1〜5（時間帯ごと）
 * @property {string[]} symptoms         気になる症状
 * @property {string} note               メモ
 * @property {string} updatedAt
 */

export const TIMES = [
  { id: 'morning', name: '朝' },
  { id: 'noon', name: '昼' },
  { id: 'night', name: '夜' },
];

export const MOODS = [
  { value: 1, face: '😣', name: 'つらい' },
  { value: 2, face: '😟', name: 'いまいち' },
  { value: 3, face: '😐', name: 'ふつう' },
  { value: 4, face: '🙂', name: 'よい' },
  { value: 5, face: '😄', name: 'とてもよい' },
];

export const CONDITIONS = [
  { value: 1, name: 'つらい' },
  { value: 2, name: 'いまいち' },
  { value: 3, name: 'ふつう' },
  { value: 4, name: 'よい' },
  { value: 5, name: '絶好調' },
];

export const QUALITIES = [
  { value: 3, name: 'ぐっすり' },
  { value: 2, name: 'ふつう' },
  { value: 1, name: '浅い' },
];

export const SYMPTOMS = ['頭痛', 'だるい', '眠い', '腹痛', '肩こり', '鼻水・せき', '熱っぽい', '食欲がない', '生理', 'ストレス'];

export const NOTE_MAX = 200;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 就寝〜起床の分数（日付をまたいでも OK）。どちらかがなければ null */
export function sleepMinutes(day) {
  if (!day?.bed || !day?.wake) return null;
  const [bh, bm] = day.bed.split(':').map(Number);
  const [wh, wm] = day.wake.split(':').map(Number);
  const diff = wh * 60 + wm - (bh * 60 + bm);
  return diff > 0 ? diff : diff + 1440;
}

/** 時間帯ごとの値の平均（記録がなければ null） */
export function average(byTime) {
  const values = Object.values(byTime ?? {}).filter((v) => typeof v === 'number');
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** 450 → '7時間30分' */
export function formatSleep(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

const isEmpty = (d) => !d.bed && !d.wake && d.sleepQuality == null && d.weight == null
  && !Object.keys(d.mood ?? {}).length && !Object.keys(d.condition ?? {}).length
  && !(d.symptoms ?? []).length && !d.note;

/** @param {ReturnType<import('../../core/storage.js').createStore>} store */
export function createHealthRepo(store) {
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };

  /** @returns {Record<string, HealthDay>} */
  const read = () => {
    const v = store.get('days', {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };
  let saveFailed = false;
  const write = (days) => { saveFailed = !store.set('days', days); emit(); };

  function clean(date, input) {
    const out = { date };
    out.bed = TIME.test(input.bed ?? '') ? input.bed : null;
    out.wake = TIME.test(input.wake ?? '') ? input.wake : null;
    out.sleepQuality = [1, 2, 3].includes(input.sleepQuality) ? input.sleepQuality : null;
    const w = input.weight == null || input.weight === '' ? null : Number(input.weight);
    if (w != null && (!Number.isFinite(w) || w < 10 || w > 300)) throw new Error('体重は 10〜300kg の間で入力してください。');
    out.weight = w == null ? null : Math.round(w * 10) / 10;
    const levels = (obj) => Object.fromEntries(TIMES.map((t) => [t.id, obj?.[t.id]]).filter(([, v]) => Number.isInteger(v) && v >= 1 && v <= 5));
    out.mood = levels(input.mood);
    out.condition = levels(input.condition);
    out.symptoms = [...new Set((input.symptoms ?? []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 12)))];
    out.note = String(input.note ?? '').slice(0, NOTE_MAX * 2);
    if ([...out.note].length > NOTE_MAX) out.note = [...out.note].slice(0, NOTE_MAX).join('');
    out.updatedAt = new Date().toISOString();
    return out;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** 直前の保存が端末の容量不足などで失敗したか */
    get saveFailed() { return saveFailed; },

    /** @returns {HealthDay | null} */
    get(date) {
      return read()[date] ?? null;
    },

    /** その日の記録の一部を書きかえる（空になったら消す） */
    patch(date, changes) {
      const days = read();
      const next = clean(date, { ...(days[date] ?? {}), ...changes });
      if (isEmpty(next)) delete days[date];
      else days[date] = next;
      write(days);
      return days[date] ?? null;
    },

    remove(date) {
      const days = read();
      delete days[date];
      write(days);
    },

    count() {
      return Object.keys(read()).length;
    },

    /** 記録のある日付（新しい順） */
    dates() {
      return Object.keys(read()).sort().reverse();
    },

    /** from〜to（両端を含む）の記録を日付順で */
    between(from, to) {
      return Object.values(read()).filter((d) => d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    },

    /** date より前でいちばん新しい体重の記録 */
    previousWeight(date) {
      return Object.values(read())
        .filter((d) => d.date < date && d.weight != null)
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    },

    /** 今日までの連続記録日数 */
    streak(today) {
      const days = read();
      let n = 0;
      const d = new Date(`${today}T00:00:00`);
      const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      if (!days[key(d)]) d.setDate(d.getDate() - 1); // 今日がまだでも昨日まで続いていれば数える
      while (days[key(d)]) { n++; d.setDate(d.getDate() - 1); }
      return n;
    },

    pref(key, fallback) { return store.get(`pref.${key}`, fallback); },
    setPref(key, value) { store.set(`pref.${key}`, value); emit(); },
  };
}
