import { h } from '../../core/dom.js';

/**
 * 小さなグラフ部品（SVG）。外部ライブラリなし。
 *  - 入れ物の幅に合わせて描き直す（スマホでも文字が小さくならない）
 *  - 棒・点に指やマウスを乗せると、その日の値が吹き出しで出る
 *  - 線は 2px、棒の先は角丸、目盛り線は薄く
 */

const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const PAD = { top: 14, right: 12, bottom: 26, left: 40 };
const HEIGHT = 200;

/** 入れ物の幅が変わったら draw(width) を呼び直す */
function responsive(wrap, draw) {
  let last = 0;
  const run = () => {
    const w = Math.round(wrap.clientWidth);
    if (!w || w === last) return;
    last = w;
    draw(w);
  };
  const ro = new ResizeObserver(run);
  ro.observe(wrap);
  requestAnimationFrame(run);
  return () => ro.disconnect();
}

/** 吹き出しと、列ごとの当たり判定 */
function hoverLayer(wrap, svg, { xs, step, plotTop, plotBottom, tips, onFocus }) {
  const tip = h('div', { class: 'ch-tip', role: 'status', hidden: true });
  const guide = s('line', { class: 'ch-guide', y1: plotTop, y2: plotBottom, visibility: 'hidden' });
  svg.append(guide);
  const show = (i) => {
    if (i == null || !tips[i]) { tip.hidden = true; guide.setAttribute('visibility', 'hidden'); onFocus?.(null); return; }
    tip.replaceChildren(...tips[i]);
    tip.hidden = false;
    guide.setAttribute('x1', xs[i]);
    guide.setAttribute('x2', xs[i]);
    guide.setAttribute('visibility', 'visible');
    const left = Math.min(Math.max(xs[i], 60), wrap.clientWidth - 60);
    tip.style.left = `${left}px`;
    onFocus?.(i);
  };
  xs.forEach((x, i) => {
    svg.append(s('rect', {
      class: 'ch-hit', x: x - step / 2, y: plotTop, width: Math.max(step, 1), height: plotBottom - plotTop,
      'data-i': i,
    }));
  });
  svg.addEventListener('pointermove', (e) => { const i = e.target.dataset?.i; if (i != null) show(Number(i)); });
  svg.addEventListener('pointerdown', (e) => { const i = e.target.dataset?.i; if (i != null) show(Number(i)); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(null); });
  wrap.append(tip);
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** x 軸のラベルを、重ならない間隔だけ出す */
function xLabels(svg, xs, labels, width, y) {
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor((width - PAD.left - PAD.right) / 46))));
  const last = labels.length - 1;
  labels.forEach((label, i) => {
    // 一定の間隔ごと＋最後の日（前のラベルと近すぎなければ）
    const show = i % every === 0 || (i === last && last % every >= every / 2);
    if (!show) return;
    svg.append(s('text', { class: 'ch-x', x: xs[i], y, 'text-anchor': 'middle' }, label));
  });
}

/**
 * 棒グラフ
 * @param {Object} o
 * @param {{ label: string, value: number | null, tip: Node[] }[]} o.data
 * @param {(v: number) => string} o.format   目盛りの表示
 * @param {number} [o.min] [o.max]
 * @param {{ value: number, label: string }} [o.ref]  目安の点線
 * @param {string} o.ariaLabel
 */
export function barChart({ data, format, min = 0, max, ref, ariaLabel, className = '' }) {
  const wrap = h('div', { class: `ch ${className}`, role: 'img', 'aria-label': ariaLabel });
  const stop = responsive(wrap, (width) => {
    const values = data.map((d) => d.value).filter((v) => v != null);
    const top = Math.max(max ?? 0, ...values, ref?.value ?? 0) || 1;
    const ticks = niceTicks(min, top);
    const yMax = ticks.at(-1);
    const plotTop = PAD.top;
    const plotBottom = HEIGHT - PAD.bottom;
    const y = (v) => plotBottom - ((v - min) / (yMax - min)) * (plotBottom - plotTop);
    const step = (width - PAD.left - PAD.right) / data.length;
    const xs = data.map((_, i) => PAD.left + step * (i + 0.5));
    const barW = Math.max(2, Math.min(28, step * 0.62));

    const svg = s('svg', { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, class: 'ch-svg' });
    for (const t of ticks) {
      svg.append(s('line', { class: 'ch-grid', x1: PAD.left, x2: width - PAD.right, y1: y(t), y2: y(t) }));
      svg.append(s('text', { class: 'ch-y', x: PAD.left - 6, y: y(t) + 4, 'text-anchor': 'end' }, format(t)));
    }
    const bars = data.map((d, i) => {
      if (d.value == null || d.value <= min) return null;
      const top = y(d.value);
      const r = Math.min(4, barW / 2, plotBottom - top);
      const x = xs[i] - barW / 2;
      // 上だけ角丸の棒
      return s('path', {
        class: `ch-bar${d.muted ? ' is-muted' : ''}`,
        d: `M${x},${plotBottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${plotBottom} Z`,
      });
    });
    svg.append(...bars.filter(Boolean));
    if (ref) {
      svg.append(s('line', { class: 'ch-ref', x1: PAD.left, x2: width - PAD.right, y1: y(ref.value), y2: y(ref.value) }));
      svg.append(s('text', { class: 'ch-ref-label', x: width - PAD.right, y: y(ref.value) - 5, 'text-anchor': 'end' }, ref.label));
    }
    xLabels(svg, xs, data.map((d) => d.label), width, HEIGHT - 8);
    wrap.replaceChildren(svg);
    hoverLayer(wrap, svg, {
      xs, step, plotTop, plotBottom,
      tips: data.map((d) => d.tip),
      onFocus: (i) => bars.forEach((b, j) => b?.classList.toggle('is-dim', i != null && j !== i)),
    });
  });
  wrap.cleanup = stop;
  return wrap;
}

/**
 * 折れ線グラフ（1本〜2本）。値のない日は線を切らずに前後をつなぎ、点は記録のある日だけ
 * @param {Object} o
 * @param {string[]} o.labels  x 軸のラベル
 * @param {{ name: string, cls: string, values: (number|null)[] }[]} o.series
 * @param {Node[][]} o.tips    列ごとの吹き出しの中身
 * @param {number} [o.min] [o.max]  y の範囲（省略すると値から決める）
 * @param {number[]} [o.ticks]
 * @param {(v: number) => string} o.format
 * @param {{ value: number, label: string }} [o.ref]
 */
export function lineChart({ labels, series, tips, min, max, ticks: fixedTicks, format, ref, ariaLabel, className = '' }) {
  const wrap = h('div', { class: `ch ${className}`, role: 'img', 'aria-label': ariaLabel });
  const stop = responsive(wrap, (width) => {
    const all = series.flatMap((se) => se.values).filter((v) => v != null);
    if (ref) all.push(ref.value);
    const lo = min ?? Math.floor(Math.min(...all) - 1);
    const hi = max ?? Math.ceil(Math.max(...all) + 1);
    const ticks = fixedTicks ?? niceTicks(lo, hi);
    const yMin = fixedTicks ? lo : ticks[0];
    const yMax = fixedTicks ? hi : ticks.at(-1);
    const plotTop = PAD.top;
    const plotBottom = HEIGHT - PAD.bottom;
    const y = (v) => plotBottom - ((v - yMin) / (yMax - yMin || 1)) * (plotBottom - plotTop);
    const step = (width - PAD.left - PAD.right) / labels.length;
    const xs = labels.map((_, i) => PAD.left + step * (i + 0.5));

    const svg = s('svg', { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, class: 'ch-svg' });
    for (const t of ticks) {
      svg.append(s('line', { class: 'ch-grid', x1: PAD.left, x2: width - PAD.right, y1: y(t), y2: y(t) }));
      svg.append(s('text', { class: 'ch-y', x: PAD.left - 6, y: y(t) + 4, 'text-anchor': 'end' }, format(t)));
    }
    if (ref) {
      svg.append(s('line', { class: 'ch-ref', x1: PAD.left, x2: width - PAD.right, y1: y(ref.value), y2: y(ref.value) }));
      svg.append(s('text', { class: 'ch-ref-label', x: width - PAD.right, y: y(ref.value) - 5, 'text-anchor': 'end' }, ref.label));
    }
    const dotGroups = [];
    for (const se of series) {
      const pts = se.values.map((v, i) => (v == null ? null : [xs[i], y(v)])).filter(Boolean);
      if (pts.length > 1) svg.append(s('polyline', { class: `ch-line ${se.cls}`, points: pts.map((p) => p.join(',')).join(' ') }));
      const dots = se.values.map((v, i) => (v == null ? null : s('circle', { class: `ch-dot ${se.cls}`, cx: xs[i], cy: y(v), r: labels.length > 40 ? 2.5 : 4 })));
      svg.append(...dots.filter(Boolean));
      dotGroups.push(dots);
    }
    xLabels(svg, xs, labels, width, HEIGHT - 8);
    wrap.replaceChildren(svg);
    hoverLayer(wrap, svg, {
      xs, step, plotTop, plotBottom, tips,
      onFocus: (i) => dotGroups.forEach((dots) => dots.forEach((d, j) => d?.classList.toggle('is-on', j === i))),
    });
  });
  wrap.cleanup = stop;
  return wrap;
}
