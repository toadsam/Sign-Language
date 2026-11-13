/* 막대 그림. 색은 종이 바탕(#FBF5E6)에서 검사한 세 가지만 쓴다: 파랑 · 황토 · 초록.
   글씨는 항상 먹색이고, 색은 막대만 입는다. 값은 막대 끝에 직접 적는다. */
(function () {
  'use strict';
  const SJ = window.SJ, s = SJ.s, text = SJ.text, f = SJ.f;
  const C = { blue: '#2a6fb8', ochre: '#c9772b', green: '#2f8f6b', gray: '#8F826F', core: '#DD4B35' };
  const fmt = (v, d) => (d == null ? String(v) : v.toFixed(d));

  function legend(g, x, y, series) {
    let cx = x;
    series.forEach((se) => {
      g.appendChild(s('rect', { x: cx, y: y - 9, width: 14, height: 10, rx: 2, fill: se.color }));
      const t = text(cx + 19, y, se.name, { size: 12, anchor: 'start', cls: 't-soft' }); g.appendChild(t);
      cx += 19 + se.name.length * 11.5 + 16;
    });
  }
  /* 세로 묶음 막대: cats[i].label, values[i][seriesIndex] */
  function columns(parent, o) {
    const g = s('g', { class: 'chart' }); parent.appendChild(g);
    const x0 = o.x + 34, y0 = o.y + o.h - 30, W = o.w - 44, H = o.h - 64, max = o.max;
    const ticks = o.ticks || [0, max / 2, max];
    ticks.forEach((t) => {
      const y = y0 - (t / max) * H;
      g.appendChild(s('line', { x1: x0, x2: x0 + W, y1: y, y2: y, stroke: 'var(--line)', 'stroke-width': t === 0 ? 1.6 : 1 }));
      g.appendChild(text(x0 - 6, y + 4, fmt(t), { size: 11, anchor: 'end', cls: 't-faint' }));
    });
    if (o.unit) g.appendChild(text(x0 - 6, o.y + 22, o.unit, { size: 11, anchor: 'end', cls: 't-faint' }));
    legend(g, x0 + 2, o.y + 12, o.series);
    const n = o.cats.length, band = W / n, k = o.series.length, bw = Math.min(24, (band - 18) / k - 2);
    o.cats.forEach((c, i) => {
      const cx = x0 + band * (i + 0.5), total = k * bw + (k - 1) * 2;
      if (c.pick) g.appendChild(s('path', { class: 'wash', d: SJ.blob(cx - band / 2 + 6, o.y + 26, band - 12, o.h - 30, 91 + i, 3), fill: 'var(--core-pale)' }));
      o.values[i].forEach((v, j) => {
        const bx = cx - total / 2 + j * (bw + 2), bh = (v / max) * H, by = y0 - bh, r = Math.min(4, bw / 2);
        const bar = s('path', {
          class: 'growY', style: { '--d': (i * 0.07 + j * 0.03) + 's' }, fill: o.series[j].color,
          d: 'M' + f(bx) + ' ' + f(y0) + 'V' + f(by + r) + 'Q' + f(bx) + ' ' + f(by) + ' ' + f(bx + r) + ' ' + f(by) + 'H' + f(bx + bw - r) + 'Q' + f(bx + bw) + ' ' + f(by) + ' ' + f(bx + bw) + ' ' + f(by + r) + 'V' + f(y0) + 'Z',
        });
        const hit = s('rect', { x: bx - 2, y: o.y + 26, width: bw + 4, height: y0 - o.y - 26, fill: 'transparent', tabindex: 0 });
        SJ.tip(hit, '<b>' + c.label + '</b> ' + o.series[j].name + ' ' + fmt(v, o.dec) + (o.unit || '') + (c.sub ? '<br>' + c.sub : ''));
        g.appendChild(bar); g.appendChild(hit);
        g.appendChild(text(bx + bw / 2, by - 5, fmt(v, o.dec), { size: 11 }));
      });
      g.appendChild(text(cx, y0 + 17, c.label, { size: 13, cls: c.pick ? 't-story t-core' : 't-story' }));
      if (c.under) g.appendChild(text(cx, y0 + 31, c.under, { size: 10.5, cls: 't-faint' }));
    });
    return g;
  }
  /* 가로 막대 한 줄씩: rows[i] = {label, value, color, note, dash} */
  function hbars(parent, o) {
    const g = s('g', { class: 'chart' }); parent.appendChild(g);
    const lw = o.labelW || 200, x0 = o.x + lw, W = o.w - lw - 64, bh = o.barH || 16, gap = o.gap || 30;
    if (o.ref != null) {
      const rx = x0 + (o.ref / o.max) * W;
      g.appendChild(s('line', { x1: rx, x2: rx, y1: o.y - 6, y2: o.y + o.rows.length * gap - 6, stroke: 'var(--ink)', 'stroke-width': 1.4, 'stroke-dasharray': '4 4' }));
      if (o.refLabel) g.appendChild(text(rx, o.y - 12, o.refLabel, { size: 11.5, cls: 't-soft' }));
    }
    o.rows.forEach((r, i) => {
      const y = o.y + i * gap, w = (r.value / o.max) * W, rr = Math.min(4, bh / 2);
      g.appendChild(text(x0 - 10, y + bh - 3, r.label, { size: 13, anchor: 'end', cls: r.pick ? 't-core' : null, weight: r.pick ? 700 : null }));
      g.appendChild(s('line', { x1: x0, x2: x0, y1: y - 3, y2: y + bh + 3, stroke: 'var(--line-strong)', 'stroke-width': 1.4 }));
      const bar = s('path', {
        class: 'growX', style: { '--d': (i * 0.08) + 's' }, fill: r.color || C.blue, 'fill-opacity': r.dash ? 0.45 : 1,
        d: 'M' + f(x0) + ' ' + f(y) + 'H' + f(x0 + w - rr) + 'Q' + f(x0 + w) + ' ' + f(y) + ' ' + f(x0 + w) + ' ' + f(y + rr) + 'V' + f(y + bh - rr) + 'Q' + f(x0 + w) + ' ' + f(y + bh) + ' ' + f(x0 + w - rr) + ' ' + f(y + bh) + 'H' + f(x0) + 'Z',
      });
      g.appendChild(bar);
      g.appendChild(text(x0 + w + 7, y + bh - 3, fmt(r.value, o.dec) + (o.unit || ''), { size: 12.5, anchor: 'start', cls: 'val-label' }));
      const hit = s('rect', { x: o.x, y: y - 6, width: o.w, height: bh + 12, fill: 'transparent', tabindex: 0 });
      if (r.note) SJ.tip(hit, '<b>' + r.label + '</b><br>' + r.note);
      g.appendChild(hit);
    });
    return g;
  }
  SJ.chart = { columns, hbars, C, legend };
})();
