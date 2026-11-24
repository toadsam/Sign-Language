// 평가 영상 일괄 녹화의 목록 만들기(batch-jobs.ts)와 ZIP 만들기(zip-store.ts) 검사.
// 합성 좌표만 쓴다 (카메라 · 네트워크 · AI Hub 파일 없음). ZIP은 Python zipfile로 열어 확인한다.
// 실행: node tools/check-batch-record.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const exports = {};
  cache[name] = exports;
  const src = fs.readFileSync(path.join(__dirname, '../components/sign-player', name + '.ts'), 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(out, {
    exports,
    require: (p) => load(p.replace('./', '')),
    atob,
    btoa,
    Uint8Array,
    Uint32Array,
    DataView,
    Float32Array,
    TextEncoder,
    Number,
    Math,
    Array,
    Error,
    JSON,
    Set,
    String,
  });
  return exports;
}
const J = load('batch-jobs'),
  Z = load('zip-store');
const passed = [];

const motionJson = (frames, extra = {}) => {
  const buf = new Float32Array(frames * 125 * 3).map((_, i) => (i % 7) * 0.01);
  return JSON.stringify({
    fps: 30,
    joints: 125,
    frames,
    units: 'shoulder',
    data: Buffer.from(buf.buffer).toString('base64'),
    tokens: [],
    segments: [],
    unknown: [],
    source: 'model',
    ...extra,
  });
};

// 1. 경로 읽기
assert.deepEqual({ ...J.parseJobPath('out/B1/sentence-03.json') }, { condition: 'B1', sentence: 3 });
assert.deepEqual({ ...J.parseJobPath('Ours-H/sentence-20.json') }, { condition: 'Ours-H', sentence: 20 });
assert.deepEqual({ ...J.parseJobPath('a\\b\\Ours-HF\\sentence-01.JSON') }, { condition: 'Ours-HF', sentence: 1 });
for (const bad of [
  'sentence-01.json',
  'out/private/clip-map.json',
  'out/README.txt',
  'out/B3/sentence-01.json',
  'out/B1/sentence-1.json',
  'out/B1/sentence-00.json',
])
  assert.equal(J.parseJobPath(bad), null, bad);
passed.push('job path parsing');

// 2. 정상 목록: 정렬 · 건너뛰기 · 출력 이름
let plan = J.planJobs([
  { path: 'out/Ours-H/sentence-02.json', text: motionJson(5) },
  { path: 'out/B1/sentence-02.json', text: motionJson(4) },
  { path: 'out/Ours-H/sentence-01.json', text: motionJson(3) },
  { path: 'out/B1/sentence-01.json', text: motionJson(6) },
  { path: 'out/private/clip-map.json', text: '{}' },
  { path: 'out/README.txt', text: 'x' },
]);
assert.deepEqual(plan.problems.length, 0, plan.problems.join(' / '));
assert.deepEqual(
  Array.from(plan.jobs).map((j) => `${j.condition}/${j.sentence}/${j.motion.response.frames}`),
  ['B1/1/6', 'Ours-H/1/3', 'B1/2/4', 'Ours-H/2/5'],
);
assert.deepEqual(Array.from(plan.skipped), ['out/private/clip-map.json', 'out/README.txt']);
assert.equal(J.outputName(plan.jobs[1], 'webm'), 'Ours-H/sentence-01.webm');
passed.push('valid folder: sorted by sentence then condition, extras skipped, output names');

// 3. 고칠 것: 중복 · 깨진 JSON · 빈 동작 · 짝 없음
plan = J.planJobs([
  { path: 'a/B1/sentence-01.json', text: motionJson(3) },
  { path: 'b/B1/sentence-01.json', text: motionJson(3) },
  { path: 'a/Ours-H/sentence-01.json', text: '{not json' },
  {
    path: 'a/B1/sentence-02.json',
    text: JSON.stringify({
      fps: 30,
      joints: 125,
      frames: 0,
      units: 'shoulder',
      data: '',
      tokens: [],
      segments: [],
      unknown: ['x'],
      source: 'baseline',
    }),
  },
  { path: 'a/Ours-H/sentence-03.json', text: motionJson(2) },
]);
const msg = plan.problems.join(' / ');
assert.match(msg, /B1 문장 01이 두 번/);
assert.match(msg, /a\/Ours-H\/sentence-01\.json:/);
assert.match(msg, /재생할 프레임이 없습니다/);
assert.match(msg, /B1: 문장 03이 없습니다/);
assert.match(msg, /Ours-H: 문장 01이 없습니다/);
passed.push('problems: duplicate, broken JSON, empty motion, missing pair');

// 4. CRC · ZIP (Python zipfile로 확인)
assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
const entries = [
  { name: 'B1/sentence-01.webm', data: new Uint8Array([1, 2, 3, 250]) },
  { name: 'Ours-H/sentence-01.webm', data: new Uint8Array(5000).map((_, i) => i % 256) },
  { name: 'README.txt', data: new TextEncoder().encode('출처: 한국지능정보사회진흥원 AI Hub') },
];
const zip = Z.makeZip(entries);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-zip-'));
const file = path.join(dir, 'out.zip');
fs.writeFileSync(file, zip);
const py = execFileSync(
  'python3',
  [
    '-I',
    '-c',
    [
      'import zipfile,sys,json,hashlib',
      'z=zipfile.ZipFile(sys.argv[1])',
      'assert z.testzip() is None',
      'print(json.dumps({i.filename:[i.file_size,i.compress_type,hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()},ensure_ascii=False))',
    ].join('\n'),
    file,
  ],
  { encoding: 'utf8' },
);
const info = JSON.parse(py);
const sha = (u8) => require('node:crypto').createHash('sha256').update(u8).digest('hex');
for (const e of entries) assert.deepEqual(info[e.name], [e.data.length, 0, sha(e.data)], e.name);
assert.equal(Z.makeZip(entries).length, zip.length, '같은 입력이면 같은 크기');
assert.throws(
  () =>
    Z.makeZip([
      { name: 'a', data: new Uint8Array(1) },
      { name: 'a', data: new Uint8Array(1) },
    ]),
  /겹칩니다/,
);
for (const bad of ['/abs', '../up', 'x/../y', ''])
  assert.throws(() => Z.makeZip([{ name: bad, data: new Uint8Array(1) }]), /올바르지 않습니다/);
fs.rmSync(dir, { recursive: true, force: true });
passed.push(
  'zip: crc32 known value, python zipfile reads names/sizes/stored/content, rejects duplicate and unsafe names',
);

console.log(JSON.stringify({ synthetic: true, passed }, null, 2));
