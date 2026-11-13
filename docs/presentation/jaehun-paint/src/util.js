import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
export const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOut = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
/** 통통 튀며 도착 (0→1, 살짝 넘쳤다 돌아옴) */
export const elastic = x => { x = clamp(x); if (x === 0 || x === 1) return x; return Math.pow(2, -9 * x) * Math.sin((x * 10 - .75) * (2 * Math.PI / 3)) + 1; };
export const backOut = x => { x = clamp(x); const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
/** t가 [a,b] 구간을 지나는 비율 0~1 */
export const span = (t, a, b) => clamp((t - a) / (b - a));

// 색칠 마을 시안(proto-paint)의 물감 색
export const COLOR = {
  paper: 0xFBF5E6, card: 0xFFFDF6, ink: 0x2E2620, inkSoft: 0x6B5D4F,
  yellow: 0xFFC83D, yellowSoft: 0xFFE08A, coral: 0xF2937A, leaf: 0x93C47D, sky: 0xA9CFEA, mint: 0x7CC6A4,
  skin: 0xF6CDA8, hair: 0x5A4636, cheek: 0xF2937A, shirt: 0xA9CFEA,
  right: 0xF2937A, left: 0x7CC6A4,
  e5: 0xFFC83D, e4b: 0xCFC6B6, rest: 0xEFE6D2,
};
export const hex = c => '#' + c.toString(16).padStart(6, '0');

/** 데이터 좌표(x 오른쪽, y 아래, z 멀어짐) → three (y 위, z 카메라 쪽) */
export function toWorld(p, out = new THREE.Vector3()) { return out.set(p[0], -p[1], -p[2]); }

/** 같은 시드면 같은 무늬가 나오는 난수 */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * 장면 전체가 같이 쓰는 값.
 * scene: 장면에 들어올 때 0→1 (연필 스케치에서 물감으로), boil: 선이 떨리는 시드(0.16초마다 바뀜)
 */
export const G = {
  scene: { value: 1 }, boil: { value: 0 },
  paper: { value: new THREE.Color(COLOR.paper) }, ink: { value: new THREE.Color(COLOR.ink) },
  lineMats: new Set(),
};

const NOISE = /* glsl */`
float wcHash(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wcNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wcHash(i), wcHash(i + vec3(1,0,0)), f.x), mix(wcHash(i + vec3(0,1,0)), wcHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wcHash(i + vec3(0,0,1)), wcHash(i + vec3(1,0,1)), f.x), mix(wcHash(i + vec3(0,1,1)), wcHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float wcFbm(vec3 p){ float a = .5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * wcNoise(p); p *= 2.03; a *= .5; } return s; }
`;

let toonGrad;
function grad() {
  if (!toonGrad) {
    const d = new Uint8Array([110, 190, 255]);
    toonGrad = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
    toonGrad.minFilter = toonGrad.magFilter = THREE.NearestFilter; toonGrad.needsUpdate = true;
  }
  return toonGrad;
}

/**
 * 수채 물감 재질. 만화 음영(3단) 위에
 *  - 투명 수채: 종이 색이 비친다, 그늘에는 같은 색을 한 번 더 덧칠
 *  - 가장자리에 물감이 고여 진해진다, 물감 알갱이와 큰 얼룩
 *  - paint 0→1: 연필 스케치(종이 + 빗금)에서 물감이 번지며 칠해진다. 경계에는 진한 물자국.
 * opts.paint: 공유할 {value} (캐릭터 한 명이 같은 값을 쓴다), opts.axis: 아래에서 위로 칠하기(막대), opts.inst: 칸마다 aPaint
 */
export function paint(color, { paint = null, axis = false, inst = false, ...opts } = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: grad(), ...opts });
  m.userData.paint = paint || { value: 1 };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uPaint: m.userData.paint, uScene: G.scene, uPaper: G.paper });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWc; varying vec3 vLoc;${inst ? '\nattribute float aPaint; varying float vInst;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLoc = position;
        vec4 wcW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wcW = instanceMatrix * wcW;
        #endif
        vWc = (modelMatrix * wcW).xyz;${inst ? '\n        vInst = aPaint;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uPaint; uniform float uScene; uniform vec3 uPaper; varying vec3 vWc; varying vec3 vLoc;${inst ? ' varying float vInst;' : ''}\n${NOISE}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          float lit = dot(gl_FragColor.rgb, vec3(.3333)) / max(.0001, dot(diffuseColor.rgb, vec3(.3333)));
          float shade = clamp(lit / 1.15, 0.0, 1.0);
          float g = wcFbm(vWc * 9.0);
          float big = wcFbm(vWc * 1.7 + 3.1);
          float tooth = wcNoise(vec3(gl_FragCoord.xy * .45, 1.0)) * .6 + wcNoise(vec3(gl_FragCoord.xy * .12, 7.0)) * .4;   // 종이 이(화면에 고정)
          vec3 base = diffuseColor.rgb;
          vec3 pig = base * mix(.84, 1.08, big) * mix(vec3(1.0), vec3(.97, .99, 1.04), big);   // 고르지 않은 물감 양, 살짝 다른 색
          pig = mix(pig * pig * 1.02, pig, smoothstep(.35, .95, shade));      // 그늘 = 같은 색 한 겹 더
          pig *= 1.0 - .1 * g;
          pig *= 1.0 - .13 * tooth * (1.1 - shade * .5);                       // 물감 알갱이가 종이 골에 고인다
          vec3 V = normalize(vViewPosition);
          float rim = 1.0 - abs(dot(normal, V));
          pig = mix(pig, pig * pig * .85, smoothstep(.45, 1.0, rim) * .75);   // 가장자리 물자국
          pig = mix(uPaper, pig, .9);
          float p = min(uPaint, uScene)${inst ? ' * vInst' : ''};
          float field = ${axis ? 'mix(g * .5 + big * .5, clamp(vLoc.y + .5, 0.0, 1.0), .82)' : 'g * .45 + big * .55'};
          float edge = p * 1.3 - .15;
          float m = smoothstep(field - .045, field + .045, edge);
          float band = smoothstep(.08, .0, abs(field - edge)) * step(.002, p) * step(p, .998);
          float hatch = step(.62, fract((gl_FragCoord.x - gl_FragCoord.y) / 7.0)) * smoothstep(.9, .45, shade);
          vec3 sketch = uPaper * (1.0 - .13 * hatch) * (1.0 - .035 * g);
          vec3 outc = mix(sketch, pig, m);
          gl_FragColor.rgb = mix(outc, outc * .8, band * .8);
        }`);
  };
  m.customProgramCacheKey = () => 'wc' + (axis ? 'a' : '') + (inst ? 'i' : '');
  return m;
}
/** 예전 이름 호환 */
export const toon = (color, opts) => paint(color, opts);

/**
 * 먹선(외곽선). 뒷면을 법선 방향으로 조금 부풀려 먹색으로 칠한다(inverted hull).
 * 두께는 카메라 거리에 비례해서 화면에서 늘 2px 안팎. 0.16초마다 선이 살짝 떨린다(손그림 애니메이션처럼).
 */
export function inkMaterial({ px = 1, color = null } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uInk: color ? { value: new THREE.Color(color) } : G.ink, uBoil: G.boil, uPx: { value: .0025 * px }, opacity: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uBoil; uniform float uPx;
      void main(){
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vec3 wn = normalize(mat3(m) * normal);
        float d = length(cameraPosition - wp.xyz);
        float j = .8 + .45 * sin(wp.x * 11.0 + uBoil * 2.1) * sin(wp.y * 9.0 - uBoil * 1.7) + .2 * sin(wp.z * 13.0 + uBoil * 3.3);
        wp.xyz += wn * uPx * d * j;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uInk; uniform float opacity;
      void main(){ gl_FragColor = vec4(uInk, opacity);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
  });
}

/** 메시(또는 그 아래 메시 전부)에 먹선을 단다. 반환: 만든 먹선 메시들 */
export function inkify(root, mat = inkMaterial(), { skip = () => false } = {}) {
  const made = [];
  const list = []; root.traverse(o => { if (o.isMesh && !o.userData.isInk && !skip(o)) list.push(o); });
  for (const o of list) {
    let ink;
    if (o.isInstancedMesh) {
      ink = new THREE.InstancedMesh(o.geometry, mat, o.count);
      ink.instanceMatrix = o.instanceMatrix; ink.frustumCulled = false; ink.userData.src = o;
      ink.onBeforeRender = () => { ink.count = o.count; };
    } else ink = new THREE.Mesh(o.geometry, mat);
    ink.userData.isInk = true; ink.raycast = () => { }; ink.renderOrder = 1;   // 몸 다음에 (반투명일 때 안쪽이 비치지 않게)
    o.add(ink); made.push(ink);
  }
  return made;
}

/* ───────── 2D 수채 (캔버스) ───────── */

/** 다각형 변마다 중간점을 흔들어 넣는다 (번진 물감 가장자리) */
function deform(pts, depth, vari, R) {
  let out = pts;
  for (let d = 0; d < depth; d++) {
    const nx = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const g = (R() + R() + R() - 1.5) * vari * len;
      const nxv = -(b[1] - a[1]) / (len || 1), nyv = (b[0] - a[0]) / (len || 1);
      nx.push(a, [(a[0] + b[0]) / 2 + nxv * g, (a[1] + b[1]) / 2 + nyv * g]);
    }
    out = nx;
  }
  return out;
}
const rgbaOf = (c, a) => { const n = typeof c === 'number' ? c : parseInt(c.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

/** 수채 얼룩 하나: 흔든 다각형을 옅게 30겹 쌓는다 (Tyler Hobbs 방식) */
export function washShape(ctx, base, color, { layers = 28, alpha = .045, seed = 1, vari = .22 } = {}) {
  const R = rng(seed);
  const b = deform(base, 2, vari * 1.6, R);
  ctx.save(); ctx.globalCompositeOperation = 'source-over';
  for (let l = 0; l < layers; l++) {
    const p = deform(b, 3, vari, R);
    ctx.fillStyle = rgbaOf(color, alpha);
    ctx.beginPath(); p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
export function washBlob(ctx, cx, cy, rx, ry, color, o = {}) {
  const n = 12, base = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; base.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  washShape(ctx, base, color, o);
}
export function washRect(ctx, x, y, w, h, color, o = {}) {
  const r = Math.min(w, h) * .35, base = [];
  const pts = [[x + r, y], [x + w / 2, y], [x + w - r, y], [x + w, y + r], [x + w, y + h / 2], [x + w, y + h - r], [x + w - r, y + h], [x + w / 2, y + h], [x + r, y + h], [x, y + h - r], [x, y + h / 2], [x, y + r]];
  base.push(...pts);
  washShape(ctx, base, color, o);
}
/** 떨리는 손그림 선 (닫힌 모양) */
export function roughPath(ctx, pts, { color = '#2E2620', width = 3, seed = 3, jitter = 1.6, passes = 2 } = {}) {
  const R = rng(seed);
  ctx.save(); ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let k = 0; k < passes; k++) {
    ctx.lineWidth = width * (k ? .55 : 1); ctx.globalAlpha = k ? .55 : 1;
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const jx = (R() - .5) * jitter * 2, jy = (R() - .5) * jitter * 2; i ? ctx.lineTo(x + jx, y + jy) : ctx.moveTo(x + jx, y + jy); });
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}
export function ellipsePts(cx, cy, rx, ry, n = 48) { const o = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; o.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return o; }
export function roundRectPts(x, y, w, h, r, n = 6) {
  const o = [], c = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  for (const [cx, cy, a0] of c) for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return o;
}

/** 캔버스 글자 스프라이트. 같은 글자는 캐시. wash=물감색이면 뒤에 수채 얼룩, line=true 면 먹선 테두리 */
const labelCache = new Map();
export const FONT = { story: '"Gowun Batang", serif', body: '"Gowun Dodum", sans-serif' };
export function makeLabel(text, { font = `700 64px ${FONT.story}`, color = '#2E2620', scale = .5, pad = 18, wash = null, line = false, seed = 5 } = {}) {
  const key = [text, font, color, wash, line].join('|');
  let tex = labelCache.get(key);
  if (!tex) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2 + (wash || line ? 44 : 0);
    c.width = w; c.height = 112;
    if (wash) washRect(ctx, 10, 16, w - 20, 80, wash, { seed: seed + text.length, alpha: .07, layers: 26 });
    if (line) roughPath(ctx, roundRectPts(8, 14, w - 16, 84, 30), { width: 3.2, seed: seed + 2 });
    ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, 58);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    labelCache.set(key, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(scale * tex.image.width / 112 * 1.17, scale * 1.17, 1);
  return s;
}

/** 물감 방울 텍스처 (반짝이 대신): 가장자리가 진한 둥근 얼룩, 4가지 모양 */
let dropTex;
export function dropTexture() {
  if (dropTex) return dropTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  for (let k = 0; k < 4; k++) {
    washBlob(g, 32 + k * 64, 32, 22, 20, '#FFFFFF', { seed: 11 + k, alpha: .09, layers: 18, vari: .28 });
    g.save(); g.globalCompositeOperation = 'destination-out';
    const rg = g.createRadialGradient(32 + k * 64, 32, 2, 32 + k * 64, 32, 20); rg.addColorStop(0, 'rgba(0,0,0,.45)'); rg.addColorStop(.7, 'rgba(0,0,0,.15)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(k * 64, 0, 64, 64); g.restore();
  }
  dropTex = new THREE.CanvasTexture(c); dropTex.colorSpace = THREE.SRGBColorSpace;
  return dropTex;
}

/** 큰 수채 얼룩 텍스처 (무대 바닥, 번짐 효과). 캐시 */
const blotCache = new Map();
export function blotTexture(colors, { size = 512, seed = 21, ring = false } = {}) {
  const key = colors.join(',') + seed + ring;
  if (blotCache.has(key)) return blotCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const S = size / 512;
  colors.forEach((col, i) => {
    const R = rng(seed + i * 7);
    washBlob(g, 256 * S + (R() - .5) * 60 * S, 256 * S + (R() - .5) * 40 * S, (190 - i * 38) * S, (180 - i * 40) * S, col, { seed: seed + i, alpha: .05, layers: 30, vari: .2 });
  });
  if (ring) roughPath(g, ellipsePts(256 * S, 256 * S, 228 * S, 228 * S, 64), { width: 4 * S, seed: seed + 9, jitter: 2.2 * S });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  blotCache.set(key, t);
  return t;
}

/** 한글 글리프(토큰 하나의 4프레임)를 2D 캔버스에 그린다: 먹선 + 수채 채움. 스티커판 시트와 카드가 같이 쓴다 */
export function drawGlyph(ctx, P, ox, oy, W, lim) {
  const s = W / (2 * lim), X = i => ox + W / 2 + P[i][0] * s, Y = i => oy + W * .34 + P[i][1] * s;
  const INK = '#2E2620', lw = Math.max(1, W * .016);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seg = (pts, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); pts.forEach((i, k) => k ? ctx.lineTo(X(i), Y(i)) : ctx.moveTo(X(i), Y(i))); ctx.stroke(); };
  const sw = Math.hypot(X(2) - X(5), Y(2) - Y(5));
  // 몸통과 팔: 먹선을 굵게 → 그 안을 하늘색으로 (테두리 있는 모양)
  const bodyPts = () => { ctx.beginPath(); ctx.moveTo(X(1), Y(1) + sw * .25); ctx.lineTo(X(8), Y(8) - sw * .1); };
  ctx.strokeStyle = INK; ctx.lineWidth = sw * .9 + lw * 2; bodyPts(); ctx.stroke();
  for (const a of [[2, 3, 4], [5, 6, 7]]) seg(a, W * .07 + lw * 2, INK);
  ctx.strokeStyle = '#A9CFEA'; ctx.lineWidth = sw * .9; bodyPts(); ctx.stroke();
  for (const a of [[2, 3, 4], [5, 6, 7]]) seg(a, W * .07, '#A9CFEA');
  // 손바닥 물감 (오른손 산호, 왼손 민트) + 손가락 먹선
  for (const [base, col] of [[13, 'rgba(124,198,164,.75)'], [34, 'rgba(242,147,122,.75)']]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc((X(base) + X(base + 9)) / 2, (Y(base) + Y(base + 9)) / 2, W * .05, 0, Math.PI * 2); ctx.fill();
  }
  const fing = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]];
  for (const base of [13, 34]) for (const f of fing) seg(f.map(j => base + j), Math.max(1, W * .018), INK);
  // 얼굴
  const hx = (X(9) + X(10)) / 2, hy = (Y(9) + Y(10)) / 2 + W * .01, hr = W * .13;
  ctx.fillStyle = '#F6CDA8'; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5A4636'; ctx.beginPath(); ctx.arc(hx, hy - hr * .1, hr * 1.04, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = INK;
  for (const dx of [-.38, .38]) { ctx.beginPath(); ctx.arc(hx + dx * hr, hy + hr * .2, hr * .12, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(242,147,122,.7)';
  for (const dx of [-.62, .62]) { ctx.beginPath(); ctx.ellipse(hx + dx * hr, hy + hr * .5, hr * .2, hr * .12, 0, 0, Math.PI * 2); ctx.fill(); }
}
