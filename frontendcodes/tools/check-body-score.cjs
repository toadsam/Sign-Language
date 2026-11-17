// 따라 하기 채점 검사. 수식으로 만든 가짜 동작만 쓴다 (AI Hub 파일 · 네트워크 · 카메라 없음).
// 실행: node tools/check-body-score.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../components/sign-camera/body-score.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = {};
vm.runInNewContext(compiled, { exports: mod, Float32Array, Int8Array, Math, Number, Array, Infinity });
const { scoreFollow, verdict } = mod;

const REST_R = [-0.6, 1.3], REST_L = [0.6, 1.3];
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
/** 손목이 쉬는 자리에서 keys 를 차례로 지나 다시 쉬는 자리로 */
function track(keys, rest) {
  const pts = [rest, ...keys, rest];
  return (t) => {
    const u = Math.min(0.9999, Math.max(0, t)) * (pts.length - 1), k = Math.floor(u), e = ease(u - k);
    return [lerp(pts[k][0], pts[k + 1][0], e), lerp(pts[k][1], pts[k + 1][1], e)];
  };
}
/** 55점 동작. right · left 는 t(0~1) → 손목 [x, y]. open 은 손가락을 편 정도(0 주먹 ~ 1 편 손) */
function motion({ frames = 60, right = () => REST_R, left = () => REST_L, open = 1, openLeft = 1, idleBefore = 0, noise = 0, seed = 1, stride = 165 }) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return (s / 4294967296 - 0.5) * 2 * noise; };
  const total = frames + idleBefore;
  const data = new Float32Array(total * stride);
  for (let f = 0; f < total; f++) {
    const t = f < idleBefore ? 0 : (f - idleBefore) / (frames - 1);
    const p = new Array(55).fill(0).map(() => [0, 0, 0]);
    const rw = right(t), lw = left(t);
    p[0] = [0, -0.62]; p[2] = [-0.5, 0]; p[5] = [0.5, 0]; p[8] = [0, 1.45];
    p[9] = [-0.09, -0.68]; p[10] = [0.09, -0.68]; p[11] = [-0.2, -0.64]; p[12] = [0.2, -0.64];
    p[4] = rw; p[3] = [(rw[0] - 0.5) / 2 - 0.15, (rw[1]) / 2 + 0.2];
    p[7] = lw; p[6] = [(lw[0] + 0.5) / 2 + 0.15, (lw[1]) / 2 + 0.2];
    const hand = (root, w, amount) => {
      p[root] = w;
      for (let j = 1; j <= 20; j++) {
        const finger = Math.floor((j - 1) / 4), seg = ((j - 1) % 4) + 1;
        // 주먹(0)은 손가락이 손목 가까이 모이고, 편 손(1)은 길게 벌어진다
        const reach = lerp(0.03 + 0.012 * seg, 0.06 + 0.05 * seg, amount);
        p[root + j] = [w[0] + (finger - 2) * lerp(0.012, 0.035, amount), w[1] - reach];
      }
    };
    hand(13, lw, openLeft); hand(34, rw, open);
    for (let j = 0; j < 55; j++) { data[f * stride + j * 3] = p[j][0] + rnd(); data[f * stride + j * 3 + 1] = p[j][1] + rnd(); }
  }
  return { frames: total, fps: 30, data, stride };
}
/** 좌우를 뒤집고 양손을 바꾼 동작 (거울처럼 따라 한 사람) */
function mirror(m) {
  const data = new Float32Array(m.data.length), swap = (j) => (j === 2 ? 5 : j === 3 ? 6 : j === 4 ? 7 : j === 5 ? 2 : j === 6 ? 3 : j === 7 ? 4 : j === 9 ? 10 : j === 10 ? 9 : j === 11 ? 12 : j === 12 ? 11 : j >= 13 && j < 34 ? j + 21 : j >= 34 ? j - 21 : j);
  for (let f = 0; f < m.frames; f++) for (let j = 0; j < 55; j++) {
    const a = f * m.stride + j * 3, b = f * m.stride + swap(j) * 3;
    data[b] = -m.data[a]; data[b + 1] = m.data[a + 1]; data[b + 2] = m.data[a + 2];
  }
  return { ...m, data };
}

// 친구 동작: 오른손을 가슴 앞으로 올려 옆으로 움직였다가 내린다. 편 손
const signA = track([[-0.2, 0.42], [0.05, 0.3], [-0.25, 0.36]], REST_R);
const friend = motion({ frames: 60, right: signA, open: 1 });

// 1. 똑같이 하면 100점
const same = scoreFollow(friend, friend);
assert.equal(same.score, 100);
assert.equal(same.mirrored, false);
assert.equal(Array.from(same.hints).length, 0, '똑같으면 고칠 말이 없다');
assert.equal(same.parts.leftHand, null, '친구가 쓰지 않는 손은 손 모양을 견주지 않는다');

// 2. 더 느리게, 서서 기다렸다가, 조금 떨면서 해도 높은 점수 (시간 맞추기 · 앞뒤 자르기)
const slow = scoreFollow(motion({ frames: 86, right: signA, open: 1, idleBefore: 40, noise: 0.015, seed: 7 }), friend);
assert.ok(slow.score >= 85, '느리고 떨려도 85점 이상: ' + slow.score);
assert.ok(slow.compared.mine < 126, '앞의 기다린 구간은 잘라 낸다: ' + slow.compared.mine);

// 3. 전혀 다른 동작은 낮은 점수
const signB = track([[-0.75, -0.25], [-0.7, 0.1], [-0.8, -0.3]], REST_R);
const other = scoreFollow(motion({ frames: 60, right: signB, open: 0 }), friend);
assert.ok(other.score <= 45, '다른 동작은 45점 이하: ' + other.score);
assert.ok(other.score < slow.score - 35);

// 4. 손을 낮게 들면 "더 높이"
const low = scoreFollow(motion({ frames: 60, right: (t) => { const p = signA(t); return [p[0], Math.min(1.3, p[1] + 0.3)]; }, open: 1 }), friend);
// 2026-11-17 승혁: 새 기준선은 자리 거리 0.201(어깨너비의 약 20%) 이하를 100점으로 본다(실제로 잘 따라 한 거리).
// 이 정도로 조금 낮은 손은 점수가 같을 수 있으므로, 점수는 같거나 낮고 "더 높이" 안내가 나오는지를 본다.
assert.ok(low.score <= same.score);
assert.ok(Array.from(low.hints).some((h) => h.includes('오른손') && h.includes('더 높이')), '낮으면 더 높이: ' + Array.from(low.hints).join(' / '));
// 손을 너무 바깥으로 뻗으면 "몸 쪽으로"
const wide = scoreFollow(motion({ frames: 60, right: (t) => { const p = signA(t), r = p[1] < 1.1 ? 0.3 : 0; return [p[0] - r, p[1]]; }, open: 1 }), friend);
assert.ok(Array.from(wide.hints).some((h) => h.includes('오른손') && h.includes('몸 쪽으로')), '바깥이면 몸 쪽으로: ' + Array.from(wide.hints).join(' / '));

// 5. 거울처럼 반대 손으로 하면 알아챈다
const mir = scoreFollow(mirror(friend), friend);
assert.equal(mir.mirrored, true);
assert.ok(Array.from(mir.hints)[0].includes('거울'), '거울 안내가 맨 앞');
assert.ok(mir.score < 70, '반대 손은 감점: ' + mir.score);

// 6. 자리는 같은데 주먹을 쥐면 손 모양만 깎인다
const fist = scoreFollow(motion({ frames: 60, right: signA, open: 0 }), friend);
assert.equal(fist.position.score, 100);
assert.ok(fist.shape.score < 70, '손 모양 점수가 깎인다: ' + fist.shape.score);
assert.ok(Array.from(fist.hints).some((h) => h.includes('오른손 손가락 모양')));

// 7. 손이 화면에 안 잡혔으면 그렇게 알려 준다
const unseen = motion({ frames: 60, right: signA, open: 1 });
for (let f = 0; f < unseen.frames; f++) for (let j = 1; j <= 20; j++) { unseen.data[f * 165 + (34 + j) * 3] = unseen.data[f * 165 + 34 * 3]; unseen.data[f * 165 + (34 + j) * 3 + 1] = unseen.data[f * 165 + 34 * 3 + 1]; }
unseen.rightHand = new Array(unseen.frames).fill(false);
const hidden = scoreFollow(unseen, friend);
assert.ok(Array.from(hidden.hints).some((h) => h.includes('오른손이 화면에 잘 안 보였어요')));
assert.ok(hidden.score < 100 && hidden.position.score === 100);

// 8. 낱말마다 점수: 뒤 낱말만 다르게 하면 그 낱말이 가장 낮다
const first = track([[-0.2, 0.42], [0.05, 0.3]], REST_R), second = track([[-0.25, 0.0], [-0.1, -0.2]], REST_R), wrong = track([[-0.8, 0.6], [-0.75, 0.9]], REST_R);
const two = (b) => (t) => (t < 0.5 ? first(t * 2) : b((t - 0.5) * 2));
const friend2 = motion({ frames: 120, right: two(second), open: 1 });
const segments = [{ gloss: '학교', start: 4, end: 56 }, { gloss: '가다', start: 64, end: 116 }];
const half = scoreFollow(motion({ frames: 120, right: two(wrong), open: 1 }), friend2, segments);
assert.equal(half.words.length, 2);
assert.ok(half.words[0].score >= 85 && half.words[1].score < half.words[0].score - 30, '뒤 낱말만 낮다: ' + JSON.stringify(Array.from(half.words)));
assert.ok(Array.from(half.hints).some((h) => h.includes('「가다」')));
const both = scoreFollow(friend2, friend2, segments);
// 낱말 구간이 내 동작의 어느 장인지: 똑같이 했으면 친구 구간과 같고, 느리게 했으면 그만큼 늘어난다
assert.deepEqual(Array.from(both.aligned).map((x) => [x.gloss, ...x.friend, ...x.mine]), [['학교', 4, 56, 4, 56], ['가다', 64, 116, 64, 116]]);
const slow2 = scoreFollow(motion({ frames: 180, right: two(second), open: 1, idleBefore: 30 }), friend2, segments);
assert.ok(slow2.aligned[0].mine[0] >= 30 && slow2.aligned[1].mine[1] <= 210 && slow2.aligned[0].mine[1] <= slow2.aligned[1].mine[0] + 12, '느리게 한 내 동작에서도 낱말 구간이 순서대로 잡힌다: ' + JSON.stringify(Array.from(slow2.aligned)));
assert.ok(slow2.aligned[0].mine[1] - slow2.aligned[0].mine[0] > 60, '1.5배 느리면 구간도 길다');
assert.deepEqual(Array.from(same.active.friend).length, 2);
assert.deepEqual(Array.from(both.words).map((w) => w.score), [100, 100]);

// 9. 친구 동작이 125점이어도 같은 결과
const wideFriend = { ...friend, stride: 375, data: new Float32Array(friend.frames * 375) };
for (let f = 0; f < friend.frames; f++) wideFriend.data.set(friend.data.subarray(f * 165, (f + 1) * 165), f * 375);
assert.equal(scoreFollow(motion({ frames: 86, right: signA, open: 1, idleBefore: 40, noise: 0.015, seed: 7 }), wideFriend).score, slow.score);

// 10. 견줄 것이 없으면 null, 점수 말
assert.equal(scoreFollow({ frames: 1, fps: 30, data: new Float32Array(165), stride: 165 }, friend), null);
assert.ok(verdict(100).includes('거의 같아요') && verdict(70).includes('거의 맞아요') && verdict(50).includes('조금') && verdict(10).includes('많이'));

// 11. 양손 동작: 왼손도 쓰는 친구를 한 손으로만 따라 하면 깎인다
const leftSign = track([[0.2, 0.42], [-0.05, 0.3]], REST_L);
const friendBoth = motion({ frames: 60, right: signA, left: leftSign, open: 1 });
const oneHand = scoreFollow(friend, friendBoth);
assert.ok(oneHand.score < 80 && oneHand.parts.leftArm > oneHand.parts.rightArm, '안 쓴 왼팔이 더 멀다: ' + oneHand.score);
assert.ok(Array.from(oneHand.hints).some((h) => h.includes('왼손')));

console.log('PASS 같으면 100 · 느리고 떨려도 ' + slow.score + ' · 다른 동작 ' + other.score + ' · 거울 ' + mir.score);
console.log('PASS 안내: 더 높이 · 몸 쪽으로 · 손가락 모양 · 화면에 안 보임 · 반대 손 · 가장 달랐던 낱말');
console.log('PASS 낱말마다 점수, 125점 동작, 양손 동작, 견줄 것이 없으면 null');
console.log('가짜 동작만 썼다. 손 자리 기준선은 2026-11-17 한 사람 · 한 문장의 웹캠 시도 10회로 맞춘 값이고, 손 모양 기준선은 임시값이다.');
