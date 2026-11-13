/* 예시 뼈대. 관절 번호와 연결선은 ml/common/skeleton.py 와 같다 (상체 13 · 왼손 21 · 오른손 21 · 얼굴 70 = 125점).
   좌표는 전부 여기서 수식으로 만든 가짜 동작이다. AI Hub 원본 좌표는 한 점도 들어 있지 않다. */
(function () {
  'use strict';
  const SJ = window.SJ, s = SJ.s, f = SJ.f;
  const HAND_PARENTS = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19];
  const BODY_EDGES = [[1, 0], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [0, 9], [0, 10], [9, 11], [10, 12]];
  const chain = (a, b, closed) => { const e = []; for (let i = a; i < b; i++) e.push([i, i + 1]); if (closed) e.push([b, a]); return e; };
  const FACE_LOCAL = [].concat(chain(0, 16), chain(17, 21), chain(22, 26), chain(27, 30), chain(31, 35), chain(36, 41, true), chain(42, 47, true), chain(48, 59, true), chain(60, 67, true));
  const EDGES = {
    body: BODY_EDGES,
    lhand: HAND_PARENTS.map((p, c) => (p >= 0 ? [13 + p, 13 + c] : null)).filter(Boolean),
    rhand: HAND_PARENTS.map((p, c) => (p >= 0 ? [34 + p, 34 + c] : null)).filter(Boolean),
    face: FACE_LOCAL.map((e) => [55 + e[0], 55 + e[1]]),
  };
  const RANGE = { body: [0, 13], lhand: [13, 34], rhand: [34, 55], face: [55, 125] };

  const UP = 0.72, FORE = 0.66;
  function ik(S, W, outward) {
    let dx = W[0] - S[0], dy = W[1] - S[1], d = Math.hypot(dx, dy);
    const dmax = UP + FORE - 0.01, dmin = Math.abs(UP - FORE) + 0.02;
    if (d > dmax) { dx *= dmax / d; dy *= dmax / d; d = dmax; W = [S[0] + dx, S[1] + dy]; }
    if (d < dmin) d = dmin;
    const base = Math.atan2(dy, dx), A = Math.acos(Math.max(-1, Math.min(1, (UP * UP + d * d - FORE * FORE) / (2 * UP * d))));
    const e1 = [S[0] + UP * Math.cos(base + A), S[1] + UP * Math.sin(base + A)], e2 = [S[0] + UP * Math.cos(base - A), S[1] + UP * Math.sin(base - A)];
    const E = (e1[0] * outward > e2[0] * outward) ? e1 : e2;
    return { E, W };
  }
  /* 손 21점: 손목 + 손가락 5개 × 4마디 */
  function hand(out, base, W, dir, side, curl, spread) {
    out[base] = [W[0], W[1], 0];
    const fan = [-0.95, -0.3, -0.06, 0.16, 0.4], len = [0.8, 1, 1.08, 1, 0.8], seg = [0.1, 0.07, 0.055];
    for (let k = 0; k < 5; k++) {
      let a = dir + side * fan[k] * (k === 0 ? 1 : spread);
      const palm = k === 0 ? 0.07 : 0.21 - Math.abs(k - 2.3) * 0.012;
      let x = W[0] + palm * Math.cos(a), y = W[1] + palm * Math.sin(a), z = 0;
      out[base + 1 + k * 4] = [x, y, z];
      for (let j = 0; j < 3; j++) {
        a += -side * curl[k] * (k === 0 ? 0.55 : 1.25);
        const L = seg[j] * len[k] * (1 - 0.25 * curl[k]);
        x += L * Math.cos(a); y += L * Math.sin(a); z -= 0.03 * curl[k];
        out[base + 2 + k * 4 + j] = [x, y, z];
      }
    }
  }
  function face(out, cx, cy, mouth, brow) {
    const b = 55, w = 0.19, P = (i, x, y) => { out[b + i] = [cx + x, cy + y, -0.05]; };
    for (let i = 0; i <= 16; i++) { const t = Math.PI * (i / 16); P(i, -w * Math.cos(t), -0.02 + 0.27 * Math.sin(t) * (0.82 + 0.18 * Math.sin(t))); }
    for (let i = 0; i < 5; i++) { const t = i / 4; P(17 + i, -0.15 + 0.11 * t, -0.115 - 0.022 * Math.sin(Math.PI * t) - brow); P(22 + i, 0.04 + 0.11 * t, -0.115 - 0.022 * Math.sin(Math.PI * t) - brow); }
    for (let i = 0; i < 4; i++) P(27 + i, 0, -0.07 + 0.035 * i);
    for (let i = 0; i < 5; i++) P(31 + i, -0.04 + 0.02 * i, 0.055 + 0.012 * Math.sin(Math.PI * i / 4));
    for (let i = 0; i < 6; i++) { const t = Math.PI * 2 * i / 6; P(36 + i, -0.085 - 0.034 * Math.cos(t), -0.06 - 0.014 * Math.sin(t)); P(42 + i, 0.085 - 0.034 * Math.cos(t), -0.06 - 0.014 * Math.sin(t)); }
    for (let i = 0; i < 12; i++) { const t = Math.PI * 2 * i / 12; P(48 + i, -0.068 * Math.cos(t), 0.125 - (0.018 + mouth) * Math.sin(t)); }
    for (let i = 0; i < 8; i++) { const t = Math.PI * 2 * i / 8; P(60 + i, -0.045 * Math.cos(t), 0.125 - (0.006 + mouth * 0.8) * Math.sin(t)); }
    P(68, -0.085, -0.06); P(69, 0.085, -0.06);
  }

  const REST = { rw: [-0.6, 1.3], lw: [0.6, 1.3], rc: [0.25, 0.3, 0.32, 0.34, 0.36], lc: [0.25, 0.3, 0.32, 0.34, 0.36], rs: 0.7, ls: 0.7, rt: 0, lt: 0, mouth: 0, brow: 0, lean: 0 };
  function build(p) {
    const out = new Array(125);
    const lean = p.lean || 0, hx = lean * 0.05;
    out[1] = [0, 0, 0]; out[0] = [hx, -0.62, -0.04];
    out[2] = [-0.5, 0.02, 0]; out[5] = [0.5, 0.02, 0]; out[8] = [0, 1.45, 0];
    out[9] = [hx - 0.085, -0.68, -0.05]; out[10] = [hx + 0.085, -0.68, -0.05]; out[11] = [hx - 0.19, -0.64, 0]; out[12] = [hx + 0.19, -0.64, 0];
    const R = ik(out[2], p.rw, -1), L = ik(out[5], p.lw, 1);
    out[3] = [R.E[0], R.E[1], 0.05]; out[4] = [R.W[0], R.W[1], -0.08]; out[6] = [L.E[0], L.E[1], 0.05]; out[7] = [L.W[0], L.W[1], -0.08];
    hand(out, 13, L.W, Math.atan2(L.W[1] - L.E[1], L.W[0] - L.E[0]) + (p.lt || 0), -1, p.lc, p.ls);
    hand(out, 34, R.W, Math.atan2(R.W[1] - R.E[1], R.W[0] - R.E[0]) + (p.rt || 0), 1, p.rc, p.rs);
    face(out, hx, -0.62, p.mouth || 0, p.brow || 0);
    return out;
  }
  const lerp = (a, b, t) => a + (b - a) * t, ease = (t) => t * t * (3 - 2 * t);
  function mix(a, b, t) {
    const o = {};
    for (const k in REST) {
      const x = a[k] != null ? a[k] : REST[k], y = b[k] != null ? b[k] : REST[k];
      o[k] = Array.isArray(x) ? x.map((v, i) => lerp(v, y[i], t)) : lerp(x, y, t);
    }
    return o;
  }
  const OPEN = [0.05, 0.03, 0.03, 0.03, 0.05], FIST = [0.7, 1, 1, 1, 1], POINT = [0.6, 0.02, 1, 1, 1], TWO = [0.6, 0.02, 0.02, 1, 1];
  /* 가짜 동작 세 개. 모두 손 내린 자세에서 시작하고 끝난다 (단어 클립과 같은 모양) */
  const CLIPS = {
    a: { frames: 60, keys: [[0, {}], [0.2, { rw: [-0.2, 0.42], rc: POINT, rt: -0.5 }], [0.4, { rw: [0.02, 0.3], rc: POINT, rt: -0.7 }], [0.58, { rw: [-0.28, 0.36], rc: POINT, rt: -0.4 }], [0.76, { rw: [-0.05, 0.3], rc: OPEN, rs: 1, rt: -0.6 }], [1, {}]] },
    b: { frames: 72, keys: [[0, {}], [0.22, { rw: [-0.12, 0.5], lw: [0.12, 0.5], rc: OPEN, lc: OPEN, rs: 1, ls: 1, rt: -0.9, lt: 0.9 }], [0.45, { rw: [-0.55, 0.38], lw: [0.55, 0.38], rc: OPEN, lc: OPEN, rs: 1.2, ls: 1.2, rt: -0.5, lt: 0.5 }], [0.62, { rw: [-0.2, 0.55], lw: [0.2, 0.55], rc: FIST, lc: FIST, rt: -0.9, lt: 0.9 }], [0.8, { rw: [-0.48, 0.45], lw: [0.48, 0.45], rc: OPEN, lc: OPEN, rs: 1.1, ls: 1.1 }], [1, {}]] },
    c: { frames: 64, keys: [[0, {}], [0.25, { rw: [-0.1, -0.22], rc: TWO, rt: -0.3, brow: 0.012 }], [0.4, { rw: [-0.06, -0.3], rc: TWO, rt: -0.3, brow: 0.02, mouth: 0.02 }], [0.55, { rw: [-0.14, -0.2], rc: TWO, rt: -0.3, brow: 0.02, mouth: 0.02 }], [0.7, { rw: [-0.06, -0.3], rc: TWO, rt: -0.3, brow: 0.02, lean: 1, mouth: 0.02 }], [1, {}]] },
  };
  function clipFrame(name, i) {
    const c = CLIPS[name], t = Math.max(0, Math.min(1, i / (c.frames - 1))), K = c.keys;
    let k = 0; while (k < K.length - 2 && t > K[k + 1][0]) k++;
    const u = ease((t - K[k][0]) / (K[k + 1][0] - K[k][0] || 1));
    const p = mix(K[k][1], K[k + 1][1], Math.max(0, Math.min(1, u)));
    const breathe = Math.sin(i * 0.21) * 0.006; p.rw = [p.rw[0], p.rw[1] + breathe]; p.lw = [p.lw[0], p.lw[1] - breathe];
    return build(p);
  }
  /* 이어 붙인 동작: [{clip:'a'}, …] → {frames, at(i), spans} */
  function sequence(names) {
    const spans = []; let n = 0;
    names.forEach((nm) => { spans.push({ clip: nm, start: n, end: n + CLIPS[nm].frames }); n += CLIPS[nm].frames; });
    return { frames: n, spans, at: (i) => { i = Math.max(0, Math.min(n - 1, Math.floor(i))); const sp = spans.find((q) => i < q.end) || spans[spans.length - 1]; return clipFrame(sp.clip, i - sp.start); } };
  }

  /* 그리기: 그룹 하나에 부위별 선과 점을 만들어 두고, 프레임마다 좌표만 바꾼다 */
  function figure(o) {
    o = o || {};
    const g = s('g', { class: 'pose' });
    const col = Object.assign({ body: 'var(--ink)', lhand: '#3E7CB1', rhand: 'var(--core)', face: 'var(--ink-faint)' }, o.colors || {});
    const wd = { body: 2.6, lhand: 1.7, rhand: 1.7, face: 1 };
    const parts = {};
    ['face', 'body', 'lhand', 'rhand'].forEach((k) => {
      const path = s('path', { fill: 'none', stroke: col[k], 'stroke-width': wd[k] * (o.weight || 1), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      const dots = o.dots ? s('path', { fill: 'none', stroke: col[k], 'stroke-width': (k === 'body' ? 5 : k === 'face' ? 2.2 : 3.2) * (o.weight || 1), 'stroke-linecap': 'round' }) : null;
      parts[k] = { path, dots, on: true };
      g.appendChild(path); if (dots) g.appendChild(dots);
    });
    const sc = o.scale || 100, ox = o.x || 0, oy = o.y || 0;
    const api = {
      g, parts,
      show(k, on) { parts[k].on = on; parts[k].path.style.display = on ? '' : 'none'; if (parts[k].dots) parts[k].dots.style.display = on ? '' : 'none'; },
      set(pts) {
        for (const k in EDGES) {
          if (!parts[k].on) continue;
          let d = '';
          EDGES[k].forEach((e) => { const a = pts[e[0]], b = pts[e[1]]; d += 'M' + f(ox + a[0] * sc) + ' ' + f(oy + a[1] * sc) + 'L' + f(ox + b[0] * sc) + ' ' + f(oy + b[1] * sc); });
          parts[k].path.setAttribute('d', d);
          if (parts[k].dots) {
            let dd = ''; const r = RANGE[k];
            for (let i = r[0]; i < r[1]; i++) { const x = f(ox + pts[i][0] * sc), y = f(oy + pts[i][1] * sc); dd += 'M' + x + ' ' + y + 'h0.01'; }
            parts[k].dots.setAttribute('d', dd);
          }
        }
      },
    };
    return api;
  }

  SJ.pose = { CLIPS, clipFrame, sequence, figure, rest: () => build(REST), EDGES, RANGE };
})();
