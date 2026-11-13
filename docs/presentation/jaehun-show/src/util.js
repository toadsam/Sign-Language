import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
export const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOut = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
/** 통통 튀며 도착 (0→1, 살짝 넘쳤다 돌아옴) */
export const elastic = x => { x = clamp(x); if (x === 0 || x === 1) return x; return Math.pow(2, -9 * x) * Math.sin((x * 10 - .75) * (2 * Math.PI / 3)) + 1; };
export const backOut = x => { x = clamp(x); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
/** t가 [a,b] 구간을 지나는 비율 0~1 */
export const span = (t, a, b) => clamp((t - a) / (b - a));

// 팀 앱의 보라 + 1학기 '꾸민 모습' 캐릭터 색
export const COLOR = {
  bg: 0xF6F3FF, lilac: 0xE9E4FF, purple: 0x7C6CF2, ink: 0x2B2350, inkSoft: 0x6B6490,
  skin: 0xFFE1CD, hair: 0x4A3A32, cheek: 0xFF9FAE, shirt: 0x8ECBEA,
  right: 0xFFAB7A, left: 0x6FD0AE, butter: 0xFFD66B, pink: 0xFF7A9A,
  e5: 0xB9AEFF, e4b: 0xD8D3CB, white: 0xFFFFFF, rest: 0xEFEBFF,
};
export const hex = c => '#' + c.toString(16).padStart(6, '0');

/** 데이터 좌표(x 오른쪽, y 아래, z 멀어짐) → three (y 위, z 카메라 쪽) */
export function toWorld(p, out = new THREE.Vector3()) { return out.set(p[0], -p[1], -p[2]); }

/** 만화 느낌 3단 음영 */
let toonGrad;
export function toon(color, opts = {}) {
  if (!toonGrad) {
    const d = new Uint8Array([90, 170, 255]);
    toonGrad = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
    toonGrad.minFilter = toonGrad.magFilter = THREE.NearestFilter; toonGrad.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGrad, ...opts });
}

/** 캔버스 글자 스프라이트. 같은 글자는 캐시. pill=true 면 둥근 말풍선 배경 */
const labelCache = new Map();
export function makeLabel(text, { font = '64px "Jua", sans-serif', color = '#2B2350', scale = .5, pad = 14, pill = null } = {}) {
  const key = [text, font, color, pill].join('|');
  let tex = labelCache.get(key);
  if (!tex) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2 + (pill ? 36 : 0);
    c.width = w; c.height = 96;
    if (pill) {
      ctx.fillStyle = pill; const r = 40;
      ctx.beginPath(); ctx.roundRect(4, 8, w - 8, 80, r); ctx.fill();
    }
    ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, 50);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    labelCache.set(key, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(scale * tex.image.width / 96, scale, 1);
  return s;
}

/** 별 모양 텍스처 (반짝이) */
let starTex;
export function starTexture() {
  if (starTex) return starTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 30, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a)); }
  g.closePath(); g.fill();
  starTex = new THREE.CanvasTexture(c); starTex.colorSpace = THREE.SRGBColorSpace;
  return starTex;
}

/** 한글 글리프(토큰 하나의 4프레임) 를 2D 캔버스에 귀엽게 그린다. 활자함 시트와 카드가 같이 쓴다 */
export function drawGlyph(ctx, P, ox, oy, W, lim) {
  const s = W / (2 * lim), X = i => ox + W / 2 + P[i][0] * s, Y = i => oy + W * .34 + P[i][1] * s;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // 몸통 (목 → 골반) 하늘색 콩
  const sw = Math.hypot(X(2) - X(5), Y(2) - Y(5));
  ctx.strokeStyle = '#8ECBEA'; ctx.lineWidth = sw * .9;
  ctx.beginPath(); ctx.moveTo(X(1), Y(1) + sw * .25); ctx.lineTo(X(8), Y(8) - sw * .1); ctx.stroke();
  // 팔 (소매)
  ctx.strokeStyle = '#8ECBEA'; ctx.lineWidth = W * .07;
  for (const [a, b, c] of [[2, 3, 4], [5, 6, 7]]) { ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b), Y(b)); ctx.lineTo(X(c), Y(c)); ctx.stroke(); }
  // 손가락
  const fing = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]];
  for (const [base, col] of [[13, '#3FAE8C'], [34, '#F08A55']]) {
    ctx.strokeStyle = col; ctx.lineWidth = W * .022;
    for (const f of fing) { ctx.beginPath(); f.forEach((j, k) => { const i = base + j; k ? ctx.lineTo(X(i), Y(i)) : ctx.moveTo(X(i), Y(i)); }); ctx.stroke(); }
  }
  // 얼굴: 살구색 동그라미 + 머리카락 + 눈
  const hx = (X(9) + X(10)) / 2, hy = (Y(9) + Y(10)) / 2 + W * .01, hr = W * .13;
  ctx.fillStyle = '#FFE1CD'; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4A3A32'; ctx.beginPath(); ctx.arc(hx, hy - hr * .1, hr * 1.04, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
  ctx.fillStyle = '#2B2350';
  for (const dx of [-.38, .38]) { ctx.beginPath(); ctx.arc(hx + dx * hr, hy + hr * .2, hr * .13, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,159,174,.8)';
  for (const dx of [-.62, .62]) { ctx.beginPath(); ctx.ellipse(hx + dx * hr, hy + hr * .5, hr * .2, hr * .12, 0, 0, Math.PI * 2); ctx.fill(); }
}
