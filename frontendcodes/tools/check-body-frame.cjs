// 카메라 좌표 → 55점 변환 검사. 손으로 만든 가짜 좌표만 쓴다 (AI Hub 파일 · 네트워크 · 카메라 없음).
// 실행: node tools/check-body-frame.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, requireMap = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../components/sign-camera', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exportsObject = {};
  vm.runInNewContext(compiled, { exports: exportsObject, require: (name) => requireMap[name] ?? {}, Float32Array, Math, Number, Array });
  return exportsObject;
}
const frame = load('body-frame.ts');
const sequence = load('body-sequence.ts', { './body-frame': frame });
const { toBodyFrame, bodyEdges, BODY_JOINTS, LEFT_HAND, RIGHT_HAND } = frame;
const { BodySequence, resampleBody, bodyToMotion, summarizeBody, bodySequenceJson } = sequence;

const W = 640, H = 480;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const at = (f, j) => [f.points[j * 3], f.points[j * 3 + 1], f.points[j * 3 + 2]];

/** 카메라를 마주 보고 선 사람. 화면 좌표(0~1)로 만든다. 사람의 왼쪽은 화면 오른쪽이다 */
function person({ cx = 0.5, cy = 0.4, half = 0.1 } = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x: cx, y: cy, z: 0, visibility: 0.1 }));
  const set = (i, dx, dy, z = 0) => { pose[i] = { x: cx + dx * half * 2, y: cy + dy * half * 2 * (W / H), z, visibility: 0.99 }; };
  // dx · dy 는 어깨너비 단위 (y 는 픽셀 비율을 맞춰 준다)
  set(11, 0.5, 0); set(12, -0.5, 0);            // 왼어깨(화면 오른쪽), 오른어깨
  set(13, 0.7, 0.6); set(14, -0.7, 0.6);        // 팔꿈치
  set(15, 0.5, 0.2); set(16, -0.4, 0.3);        // 손목
  set(0, 0, -0.6, -0.1);                        // 코
  set(2, 0.09, -0.68); set(5, -0.09, -0.68);    // 왼눈, 오른눈
  set(7, 0.2, -0.64); set(8, -0.2, -0.64);      // 왼귀, 오른귀
  set(23, 0.3, 1.5); set(24, -0.3, 1.5);        // 골반
  return pose;
}
/** 손목이 (wx, wy)(화면 좌표)에 있는 손 21점. 손가락은 위로 뻗는다 */
function hand(wx, wy, size = 0.03) {
  return Array.from({ length: 21 }, (_, j) => ({ x: wx + ((j % 4) - 1.5) * size * 0.3, y: wy - Math.floor((j + 3) / 4) * size * 0.5, z: -0.001 * j }));
}
const capture = (pose, hands = [], t = 0, w = W, h = H) => ({ timestampMs: t, width: w, height: h, pose, hands });

// 1. 기본: 목이 원점, 어깨너비 1, 오른어깨가 왼쪽(-x)
const base = person();
const leftWrist = base[15], rightWrist = base[16];
const f1 = toBodyFrame(capture(base, [hand(leftWrist.x, leftWrist.y), hand(rightWrist.x, rightWrist.y)]));
assert.ok(f1, '상체가 보이면 좌표가 나와야 한다');
assert.equal(f1.points.length, BODY_JOINTS * 3);
assert.deepEqual(at(f1, 1), [0, 0, 0], '목이 원점');
assert.ok(close(at(f1, 5)[0], 0.5) && close(at(f1, 5)[1], 0), '왼어깨 (+0.5, 0)');
assert.ok(close(at(f1, 2)[0], -0.5) && close(at(f1, 2)[1], 0), '오른어깨 (-0.5, 0)');
assert.ok(at(f1, 0)[1] < -0.4, '코는 목 위(y 음수)');
assert.ok(close(at(f1, 8)[1], 1.5, 1e-5), '골반 가운데는 어깨너비 1.5 아래');
assert.equal(f1.flipped, false);
assert.deepEqual({ ...f1.mask }, { leftHand: true, rightHand: true, hip: true });
assert.ok(close(f1.shoulderPx, 0.2 * W), '어깨너비 픽셀');

// 2. 손이 맞는 손목에 붙고, 상체 손목이 손의 손목과 겹친다
const lw = at(f1, LEFT_HAND), rw = at(f1, RIGHT_HAND);
assert.ok(lw[0] > 0 && rw[0] < 0, '왼손은 +x 쪽, 오른손은 -x 쪽');
assert.ok(close(at(f1, 7)[0], lw[0]) && close(at(f1, 7)[1], lw[1]), '왼손목 = 왼손 0번');
assert.ok(close(at(f1, 4)[0], rw[0]) && close(at(f1, 4)[1], rw[1]), '오른손목 = 오른손 0번');
// 인식기가 손을 반대 순서로 줘도 같은 결과
const f1b = toBodyFrame(capture(base, [hand(rightWrist.x, rightWrist.y), hand(leftWrist.x, leftWrist.y)]));
f1.points.forEach((v, i) => assert.ok(close(v, f1b.points[i]), '손 순서가 바뀌어도 같은 좌표 ' + i));

// 3. 멀리 서거나 옆으로 비켜 서도 같은 좌표 (크기 · 위치와 무관)
const small = person({ cx: 0.3, cy: 0.55, half: 0.05 });
const f3 = toBodyFrame(capture(small, [hand(small[15].x, small[15].y, 0.015), hand(small[16].x, small[16].y, 0.015)]));
f1.points.forEach((v, i) => { if (i % 3 !== 2) assert.ok(close(v, f3.points[i], 1e-5), '크기 · 위치가 달라도 같은 x · y ' + i); });

// 4. 몸을 기울여도(화면 안에서 12도) 같은 좌표
const tilt = (p, deg, cx = 0.5, cy = 0.4) => {
  const a = (deg * Math.PI) / 180, dx = (p.x - cx) * W, dy = (p.y - cy) * H;
  return { ...p, x: cx + (dx * Math.cos(a) - dy * Math.sin(a)) / W, y: cy + (dx * Math.sin(a) + dy * Math.cos(a)) / H };
};
const hands0 = [hand(leftWrist.x, leftWrist.y), hand(rightWrist.x, rightWrist.y)];
const f4 = toBodyFrame(capture(base.map((p) => tilt(p, 12)), hands0.map((h) => h.map((p) => tilt(p, 12)))));
f1.points.forEach((v, i) => { if (i % 3 !== 2) assert.ok(close(v, f4.points[i], 1e-5), '기울여도 같은 x · y ' + i); });

// 5. 좌우가 뒤집힌 입력은 알아채고 되돌린다
const mirror = (p) => ({ ...p, x: 1 - p.x });
const f5 = toBodyFrame(capture(base.map(mirror), hands0.map((h) => h.map(mirror))));
assert.equal(f5.flipped, true);
f1.points.forEach((v, i) => { if (i % 3 !== 2) assert.ok(close(v, f5.points[i], 1e-5), '뒤집힌 입력도 같은 x · y ' + i); });

// 6. 손이 하나뿐이면 가까운 손목에 붙고, 못 본 손은 손목 자리에 모인다
const f6 = toBodyFrame(capture(base, [hand(rightWrist.x, rightWrist.y)]));
assert.deepEqual([f6.mask.leftHand, f6.mask.rightHand], [false, true]);
for (let j = 0; j < 21; j++) assert.deepEqual(at(f6, LEFT_HAND + j), at(f6, 7), '못 본 왼손은 왼손목 자리');
// 7. 손목에서 너무 먼 손(다른 사람 손 등)은 버린다
const f7 = toBodyFrame(capture(base, [hand(0.05, 0.05)]));
assert.deepEqual([f7.mask.leftHand, f7.mask.rightHand], [false, false]);

// 8. 골반이 화면 밖이면 어림 위치를 쓰고 표시한다
const noHip = person(); noHip[23].visibility = 0.1; noHip[24].visibility = 0.1;
const f8 = toBodyFrame(capture(noHip));
assert.equal(f8.mask.hip, false);
assert.deepEqual(at(f8, 8), [0, 1.45, 0]);

// 9. 기준이 없으면 null
assert.equal(toBodyFrame(capture(null, hands0)), null, '상체가 없으면 null');
const noShoulder = person(); noShoulder[11].visibility = 0.2;
assert.equal(toBodyFrame(capture(noShoulder)), null, '어깨가 안 보이면 null');
assert.equal(toBodyFrame(capture(person({ half: 0.005 }))), null, '어깨너비가 너무 작으면 null');
assert.equal(toBodyFrame(capture(base, [], 0, 0, 480)), null, '화면 크기가 틀리면 null');

// 10. 연결선은 55점 안에서만
const edges = bodyEdges();
assert.equal(edges.length, 12 + 20 + 20);
assert.ok(edges.every(([a, b]) => a >= 0 && b >= 0 && a < 55 && b < 55));

// 11. 들쭉날쭉한 시각 → 30fps 로 고르게
const seq = new BodySequence(1000, 5000);
const moving = (t, dx) => {
  const p = person();
  p[16] = { ...p[16], x: p[16].x + dx };
  return toBodyFrame(capture(p, [hand(p[15].x, p[15].y), hand(p[16].x, p[16].y)], t));
};
[[1000, 0], [1070, 0.007], [1130, 0.013], [1210, 0.021], [1300, 0.03]].forEach(([t, dx]) => seq.add(moving(t, dx), t));
seq.add(null, 1350);                         // 상체를 놓친 장
seq.add(moving(900, 0), 900);                // 시작 전 → 버림
seq.add(moving(7000, 0), 7000);              // 5초 뒤 → 버림
assert.equal(seq.frames.length, 5);
assert.equal(seq.missed, 1);
const body = resampleBody(seq.frames);
assert.equal(body.fps, 30);
assert.equal(body.frames, 10, '0.3초 → 30fps 로 10장');
assert.equal(body.data.length, 10 * 55 * 3);
const wristX = (i) => body.data[i * 165 + RIGHT_HAND * 3];
for (let i = 1; i < body.frames; i++) assert.ok(wristX(i) > wristX(i - 1), '오른손목이 고르게 한쪽으로 움직인다');
assert.ok(close(wristX(0), seq.frames[0].points[RIGHT_HAND * 3], 1e-6) && close(wristX(9), seq.frames[4].points[RIGHT_HAND * 3], 1e-6), '처음과 끝은 원래 값');
assert.equal(resampleBody(seq.frames.slice(0, 1)), null, '한 장으로는 못 만든다');

// 12. 3D 친구용 125점: 앞 55점만 채운다
const motion = bodyToMotion(body);
assert.equal(motion.data.length, body.frames * 125 * 3);
assert.equal(motion.frames, body.frames);
for (let i = 0; i < 165; i++) assert.equal(motion.data[375 * 3 + i], body.data[165 * 3 + i]);
for (let i = 165; i < 375; i++) assert.equal(motion.data[375 * 3 + i], 0);

// 13. 요약과 파일 모양
const sum = summarizeBody(seq);
assert.equal(sum.frames, 5); assert.equal(sum.missedBody, 1); assert.equal(sum.leftHandSeen, 1); assert.equal(sum.rightHandSeen, 1);
assert.ok(sum.observedHz > 12 && sum.observedHz < 15);
const json = bodySequenceJson(seq, 'check');
assert.equal(json.schema, 'signlingo-body-sequence-v1');
assert.equal(json.points.length, 5); assert.equal(json.points[0].length, 165);
assert.deepEqual(Array.from(json.timestampsMs), [0, 70, 130, 210, 300]);

console.log('PASS 목 원점 · 어깨너비 1 · 좌우 방향, 손 붙이기(순서 무관 · 하나뿐 · 너무 먼 손)');
console.log('PASS 크기 · 위치 · 기울기 · 좌우 뒤집힘에 같은 좌표, 골반 어림, 기준 없으면 null');
console.log('PASS 30fps 다시 뽑기, 3D 친구용 125점, 요약 · 파일 모양');
console.log('가짜 좌표만 썼다. 실제 카메라 · 사람 · MediaPipe 인식 품질은 검사하지 않는다.');
