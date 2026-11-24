// 재생 프레임 고르기(components/sign-player/frame-pick.ts) 검사.
// 실제 화면이 아니라, 흔들림이 있는 rAF 시각을 흉내 내어 예전 방식(Math.floor)과 새 방식을 견준다.
// 실행: node tools/check-frame-pick.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'components', 'sign-player', 'frame-pick.ts');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { module: mod, exports: mod.exports }, { filename: file });
const { pickFrame } = mod.exports;

// 늘 같은 결과가 나오는 흔들림 (선형 합동 난수)
function jitterSource(seed) {
  let s = seed >>> 0;
  return (ms) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 2 ** 32 - 0.5) * 2 * ms; };
}

// SignPlayer의 tick과 같은 순서로 커서를 움직이며, 화면마다 보인 프레임을 모은다
function simulate({ hz, fps = 30, speed = 1, ticks = 1200, jitterMs = 0.3, frames = 120, useNew }) {
  const jitter = jitterSource(7);
  let cursor = 0, last;
  const shown = [];
  for (let k = 0; k < ticks; k++) {
    const now = (k * 1000) / hz + jitter(jitterMs);
    const dt = last === undefined ? 0 : Math.min((now - last) / 1000, 0.1);
    last = now;
    const step = dt * fps * speed;
    cursor += step;
    if (cursor >= frames) cursor %= frames;
    shown.push(useNew ? pickFrame(cursor, step, 0, frames - 1) : Math.floor(cursor));
  }
  return shown;
}

// 한 프레임이 몇 화면 동안 보였는지 (처음 · 끝 구간과 되감기는 뺀다)
function holds(shown) {
  const runs = [];
  let n = 1;
  for (let i = 1; i < shown.length; i++) {
    if (shown[i] === shown[i - 1]) { n++; continue; }
    if (shown[i] < shown[i - 1]) { n = 1; continue; } // 되감기
    runs.push({ n, jump: shown[i] - shown[i - 1] });
    n = 1;
  }
  return runs.slice(1);
}
const uneven = (runs, expected) => runs.filter((r) => r.n !== expected).length;
const skipped = (runs) => runs.filter((r) => r.jump > 1).length;

let ok = 0;
const pass = (name) => { ok++; console.log(`PASS ${name}`); };

// 1. 60Hz · 1배속: 예전 방식은 고르지 않고, 새 방식은 모든 장이 화면 2번씩
{
  const oldRuns = holds(simulate({ hz: 60, useNew: false }));
  const newRuns = holds(simulate({ hz: 60, useNew: true }));
  assert.ok(uneven(oldRuns, 2) > 0, '예전 방식이 흔들림에 고르지 않아야 시험이 의미 있다');
  assert.equal(uneven(newRuns, 2), 0, `새 방식에서 고르지 않은 장 ${uneven(newRuns, 2)}`);
  assert.equal(skipped(newRuns), 0);
  pass(`60Hz 1배속: 고르지 않은 장 예전 ${uneven(oldRuns, 2)}개 → 새 방식 0개 (장 ${newRuns.length}개 중)`);
}

// 2. 120Hz 화면: 모든 장이 화면 4번씩
{
  const oldRuns = holds(simulate({ hz: 120, ticks: 2400, useNew: false }));
  const newRuns = holds(simulate({ hz: 120, ticks: 2400, useNew: true }));
  assert.equal(uneven(newRuns, 4), 0, `120Hz 새 방식 고르지 않은 장 ${uneven(newRuns, 4)}`);
  assert.equal(skipped(newRuns), 0);
  pass(`120Hz 1배속: 고르지 않은 장 예전 ${uneven(oldRuns, 4)}개 → 새 방식 0개`);
}

// 3. 60Hz · 2배속: 화면마다 한 장씩, 건너뛰거나 겹치지 않는다
{
  const oldRuns = holds(simulate({ hz: 60, speed: 2, useNew: false }));
  const newRuns = holds(simulate({ hz: 60, speed: 2, useNew: true }));
  assert.equal(uneven(newRuns, 1) + skipped(newRuns), 0);
  pass(`60Hz 2배속: 건너뜀 · 겹침 예전 ${uneven(oldRuns, 1) + skipped(oldRuns)}개 → 새 방식 0개`);
}

// 4. 흔들림이 없으면 두 방식 모두 고르다 (새 방식이 다른 문제를 만들지 않는다)
{
  const newRuns = holds(simulate({ hz: 60, jitterMs: 0, useNew: true }));
  assert.equal(uneven(newRuns, 2) + skipped(newRuns), 0);
  pass('흔들림 없음: 새 방식도 고르다');
}

// 5. 구간 끝과 이상한 입력
assert.equal(pickFrame(119.6, 0.5, 0, 119), 119, '마지막 장');
assert.equal(pickFrame(119.8, 0.5, 0, 119), 0, '마지막 장 다음 경계도 앞당겨 처음으로 돈다');
assert.equal(pickFrame(10.8, 0.5, 5, 10), 5, '반복 구간 끝 다음은 반복 시작');
assert.equal(pickFrame(4.9, 0, 5, 20), 5, '반복 구간 시작보다 앞서지 않는다');
assert.equal(pickFrame(3.4, 0, 0, 119), 3, '첫 화면(이동량 0)은 예전과 같다');
assert.equal(pickFrame(3.4, Number.NaN, 0, 119), 3, '이동량이 이상하면 앞당기지 않는다');
assert.equal(pickFrame(3.4, 5, 0, 119), 3, '이동량이 1보다 커도 반 장까지만 앞당긴다');
pass('구간 끝에서 처음으로 돌기 · 시작 · 이상한 이동량');

console.log(`${ok}개 항목 통과. 흔들림을 흉내 낸 계산이며 실제 화면 측정(슬로모션)은 따로 한다.`);
