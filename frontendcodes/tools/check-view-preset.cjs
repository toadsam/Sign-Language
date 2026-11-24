// 시점 고르기 칸 값(components/sign-player/view-preset.ts) 검사. 실행: node tools/check-view-preset.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'components', 'sign-player', 'view-preset.ts');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { module: mod, exports: mod.exports, Math }, { filename: file });
const { viewPreset } = mod.exports;

assert.equal(viewPreset(0, 0), 'front');
assert.equal(viewPreset(Math.PI / 2, 0), 'side');
assert.equal(viewPreset(0, -Math.PI / 2), 'top');
// 끌어서 조금이라도 돌렸으면 자유 시점 (예전 재생 화면은 위아래로 0.1만 넘어도 "위"였다)
assert.equal(viewPreset(0, -0.3), 'custom');
assert.equal(viewPreset(0, 0.3), 'custom');
assert.equal(viewPreset(0.2, -Math.PI / 2), 'custom');
assert.equal(viewPreset(Math.PI / 2, -0.01), 'custom');
// 계산 오차 정도는 같은 시점으로 본다
assert.equal(viewPreset(Math.PI / 2 + 1e-9, 0), 'side');
console.log('PASS 정면 · 측면 · 위 · 자유 시점 판정 8항목');
