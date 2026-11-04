/**
 * 손으로 그린 선 만들기.
 * 웹 시안은 SVG 필터(feTurbulence)로 선을 떨리게 했는데, 앱(react-native-svg)에서는 그 필터가 없다.
 * 그래서 선의 점을 직접 조금씩 흔들어서 같은 느낌을 낸다.
 * seed가 같으면 항상 같은 모양이 나온다 (다시 그려도 선이 튀지 않게).
 */

export function rng(seed: number) {
  let s = (Math.floor(seed * 9973) >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const f = (v: number) => v.toFixed(1);

/** 삐뚤빼뚤한 사각 테두리. 끝이 살짝 겹쳐 닫혀서 펜으로 한 번에 그린 것처럼 보인다 */
export function roughRect(w: number, h: number, opts: { seed?: number; amp?: number; inset?: number; r?: number } = {}) {
  const { seed = 1, amp = 1.8, inset = 2, r = 14 } = opts;
  const R = rng(seed);
  const j = (k = 1) => (R() - 0.5) * 2 * amp * k;
  const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return [
    `M${f(x0 + rr + j())} ${f(y0 + j())}`,
    `Q${f(mx + j(3))} ${f(y0 + j(1.4))} ${f(x1 - rr + j())} ${f(y0 + j())}`,
    `Q${f(x1 + j())} ${f(y0 + j())} ${f(x1 + j())} ${f(y0 + rr + j())}`,
    `Q${f(x1 + j(1.4))} ${f(my + j(3))} ${f(x1 + j())} ${f(y1 - rr + j())}`,
    `Q${f(x1 + j())} ${f(y1 + j())} ${f(x1 - rr + j())} ${f(y1 + j())}`,
    `Q${f(mx + j(3))} ${f(y1 + j(1.4))} ${f(x0 + rr + j())} ${f(y1 + j())}`,
    `Q${f(x0 + j())} ${f(y1 + j())} ${f(x0 + j())} ${f(y1 - rr + j())}`,
    `Q${f(x0 + j(1.4))} ${f(my + j(3))} ${f(x0 + j())} ${f(y0 + rr + j())}`,
    `Q${f(x0 + j())} ${f(y0 + j())} ${f(x0 + rr + 6 + j())} ${f(y0 + j())}`,
  ].join(' ');
}

/** 점들을 부드럽게 잇는 닫힌 곡선 (Catmull-Rom → 베지어) */
export function smoothClosed(pts: [number, number][]) {
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

/** 열린 곡선 */
export function smoothOpen(pts: [number, number][]) {
  if (pts.length < 3) return 'M' + pts.map((q) => `${f(q[0])} ${f(q[1])}`).join(' L');
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${f(P[1][0])} ${f(P[1][1])}`;
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** 물감 얼룩: 가장자리가 울퉁불퉁한 타원 */
export function blob(cx: number, cy: number, rx: number, ry: number, seed = 1, wobble = 0.12, n = 11) {
  const R = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.25;
    const k = 1 + (R() - 0.5) * 2 * wobble;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smoothClosed(pts);
}

/** 선 하나를 손으로 그은 것처럼: 중간에 점을 넣고 살짝 흔든다 */
export function roughLine(x1: number, y1: number, x2: number, y2: number, seed = 1, amp = 1.4) {
  const R = rng(seed);
  const L = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(2, Math.round(L / 40));
  const nx = -(y2 - y1) / (L || 1), ny = (x2 - x1) / (L || 1);
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, o = i === 0 || i === steps ? 0 : (R() - 0.5) * 2 * amp;
    pts.push([x1 + (x2 - x1) * t + nx * o, y1 + (y2 - y1) * t + ny * o]);
  }
  return smoothOpen(pts);
}

/**
 * path 길이 재기 (M L H V Q C, 대소문자 모두).
 * 펜이 선을 그려 나가는 애니메이션(strokeDashoffset)에 쓴다. 앱의 SVG에는 pathLength가 없어서 직접 잰다.
 */
export function pathLength(d: string) {
  const toks = d.match(/[MLHVQCZmlhvqcz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0, cmd = 'M', x = 0, y = 0, sx = 0, sy = 0, len = 0;
  const num = () => parseFloat(toks[i++]);
  const seg = (pts: [number, number][]) => {
    // 곡선은 12토막으로 나눠 잰다
    const n = pts.length === 2 ? 1 : 12;
    let px = pts[0][0], py = pts[0][1];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      let qx: number, qy: number;
      if (pts.length === 2) { qx = pts[1][0]; qy = pts[1][1]; }
      else if (pts.length === 3) { const u = 1 - t; qx = u * u * pts[0][0] + 2 * u * t * pts[1][0] + t * t * pts[2][0]; qy = u * u * pts[0][1] + 2 * u * t * pts[1][1] + t * t * pts[2][1]; }
      else { const u = 1 - t; qx = u * u * u * pts[0][0] + 3 * u * u * t * pts[1][0] + 3 * u * t * t * pts[2][0] + t * t * t * pts[3][0]; qy = u * u * u * pts[0][1] + 3 * u * u * t * pts[1][1] + 3 * u * t * t * pts[2][1] + t * t * t * pts[3][1]; }
      len += Math.hypot(qx - px, qy - py); px = qx; py = qy;
    }
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; cmd = rel ? 'l' : 'L'; break;
      case 'L': { const nx = ox + num(), ny = oy + num(); seg([[x, y], [nx, ny]]); x = nx; y = ny; break; }
      case 'H': { const nx = ox + num(); seg([[x, y], [nx, y]]); x = nx; break; }
      case 'V': { const ny = oy + num(); seg([[x, y], [x, ny]]); y = ny; break; }
      case 'Q': { const c = [ox + num(), oy + num()] as [number, number], nx = ox + num(), ny = oy + num(); seg([[x, y], c, [nx, ny]]); x = nx; y = ny; break; }
      case 'C': { const c1 = [ox + num(), oy + num()] as [number, number], c2 = [ox + num(), oy + num()] as [number, number], nx = ox + num(), ny = oy + num(); seg([[x, y], c1, c2, [nx, ny]]); x = nx; y = ny; break; }
      case 'Z': seg([[x, y], [sx, sy]]); x = sx; y = sy; break;
      default: i++;
    }
  }
  return len;
}

/** SVG path 문자열의 모든 숫자 좌표를 조금씩 흔든다 (그려 둔 그림을 손떨림 있게) */
export function jitterPath(d: string, seed = 1, amp = 1.2) {
  const R = rng(seed);
  // 명령어별로 처리하지 않고 숫자 쌍만 흔든다. 상대 좌표(소문자)는 덜 흔든다
  return d.replace(/([MLQCTSHVAZmlqctshvaz])([^MLQCTSHVAZmlqctshvaz]*)/g, (_, cmd: string, args: string) => {
    if (/[AaZz]/.test(cmd)) return cmd + args;
    const k = cmd === cmd.toLowerCase() ? 0.5 : 1;
    const nums = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    return cmd + nums.map((v) => f(v + (R() - 0.5) * 2 * amp * k)).join(' ') + ' ';
  });
}
