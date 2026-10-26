// Parse locally; never execute imported HTML or print its coordinates.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const cache = {};
function load(name) {
  if (!['motion', 'ai-viewer'].includes(name)) throw new Error('Unexpected module');
  if (cache[name]) return cache[name];
  const exports = {}; cache[name] = exports;
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/sign-player', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: p => load(p.replace('./', '')), ArrayBuffer, Uint8Array, Float32Array, DataView, atob, btoa });
  return exports;
}
const { readAiViewer, decodeAiViewerPair } = load('ai-viewer');
const fixture = { fps: 30, down: 4, parts: { body: [0,13], lhand: [13,34], rhand: [34,55], face: [55,125] },
  labels: ['원본', '복원 (얼굴은 평균 고정)'],
  clips: [{ name: '합성', frames: 4, tokens: [0], orig: Array(1500).fill(0), recon: Array(1500).fill(.25) }] };
const html = value => '<script>const DATA = ' + JSON.stringify(value) + '; throw new Error("must not run");</script>';
const viewer = readAiViewer(html(fixture));
assert.deepEqual(Array.from(viewer.labels), fixture.labels);
const jsonViewer = readAiViewer('\uFEFF \n'+JSON.stringify(fixture));
assert.deepEqual(Array.from(jsonViewer.labels), fixture.labels);
assert.equal(decodeAiViewerPair(jsonViewer,0,true)[1].positions[0],.25);
assert.throws(()=>readAiViewer('{"fps":'),/JSON/);
assert.throws(()=>readAiViewer(JSON.stringify({...fixture,parts:{}})),/관절/);
assert.throws(()=>readAiViewer(JSON.stringify({...fixture,labels:['one']})),/제목/);
const pair = decodeAiViewerPair(viewer, 0, true);
assert.equal(pair[0].response.frames, 4);
assert.equal(pair[0].positions[0], 0);
assert.equal(pair[1].positions[0], .25);
assert.equal(pair[0].response.tokens.length, 0);
assert.equal(pair[1].response.tokens[0], 0);
assert.equal(pair[0].response.demo, true);
assert.equal(pair[1].response.source, 'model');
assert.equal(decodeAiViewerPair(viewer, 0, false)[0].response.demo, false);
const legacy = { ...fixture }; delete legacy.labels;
assert.deepEqual(Array.from(readAiViewer(html(legacy)).labels), ['원본', '복원']);
for (const labels of [null, [], ['one'], ['a','b','c'], [1,'b'], ['a','b'.repeat(501)]]) {
  assert.throws(() => readAiViewer(html({ ...fixture, labels })), /제목/);
}
assert.throws(() => readAiViewer(html({ ...fixture, parts: { ...fixture.parts, lhand: [13,35] } })), /관절/);
assert.throws(() => readAiViewer(html({ ...fixture, fps: 0 })), /FPS/);
assert.throws(() => readAiViewer('const DATA = (() => ({}))();'));
assert.throws(() => readAiViewer('const DATA = ' + JSON.stringify(fixture)));
assert.throws(() => decodeAiViewerPair(viewer, -1), /범위/);
assert.throws(() => decodeAiViewerPair(viewer, 1), /범위/);
const truncated = readAiViewer(html(fixture)); truncated.clips[0].recon.pop();
assert.throws(() => decodeAiViewerPair(truncated, 0, true), /좌표/);
const invalid = readAiViewer(html(fixture)); invalid.clips[0].orig[0] = Infinity;
assert.throws(() => decodeAiViewerPair(invalid, 0, true), /좌표/);
let actualFile = null;
if (process.argv[2]) {
  const actual = readAiViewer(fs.readFileSync(process.argv[2], 'utf8'));
  for (let i = 0; i < actual.clips.length; i++) {
    const [orig, recon] = decodeAiViewerPair(actual, i, false);
    assert.equal(orig.positions.length, recon.positions.length);
    assert.equal(orig.response.frames, recon.response.frames);
    assert.equal(orig.response.fps, recon.response.fps);
  }
  actualFile = { clips: actual.clips.length, fps: actual.fps, allPairsDecoded: true };
}
console.log(JSON.stringify({ passed: ['direct comparison JSON and BOM input; invalid JSON and metadata rejected', 'comparison labels preserved and legacy defaults', 'signed float32 pair decoding and token zero', 'invalid labels, parts, FPS and clip index rejected', 'truncated and non-finite coordinates rejected', 'JSON-only extraction without HTML execution'], actualFile, browserTested: false, modelAccuracyTested: false }, null, 2));
