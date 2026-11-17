// 따라 하기 기준선 계산 도구 검사. 손으로 만든 합성 기록만 쓴다 (카메라 · 좌표 · 네트워크 없음).
// 실행: node tools/check-follow-baseline.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const B = require('./follow-baseline.cjs');

const passed = [];
const line = (i, kind, score, pos, shape, extra = '') =>
  `${i}\t${kind}\t점수 ${score}\t자리 ${pos.toFixed(3)}\t모양 ${shape === null ? '없음' : shape.toFixed(3)}${extra}`;

// 1. 화면이 만드는 줄 형식이 이 도구가 읽는 형식과 같은지 (형식이 바뀌면 여기서 멈춘다)
const follow = fs.readFileSync(path.join(__dirname, '../components/sign-camera/FollowAlong.web.tsx'), 'utf8');
for (const piece of ['`${i + 1}\\t${a.kind}\\t점수 ${a.score}\\t자리 ${a.position.toFixed(3)}\\t모양 ${a.shape === null ? \'없음\' : a.shape.toFixed(3)}', "'\\t반대 손'", "['잘 따라 함', '대충 따라 함', '다른 동작']"])
  assert.ok(follow.includes(piece), `FollowAlong.web.tsx 기록 형식이 바뀌었습니다: ${piece}`);
const score = fs.readFileSync(path.join(__dirname, '../components/sign-camera/body-score.ts'), 'utf8');
for (const piece of ['Math.round(100 * Math.min(1, Math.max(0, 1 - (distance - best) / (worst - best))))', 'Math.round(0.6 * p + 0.4 * toScore(shape, SHAPE_RANGE))'])
  assert.ok(score.includes(piece), `body-score.ts 점수 식이 바뀌었습니다: ${piece}`);
passed.push('screen record format and score formula unchanged');

// 2. 줄 읽기
let r = B.parseLine(line(1, '잘 따라 함', 88, 0.15, 0.061, '\t병원 90, 가다 84'), 1);
assert.deepEqual(r, { kind: '잘 따라 함', score: 88, position: 0.15, shape: 0.061, mirrored: false });
r = B.parseLine(line(2, '다른 동작', 12, 0.44, null, '\t반대 손'), 2);
assert.equal(r.shape, null); assert.equal(r.mirrored, true);
assert.throws(() => B.parseRecords('1\t모르는 종류\t점수 1\t자리 0.1\t모양 0.1'), /1번째 줄.*알 수 없는 종류/);
assert.throws(() => B.parseRecords(`${line(1, '잘 따라 함', 80, 0.1, 0.05)}\n\n3\t잘 따라 함\t점수 x\t자리 0.1\t모양 0.1`), /3번째 줄.*점수/);
assert.throws(() => B.parseRecords('1\t잘 따라 함\t점수 80'), /칸이 5개보다 적음/);
assert.equal(B.parseRecords(`\n${line(1, '대충 따라 함', 50, 0.3, 0.1)}\r\n\n`).length, 1);
passed.push('line parsing, blank lines, error line numbers');

// 3. 분위수 · 점수 식
assert.equal(B.quantile([3, 1, 2], 0.5), 2); assert.equal(B.quantile([1, 2, 3, 4], 0.5), 2.5); assert.equal(B.quantile([], 0.5), null);
assert.equal(B.toScore(0.12, [0.12, 0.5]), 100); assert.equal(B.toScore(0.5, [0.12, 0.5]), 0); assert.equal(B.toScore(0.31, [0.12, 0.5]), 50);
assert.equal(B.combine({ position: 0.12, shape: null }, [0.12, 0.5], [0.05, 0.2]), 100);
assert.equal(B.combine({ position: 0.5, shape: 0.05 }, [0.12, 0.5], [0.05, 0.2]), 40);
passed.push('quantile and score formula');

// 4. 잘 갈리는 기록 → 제안, 잘못 통과 0
const good = [0.13, 0.14, 0.15, 0.16, 0.17].map((p, i) => ({ kind: '잘 따라 함', score: 0, position: p, shape: 0.05 + i * 0.005, mirrored: false }));
const other = [0.40, 0.42, 0.45, 0.48, 0.50].map((p, i) => ({ kind: '다른 동작', score: 0, position: p, shape: 0.16 + i * 0.01, mirrored: false }));
let s = B.suggest([...good, ...other]);
assert.deepEqual(s.suggestion, { position: [0.15, 0.45], shape: [0.06, 0.18] });
let e = B.evaluate(s.by, s.suggestion);
assert.equal(e.falsePass, 0); assert.equal(e.median['다른 동작'], 0); assert.equal(e.median['잘 따라 함'], 100);
passed.push('separated records give medians as range and no false pass');

// 5. 기록 부족 · 구분 안 됨 → 제안하지 않음
s = B.suggest([...good.slice(0, 4), ...other]);
assert.equal(s.suggestion, null); assert.match(s.reasons.join(), /"잘 따라 함" 기록이 4개/);
s = B.suggest([...good, ...good.map((g) => ({ ...g, kind: '다른 동작', position: g.position - 0.01 }))]);
assert.equal(s.suggestion, null); assert.match(s.reasons.join(), /자리 거리.*구분되지 않습니다/);
s = B.suggest([...good.map((g) => ({ ...g, shape: null })), ...other]);
assert.equal(s.suggestion, null); assert.match(s.reasons.join(), /모양 거리가 있는 기록이 한쪽에 없습니다/);
passed.push('too few, overlapping or missing shape records give no suggestion');

// 6. 지금 값 읽기와 실행
const current = B.readCurrentRanges(path.join(__dirname, '../components/sign-camera/body-score.ts'));
for (const r of [current.position, current.shape]) assert.ok(r.length === 2 && r.every(Number.isFinite) && 0 < r[0] && r[0] < r[1], `body-score.ts 범위를 읽지 못했습니다: ${r}`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-baseline-'));
const file = path.join(dir, 'records.txt');
fs.writeFileSync(file, [...good, ...other].map((x, i) => line(i + 1, x.kind, 0, x.position, x.shape)).join('\n'));
const out = execFileSync(process.execPath, [path.join(__dirname, 'follow-baseline.cjs'), file], { encoding: 'utf8' });
assert.match(out, /기록 10개/); assert.ok(out.includes(`지금 값: 자리 [${current.position.join(', ')}]`), '지금 값 줄');
assert.match(out, /const POSITION_RANGE: \[number, number\] = \[0\.15, 0\.45\];/); assert.match(out, /const SHAPE_RANGE: \[number, number\] = \[0\.06, 0\.18\];/);
fs.writeFileSync(file, '');
assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, 'follow-baseline.cjs'), file], { stdio: 'pipe' }), /기록 줄이 없습니다/);
fs.rmSync(dir, { recursive: true, force: true });
assert.equal(fs.readFileSync(path.join(__dirname, '../components/sign-camera/body-score.ts'), 'utf8'), score);
passed.push('reads current ranges, CLI prints suggestion, empty file fails, body-score.ts untouched');

console.log(JSON.stringify({ synthetic: true, camera: false, passed }, null, 2));
