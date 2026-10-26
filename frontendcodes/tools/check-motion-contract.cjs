// Offline checks with synthetic coordinates only; no AI Hub files or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '../components/sign-player/motion.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(compiled, { exports: exportsObject, ArrayBuffer, Uint8Array, Float32Array, DataView, atob });
const { decodeMotion, currentMotionToken } = exportsObject;
const frames = 9;
const bytes = Buffer.alloc(frames * 125 * 3 * 4);
// Distinct signed XYZ values at the neck, both wrists, and last face joint.
for (const [frame, joint, xyz] of [[0, 1, [0, 0, 0]], [4, 13, [-1.25, .5, -.75]], [8, 34, [1.5, -.25, .125]], [8, 124, [.25, -.5, .75]]]) {
  xyz.forEach((n, axis) => bytes.writeFloatLE(n, ((frame * 125 + joint) * 3 + axis) * 4));
}
const response = { fps: 30, joints: 125, frames, units: 'shoulder', data: bytes.toString('base64'), tokens: [0, 278, 465], segments: [], unknown: [], source: 'model' };
const decoded = decodeMotion(response);
assert.equal(decoded.positions.length, frames * 375);
assert.deepEqual(Array.from(decoded.positions.slice((4 * 125 + 13) * 3, (4 * 125 + 13) * 3 + 3)), [-1.25, .5, -.75]);
assert.deepEqual(Array.from(decoded.positions.slice((8 * 125 + 34) * 3, (8 * 125 + 34) * 3 + 3)), [1.5, -.25, .125]);
assert.deepEqual(Array.from(decoded.positions.slice(-3)), [.25, -.5, .75]);
for (const [frame, expected] of [[0, 0], [3, 0], [4, 278], [7, 278], [8, 465]]) {
  assert.equal(currentMotionToken(response, frame), expected);
}
for (const frame of [-1, .5, 9, NaN]) assert.equal(currentMotionToken(response, frame), undefined);
assert.equal(currentMotionToken({ ...response, tokens: [] }, 0), undefined);
assert.equal(currentMotionToken({ ...response, tokens: [0] }, 4), undefined);
assert.throws(() => decodeMotion({ ...response, data: bytes.subarray(4).toString('base64') }), /좌표 길이/);
const invalid = Buffer.from(bytes);
invalid.writeFloatLE(NaN, 0);
assert.throws(() => decodeMotion({ ...response, data: invalid.toString('base64') }), /유효하지 않은 값/);
console.log(JSON.stringify({ passed: ['float32 little-endian XYZ, frame and joint order', 'four-frame token boundaries including token zero and partial last group', 'missing tokens and out-of-range frames', 'truncated data and NaN rejection'], networkAccessed: false, realTeamDataTested: false }, null, 2));
