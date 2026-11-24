// 통역 화면의 AI 동작 안내 문구 검사 (lib/motion-note.ts).
// 2026-11-24: 배포판(explicit=false)에서 AI 동작을 못 받으면 조용히 1학기 영상으로 넘어가던 것을 고쳤다.
// 실행: node tools/check-motion-note.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'lib', 'motion-note.ts');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { module: mod, exports: mod.exports, require: () => ({}) }, { filename: file });
const { motionNoteFor } = mod.exports;

let n = 0;
const ok = (name) => { n += 1; console.log(`PASS ${name}`); };

const down = { kind: 'error', code: 'SERVICE_UNAVAILABLE', message: '추론 서버에 연결할 수 없습니다.', retryable: true };
const broken = { kind: 'error', code: 'CLIENT', message: 'Failed to fetch', retryable: false };

// 배포판: 실패를 반드시 알리고, 기술 문구는 붙이지 않는다
const deployedDown = motionNoteFor(down, false);
assert.ok(deployedDown && deployedDown.includes('1학기 수어 영상'), deployedDown);
assert.ok(deployedDown.includes('잠시 뒤 다시'), deployedDown);
assert.ok(!deployedDown.includes(down.message), '배포판에는 서버 오류 문구를 그대로 보이지 않는다');
ok('배포판 · 서버 꺼짐(다시 시도 가능): 영상으로 바꾼 까닭 + 다시 해 보기');

const deployedBroken = motionNoteFor(broken, false);
assert.ok(deployedBroken && deployedBroken.includes('1학기 수어 영상'), deployedBroken);
assert.ok(!deployedBroken.includes('잠시 뒤'), deployedBroken);
ok('배포판 · 다시 시도해도 안 될 오류: 까닭만 알린다');

// 개발 · 시험 환경: 자세한 오류 문구를 붙인다 (예전 동작 유지)
assert.equal(motionNoteFor(down, true), `AI 손짓을 받지 못해 영상으로 보여 줘요 · ${down.message}`);
ok('주소를 정한 환경: 자세한 오류 문구');

// 성공 · 빈 응답 · 꺼 둠은 예전과 같다
const motion = { kind: 'motion', unknown: [], motion: {} };
assert.equal(motionNoteFor(motion, false), 'AI가 그린 손짓이에요');
assert.equal(motionNoteFor({ ...motion, unknown: ['집'] }, false), 'AI가 그린 손짓이에요 · 못 그린 낱말: 집');
assert.equal(motionNoteFor({ kind: 'empty', unknown: ['ㅋㅋㅋ'] }, false), 'AI가 그릴 수 있는 낱말이 없어서 영상으로 보여 줘요 (ㅋㅋㅋ)');
assert.equal(motionNoteFor({ kind: 'off' }, false), null);
ok('AI 손짓 · 못 그린 낱말 · 빈 응답 · 꺼 둠은 예전 문구 그대로');

console.log(`${n}개 항목 통과. 문구 함수만 검사하며 화면 배치는 브라우저에서 따로 본다.`);
