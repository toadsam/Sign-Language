import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { COLOR, paint, inkify, inkMaterial, G } from './util.js';

/**
 * 수채로 칠한 3D 캐릭터(먹선 테두리). 실제 125점 좌표(상체 13 + 양손 42)를 그대로 따라 움직인다.
 * 머리는 두 눈(9,10)과 목(1)으로 방향을 잡은 동그란 머리, 귀는 데이터의 귀 좌표(11,12)에 달린 작은 공.
 * 몸통은 목~골반 사이 콩 모양, 팔은 소매, 손가락은 통통한 원통. 얼굴 70점은 쓰지 않는다(표정은 데이터에서 만들지 않음).
 *
 * tone: 'orig'(하늘색 옷, 실제 사람) | 'e5'(노란 옷, 자모표 E5 복원) | 'e4b'(회색 옷, 단어로만 배운 자모표)
 * setFrame(f) 소수 프레임 보간, setPose(P) 자세 하나 직접, jointWorld(j) 관절 월드 좌표, hop() 콩 뛰기
 * setPaint(p) 0 = 연필 스케치, 1 = 다 칠함 (물감이 번지며 칠해진다)
 */
const HAND_PARENTS = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19];
const FINGER_EDGES = HAND_PARENTS.map((p, i) => [p, i]).filter(([p]) => p >= 0);
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
const UNIT_SPH = new THREE.SphereGeometry(1, 20, 14);
const BEAN = new THREE.CapsuleGeometry(.5, 1, 8, 20);   // 높이 2, 반지름 .5
const UP = new THREE.Vector3(0, 1, 0);

const TONES = {
  orig: { shirt: COLOR.shirt, hair: COLOR.hair },
  e5: { shirt: COLOR.e5, hair: 0x6E4E2E },
  e4b: { shirt: COLOR.e4b, hair: 0x7A6F66 },
};

export class Actor {
  constructor(frames, { tone = 'orig' } = {}) {
    this.frames = frames; this.T = frames.length;
    this.group = new THREE.Group();          // 장면이 위치를 정한다
    this.body = new THREE.Group();           // hop 같은 귀여운 움직임
    this.group.add(this.body);
    this.group.userData.actor = this;
    const tc = TONES[tone] ?? TONES.orig;
    this.paintU = { value: 1 };
    const P = c => paint(c, { paint: this.paintU });
    this.mats = {
      shirt: P(tc.shirt), skin: P(COLOR.skin), hair: P(tc.hair),
      right: P(COLOR.right), left: P(COLOR.left),
      eye: new THREE.MeshBasicMaterial({ color: COLOR.ink }), shine: new THREE.MeshBasicMaterial({ color: 0xFFFDF6 }),
      cheek: new THREE.MeshBasicMaterial({ color: COLOR.cheek, transparent: true, opacity: .6 }),
      line: new THREE.LineDashedMaterial({ color: COLOR.coral, dashSize: .12, gapSize: .08, transparent: true }),
      ink: inkMaterial(), inkThin: inkMaterial({ px: .6 }),
    };
    const add = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.matrixAutoUpdate = false; this.body.add(m); return m; };

    // 몸통·팔
    this.torso = add(BEAN, this.mats.shirt);
    this.neck = add(UNIT_CYL, this.mats.skin);
    this.limbs = [[2, 3], [3, 4], [5, 6], [6, 7]].map(([a, b]) => ({ a, b, m: add(UNIT_CYL, this.mats.shirt) }));
    this.knobs = [2, 3, 5, 6].map(j => ({ j, m: add(UNIT_SPH, this.mats.shirt) }));
    this.cuffs = [[4, 'right'], [7, 'left']].map(([j, c]) => ({ j, m: add(new THREE.TorusGeometry(1, .38, 10, 20), this.mats[c]) }));

    // 손: 손가락 원통 + 마디 공 (인스턴스)
    this.fingers = new THREE.InstancedMesh(UNIT_CYL, this.mats.skin, FINGER_EDGES.length * 2);
    this.fingerJoints = new THREE.InstancedMesh(UNIT_SPH, this.mats.skin, 42);
    for (const m of [this.fingers, this.fingerJoints]) { m.castShadow = true; m.frustumCulled = false; this.body.add(m); }
    this.palms = [add(UNIT_SPH, this.mats.skin), add(UNIT_SPH, this.mats.skin)];

    // 머리
    this.head = new THREE.Group(); this.head.matrixAutoUpdate = false; this.body.add(this.head);
    const hm = (geo, mat, x, y, z, s = [1, 1, 1], shadow = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(...s); m.castShadow = shadow; this.head.add(m); return m; };
    hm(UNIT_SPH, this.mats.skin, 0, 0, 0, [.40, .38, .37], true);
    const hair = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * .52);
    hm(hair, this.mats.hair, 0, .03, -.02, [.425, .41, .405], true).rotation.x = -.38;
    this.face = [];
    this.eyes = [];
    for (const sx of [-1, 1]) {
      const eye = hm(UNIT_SPH, this.mats.eye, sx * .135, -.02, .335, [.042, .055, .03]);
      const shine = hm(UNIT_SPH, this.mats.shine, sx * .135 + .014, .0, .362, [.014, .016, .01]);
      const cheek = hm(new THREE.CircleGeometry(1, 20), this.mats.cheek, sx * .235, -.11, .3, [.06, .038, 1]); cheek.rotation.y = sx * .55;
      this.eyes.push(eye, shine); this.face.push(eye, shine, cheek);
    }
    const smile = hm(new THREE.TorusGeometry(.045, .011, 6, 16, Math.PI), this.mats.eye, 0, -.115, .345);
    smile.rotation.z = Math.PI; this.face.push(smile);
    this.blinkIn = 1 + Math.random() * 3; this.blinkT = 1;
    // 귀 (데이터 좌표를 따른다)
    this.ears = [11, 12].map(j => ({ j, m: add(UNIT_SPH, this.mats.skin) }));
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.earLine = new THREE.Line(lg, this.mats.line); this.earLine.visible = false; this.body.add(this.earLine);
    // 먹선: 눈·볼·입 같은 작은 것은 빼고
    const small = new Set([...this.face]);
    inkify(this.body, this.mats.ink, { skip: o => small.has(o) });
    for (const m of [this.fingers, this.fingerJoints, ...this.palms]) for (const c of m.children) if (c.userData.isInk) c.material = this.mats.inkThin;

    this._p = Array.from({ length: 55 }, () => new THREE.Vector3());
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._basis = new THREE.Matrix4(); this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.hopT = 9; this._op = 1;
    this.setFrame(0);
  }

  setFrame(f) {
    const T = this.T; f = Math.max(0, Math.min(T - 1, f));
    const i = Math.floor(f), k = f - i;
    this.frame = f;
    this._apply(this.frames[i], this.frames[Math.min(T - 1, i + 1)], k);
  }
  setPose(P) { this._apply(P, P, 0); }

  _seg(mesh, a, b, r) {
    this._d.subVectors(b, a); const len = this._d.length() || 1e-6;
    this._q.setFromUnitVectors(UP, this._d.multiplyScalar(1 / len));
    this._m.compose(this._v[3].copy(a).lerp(b, .5), this._q, this._s.set(r, len, r));
    return this._m;
  }

  _apply(A, B, k) {
    const p = this._p;
    for (let j = 0; j < 55; j++) {
      const a = A[j], b = B[j];
      p[j].set(a[0] + (b[0] - a[0]) * k, -(a[1] + (b[1] - a[1]) * k), -(a[2] + (b[2] - a[2]) * k));
    }
    const [x, y, z] = this._v;
    // 몸통: 위 = 골반→목, 오른쪽 = 오른어깨→왼어깨
    y.subVectors(p[1], p[8]); const H = y.length(); y.normalize();
    x.subVectors(p[5], p[2]); const W = x.length(); x.addScaledVector(y, -x.dot(y)).normalize();
    z.crossVectors(x, y);
    this._basis.makeBasis(x, y, z);
    this._q.setFromRotationMatrix(this._basis);
    const c = this._v[3].copy(p[1]).addScaledVector(y, -H * .48);
    this.torso.matrix.compose(c, this._q, this._s.set(W * .82, H * .48, W * .42));
    // 팔
    for (const l of this.limbs) l.m.matrix.copy(this._seg(l.m, p[l.a], p[l.b], .085));
    for (const kb of this.knobs) kb.m.matrix.compose(p[kb.j], this._q.identity(), this._s.setScalar(.088));
    for (const cf of this.cuffs) {
      const elbow = cf.j === 4 ? p[3] : p[6];
      this._d.subVectors(p[cf.j], elbow).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._d);
      cf.m.matrix.compose(this._v[3].copy(p[cf.j]).addScaledVector(this._d, -.03), this._q, this._s.setScalar(.075));
    }
    // 손가락
    let n = 0;
    for (const base of [13, 34]) for (const [pa, ch] of FINGER_EDGES) this.fingers.setMatrixAt(n++, this._seg(null, p[base + pa], p[base + ch], .024));
    for (let j = 0; j < 42; j++) this.fingerJoints.setMatrixAt(j, this._m.compose(p[13 + j], this._q.identity(), this._s.setScalar(j % 21 === 0 ? .045 : .027)));
    this.fingers.count = n; this.fingers.instanceMatrix.needsUpdate = true; this.fingerJoints.instanceMatrix.needsUpdate = true;
    // 손바닥: 손목과 가운데 손가락 뿌리 사이
    [13, 34].forEach((base, i) => { const c2 = this._v[3].copy(p[base]).lerp(p[base + 9], .55); this.palms[i].matrix.compose(c2, this._q.identity(), this._s.setScalar(.055)); });
    // 머리: 오른쪽 = 오른눈→왼눈, 위 = 목→두 눈 가운데
    const eyeMid = this._d.copy(p[9]).add(p[10]).multiplyScalar(.5);
    x.subVectors(p[10], p[9]).normalize();
    y.subVectors(eyeMid, p[1]).normalize(); y.addScaledVector(x, -y.dot(x)).normalize();
    z.crossVectors(x, y);
    this._basis.makeBasis(x, y, z);
    this._q.setFromRotationMatrix(this._basis);
    // 머리는 큼직하게, 어깨 위에 바로 얹는다 (방향만 데이터에서)
    const hc = this._v[3].copy(p[1]).addScaledVector(y, .5).addScaledVector(z, .02);
    this.head.matrix.compose(hc, this._q, this._s.set(1, 1, 1));
    this.headCenter = hc.clone();
    const chin = hc.clone().addScaledVector(y, -.25);
    this.neck.matrix.copy(this._seg(null, p[1], chin, .11));
    // 귀
    let far = null;
    for (const e of this.ears) {
      const isFar = p[e.j].distanceTo(hc) > .9;
      e.m.matrix.compose(p[e.j], this._q.identity(), this._s.setScalar(isFar ? .35 : .075)); // 멀리 떨어진 귀는 크게 보여 준다
      if (isFar) far = p[e.j];
    }
    this.earLine.visible = !!far;
    if (far) { const pos = this.earLine.geometry.attributes.position; pos.setXYZ(0, hc.x, hc.y, hc.z); pos.setXYZ(1, far.x, far.y, far.z); pos.needsUpdate = true; this.earLine.computeLineDistances(); }
    for (const m of this.body.children) if (m.matrixAutoUpdate === false) m.matrixWorldNeedsUpdate = true;
  }

  /** 클릭하면 콩 뛰기 */
  hop() { this.hopT = 0; }
  /** 얼굴(눈·볼·입)을 숨긴다. 겹쳐 그릴 때 얼굴이 두 개 보이지 않게 */
  showFace(on) { for (const m of this.face) m.visible = on; }

  tick(dt) {
    // 눈 깜빡임: 2~5초마다 0.16초
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinkT = 0; this.blinkIn = 2 + Math.random() * 3; }
    if (this.blinkT < 1) { this.blinkT = Math.min(1, this.blinkT + dt / .16); }
    const lid = this.blinkT < 1 ? Math.abs(Math.cos(this.blinkT * Math.PI)) * .9 + .1 : 1;
    for (let i = 0; i < this.eyes.length; i += 2) { this.eyes[i].scale.y = .055 * lid; this.eyes[i + 1].visible = lid > .6 && this.eyes[i].visible; }
    if (this.hopT < 1) { this.hopT += dt * 1.6; const h = Math.sin(Math.min(1, this.hopT) * Math.PI); this.body.position.y = h * .35; this.body.scale.set(1 + .06 * h, 1 - .05 * h, 1 + .06 * h); }
    else { this.body.position.y = 0; this.body.scale.set(1, 1, 1); }
  }

  jointWorld(j, out = new THREE.Vector3()) { return this.body.localToWorld(out.copy(this._p[j])); }

  /** 0 = 연필 스케치(종이 + 먹선), 1 = 물감으로 다 칠함 */
  setPaint(p) {
    this.paintU.value = p;
    this.mats.cheek.opacity = .6 * Math.min(1, p * 1.5) * this._op;
  }

  setOpacity(o) {
    this._op = o;
    for (const [k, m] of Object.entries(this.mats)) {
      // 반투명이어도 깊이는 쓴다: 몸이 먼저 그려져 깊이를 남기면 먹선 껍질의 안쪽이 가려져 테두리만 남는다
      if (k.startsWith('ink')) { m.uniforms.opacity.value = o; m.transparent = o < 1; continue; }
      const base = k === 'cheek' ? .6 * Math.min(1, this.paintU.value * 1.5) : 1;
      m.transparent = o < 1 || k === 'cheek' || k === 'line'; m.opacity = base * o; m.depthWrite = k !== 'cheek' && k !== 'line';
    }
  }
}

/** 굵기를 px 로 정하는 선 묶음 (Line2). update(Float32Array 6*n) */
export class FatLines {
  constructor(n, { color = COLOR.ink, width = 2.4, opacity = 1, onTop = true } = {}) {
    this.n = n;
    this.geo = new LineSegmentsGeometry();
    this.arr = new Float32Array(n * 6);
    this.geo.setPositions(this.arr);
    this.mat = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    this.mat.resolution.set(innerWidth || 1280, innerHeight || 720);
    G.lineMats.add(this.mat);
    if (onTop) { this.mat.depthTest = false; this.mat.depthWrite = false; this.mat.transparent = true; }   // 몸 속을 지나는 선도 위에 보이게
    this.obj = new LineSegments2(this.geo, this.mat);
    this.obj.frustumCulled = false; this.obj.renderOrder = onTop ? 6 : 0;
  }
  update(arr = this.arr) {
    const a = this.geo.attributes.instanceStart.data;
    a.array.set(arr); a.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
  dispose() { G.lineMats.delete(this.mat); }
}

/**
 * 연필 밑그림 사람: 같은 125점 중 상체·손을 선으로만 그린다(복원 동작을 '그 위에 따라 그린 선'으로 보여 줄 때).
 * 머리는 두 눈·목으로 방향을 잡은 동그라미.
 */
const BODY_EDGES = [[1, 8], [2, 5], [2, 3], [3, 4], [5, 6], [6, 7]];
export class Tracing {
  constructor(frames, { color = COLOR.ink, width = 2.2, opacity = .9 } = {}) {
    this.frames = frames; this.T = frames.length;
    this.group = new THREE.Group();
    this.nBody = BODY_EDGES.length + 16;
    this.body = new FatLines(this.nBody, { color, width: width * 1.25, opacity });
    this.hands = new FatLines(FINGER_EDGES.length * 2, { color, width, opacity });
    this.group.add(this.body.obj, this.hands.obj);
    this._p = Array.from({ length: 55 }, () => new THREE.Vector3());
    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.setFrame(0);
  }
  setFrame(f) {
    f = Math.max(0, Math.min(this.T - 1, f)); const i = Math.floor(f), k = f - i;
    const A = this.frames[i], B = this.frames[Math.min(this.T - 1, i + 1)], p = this._p;
    for (let j = 0; j < 55; j++) p[j].set(A[j][0] + (B[j][0] - A[j][0]) * k, -(A[j][1] + (B[j][1] - A[j][1]) * k), -(A[j][2] + (B[j][2] - A[j][2]) * k));
    const b = this.body.arr; let n = 0;
    const put = (arr, a, c) => { arr.set([a.x, a.y, a.z, c.x, c.y, c.z], n * 6); n++; };
    for (const [a, c] of BODY_EDGES) put(b, p[a], p[c]);
    // 머리 동그라미
    const [x, y, z, hc] = this._v;
    const eyeMid = hc.copy(p[9]).add(p[10]).multiplyScalar(.5);
    x.subVectors(p[10], p[9]).normalize();
    y.subVectors(eyeMid, p[1]).normalize(); y.addScaledVector(x, -y.dot(x)).normalize();
    hc.copy(p[1]).addScaledVector(y, .5);
    const q0 = new THREE.Vector3(), q1 = new THREE.Vector3();
    for (let s = 0; s < 16; s++) {
      const a0 = s / 16 * Math.PI * 2, a1 = (s + 1) / 16 * Math.PI * 2;
      q0.copy(hc).addScaledVector(x, Math.cos(a0) * .4).addScaledVector(y, Math.sin(a0) * .38);
      q1.copy(hc).addScaledVector(x, Math.cos(a1) * .4).addScaledVector(y, Math.sin(a1) * .38);
      put(b, q0, q1);
    }
    this.body.update();
    n = 0; const h = this.hands.arr;
    for (const base of [13, 34]) for (const [pa, ch] of FINGER_EDGES) put(h, p[base + pa], p[base + ch]);
    this.hands.update();
  }
  jointWorld(j, out = new THREE.Vector3()) { return this.group.localToWorld(out.copy(this._p[j])); }
  setOpacity(o) { for (const m of [this.body.mat, this.hands.mat]) { m.opacity = o * .9; m.transparent = true; } }
  dispose() { this.body.dispose(); this.hands.dispose(); }
}
