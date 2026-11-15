import * as THREE from 'three';
import { Actor } from './skeleton.js';
import { G } from './util.js';

/**
 * 앱 안에서 띄우는 3D 수어 캐릭터 (발표 영상과 같은 캐릭터).
 * 앱이 AI 동작을 보내면 그대로 재생한다. 좌표는 계약 ⑤ 단위: 어깨너비 = 1, 원점 목, y 아래.
 *
 * 앱 → 페이지 (window message, 문자열 JSON 도 받는다)
 *   { type: 'avatar3d-motion', fps, frames, joints: 125, data: base64(float32 [frames×125×3]), loop? }   ← /generate 응답 그대로
 *   { type: 'avatar3d-motion', fps, poses: [[[x,y,z] × 55 이상] × frames] }                      ← 좌표 배열
 *   { type: 'avatar3d-play' } · { type: 'avatar3d-pause' } · { type: 'avatar3d-rate', rate } · { type: 'avatar3d-seek', t: 0~1 }
 * 페이지 → 앱
 *   { type: 'avatar3d-ready' } · { type: 'avatar3d-frame', frame } (프레임이 바뀔 때마다) · { type: 'avatar3d-end' } (loop 가 아닐 때)
 *   { type: 'avatar3d-fps', fps } · { type: 'avatar3d-error', message }
 *
 * 확인용: ?demo=word|sentence&src=orig|e5 (demo/clips.json 은 AI Hub 파생물이라 git 에 올리지 않는다)
 */
const qs = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function post(msg) {
  const s = JSON.stringify(msg);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (window.parent !== window) window.parent.postMessage(msg, '*');
}

/* ── 무대: 투명 캔버스(뒤는 앱의 종이), 따뜻한 빛. 휴대폰을 생각해 그림자는 끈다 ── */
const host = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, .05, 60);
scene.add(new THREE.HemisphereLight(0xFFFBF2, 0xEADFC8, 1.7));
const key = new THREE.DirectionalLight(0xFFF4E2, 2.0); key.position.set(3, 7, 5); scene.add(key);
const fill = new THREE.DirectionalLight(0xF4EEFF, .6); fill.position.set(-5, 2, 3); scene.add(fill);

// 상체가 화면에 꽉 차게: 머리 위(+1.05) ~ 내린 손 끝(-1.7), 양팔 폭 ±1.25
const FRAME = { top: 1.05, bottom: -1.7, half: 1.25 };
function resize() {
  const w = innerWidth, h = innerHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const needH = (FRAME.top - FRAME.bottom) * 1.06;
  const needW = FRAME.half * 2 * 1.06;
  const dist = Math.max(needH / (2 * Math.tan(fov / 2)), needW / (2 * Math.tan(fov / 2) * camera.aspect));
  const cy = (FRAME.top + FRAME.bottom) / 2;
  camera.position.set(0, cy + .15, dist);
  camera.lookAt(0, cy, 0);
  camera.updateProjectionMatrix();
  for (const m of G.lineMats) m.resolution.set(w, h);
}
addEventListener('resize', resize);
resize();

/* ── 동작 받기 ── */
function decodeB64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
/** 어떤 형식이 와도 [frames][55][3] 로 */
function toPoses(msg) {
  if (Array.isArray(msg.poses)) return msg.poses.map(f => f.slice(0, 55));
  const J = msg.joints || 125, T = msg.frames;
  if (!msg.data || !T) throw new Error('동작 좌표가 없어요');
  const a = decodeB64(msg.data);
  if (a.length !== T * J * 3) throw new Error(`좌표 수가 맞지 않아요 (${a.length} ≠ ${T}×${J}×3)`);
  const out = [];
  for (let t = 0; t < T; t++) {
    const f = [];
    for (let j = 0; j < 55; j++) { const o = (t * J + j) * 3; f.push([a[o], a[o + 1], a[o + 2]]); }
    out.push(f);
  }
  return out;
}

let actor = null, fps = 30, playing = true, rate = 1, f = 0, paintT = 1, loopOn = true, lastFrame = -1, ended = false;
function setMotion(poses, motionFps = 30, motionLoop = true) {
  if (!poses.length) throw new Error('재생할 동작이 없어요');
  if (actor) { scene.remove(actor.group); actor.group.traverse(o => o.geometry?.dispose?.()); }
  // 처음 한 번은 연필 스케치에서 물감이 번지며 칠해진다 (발표 영상의 장면 진입과 같다)
  const first = !actor;
  actor = new Actor(poses, { tone: qs.get('tone') || 'orig' });
  scene.add(actor.group);
  fps = motionFps || 30; f = 0; playing = true; loopOn = motionLoop !== false; lastFrame = -1; ended = false;
  paintT = first && !reduced ? 0 : 1;
}

function handle(raw) {
  let msg = raw;
  if (typeof raw === 'string') { try { msg = JSON.parse(raw); } catch { return; } }
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('avatar3d-')) return;
  try {
    if (msg.type === 'avatar3d-motion') setMotion(toPoses(msg), msg.fps, msg.loop);
    else if (msg.type === 'avatar3d-play') { if (actor && f >= actor.T - 1) { f = 0; ended = false; } playing = true; }
    else if (msg.type === 'avatar3d-pause') playing = false;
    else if (msg.type === 'avatar3d-rate') rate = Math.max(.1, Math.min(2, +msg.rate || 1));
    else if (msg.type === 'avatar3d-seek' && actor) f = Math.max(0, Math.min(1, +msg.t || 0)) * (actor.T - 1);
  } catch (e) {
    post({ type: 'avatar3d-error', message: e.message || String(e) });
  }
}
addEventListener('message', e => handle(e.data));
document.addEventListener('message', e => handle(e.data));   // 안드로이드 WebView
window.avatar3d = handle;                                     // injectJavaScript 용

/* ── 캐릭터를 누르면 콩 뛰기 ── */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', e => {
  if (!actor) return;
  ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  if (ray.intersectObject(actor.group, true).length) actor.hop();
});

/* ── 그리기 ── */
const clock = new THREE.Clock();
let boilAcc = 0, fpsAcc = 0, fpsN = 0, loopWait = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .1);
  if (!reduced && (boilAcc += dt) > .16) { boilAcc = 0; G.boil.value = G.boil.value % 4 + 1; }   // 먹선이 0.16초마다 떨린다
  if (actor) {
    if (paintT < 1) { paintT = Math.min(1, paintT + dt / 1.2); G.scene.value = paintT * paintT * (3 - 2 * paintT); actor.setPaint(G.scene.value); }
    if (playing) {
      if (f >= actor.T - 1) {
        // 반복이면 0.8초 쉬었다가 처음부터 (영상 반복 재생처럼), 아니면 끝났다고 알린다
        if (loopOn) { if ((loopWait += dt) > .8) { loopWait = 0; f = 0; } }
        else if (!ended) { ended = true; post({ type: 'avatar3d-end' }); }
      } else f = Math.min(actor.T - 1, f + dt * fps * rate);
    }
    actor.setFrame(f);
    actor.tick(dt);
    const fi = Math.floor(f);
    if (fi !== lastFrame) { lastFrame = fi; post({ type: 'avatar3d-frame', frame: fi }); }
  }
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) { post({ type: 'avatar3d-fps', fps: Math.round(fpsN / fpsAcc) }); window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
}
loop();

/* ── 확인용 데모 ── */
const demo = qs.get('demo');
if (demo) {
  const name = demo === 'sentence' ? 'SEN1384_REAL03' : 'WORD0773_REAL03';
  fetch('demo/clips.json').then(r => r.json()).then(d => {
    const c = d[name];
    setMotion((qs.get('src') === 'e5' ? c.recon_e5 : c.orig).map(fr => fr.slice(0, 55)), 30);
    document.getElementById('label').textContent = c.gloss.join(' ');
  }).catch(e => post({ type: 'avatar3d-error', message: '데모 동작을 읽지 못했어요: ' + e.message }));
}
post({ type: 'avatar3d-ready' });
