// 따라 하기 점수 기준선 계산 (승혁).
// 따라 하기 화면의 "기준선 맞추기 기록 (개발용)"에서 [복사]한 줄을 텍스트 파일로 저장해 넣으면,
// 실제 시도의 거리로 body-score.ts 의 POSITION_RANGE · SHAPE_RANGE 를 제안한다.
// 파일을 고치지 않는다. 바꿀 줄만 출력한다. 영상 · 좌표는 쓰지 않고 거리 숫자만 읽는다.
//
// 기록 받기: 개발 서버(npx expo start --web)에서 /sign-follow?calib=1 을 열고,
//   "이번에는"을 고른 뒤 카메라로 따라 하면 한 줄씩 쌓인다. [복사] → 텍스트 파일에 붙여 넣기.
// 실행: node tools/follow-baseline.cjs 기록.txt
//
// 제안 규칙: 100점 기준 = "잘 따라 함" 거리의 중앙값, 0점 기준 = "다른 동작" 거리의 중앙값.
// 두 종류가 각각 MIN_PER_KIND 개 이상일 때만 제안한다.
const fs = require('node:fs');
const path = require('node:path');

const GOOD = '잘 따라 함', ROUGH = '대충 따라 함', OTHER = '다른 동작';
const KINDS = [GOOD, ROUGH, OTHER];
const MIN_PER_KIND = 5;
/** 화면의 판정 경계 (body-score.ts verdict): 65점 이상이면 "거의 맞아요" */
const PASS = 65;

/** FollowAlong.web.tsx 의 attemptLine 한 줄을 읽는다 */
function parseLine(line, lineNo) {
  const cells = line.split('\t').map((c) => c.trim());
  const fail = (why) => { throw new Error(`${lineNo}번째 줄을 읽지 못했습니다 (${why}): ${line}`); };
  if (cells.length < 5) fail('칸이 5개보다 적음');
  const [, kind, scoreCell, posCell, shapeCell, ...rest] = cells;
  if (!KINDS.includes(kind)) fail(`알 수 없는 종류 "${kind}"`);
  const num = (cell, label) => {
    const m = cell.match(new RegExp(`^${label} (-?\\d+(?:\\.\\d+)?)$`));
    if (!m) fail(`"${label}" 칸`);
    const v = Number(m[1]);
    if (!Number.isFinite(v) || v < 0) fail(`"${label}" 값`);
    return v;
  };
  const score = num(scoreCell, '점수');
  const position = num(posCell, '자리');
  const shape = shapeCell === '모양 없음' ? null : num(shapeCell, '모양');
  return { kind, score, position, shape, mirrored: rest.includes('반대 손') };
}

function parseRecords(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => { if (line.trim()) out.push(parseLine(line, i + 1)); });
  return out;
}

function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return s[lo] + (s[hi] - s[lo]) * (at - lo);
}
const stats = (values) => values.length
  ? { n: values.length, min: Math.min(...values), p25: quantile(values, 0.25), median: quantile(values, 0.5), p75: quantile(values, 0.75), max: Math.max(...values) }
  : { n: 0 };

/** body-score.ts 와 같은 식 */
const toScore = (d, [best, worst]) => Math.round(100 * Math.min(1, Math.max(0, 1 - (d - best) / (worst - best))));
const combine = (r, pos, shape) => r.shape === null ? toScore(r.position, pos) : Math.round(0.6 * toScore(r.position, pos) + 0.4 * toScore(r.shape, shape));

function readCurrentRanges(file) {
  const src = fs.readFileSync(file, 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`const ${name}: \\[number, number\\] = \\[([\\d.]+), ([\\d.]+)\\];`));
    if (!m) throw new Error(`${path.basename(file)} 에서 ${name} 를 찾지 못했습니다.`);
    return [Number(m[1]), Number(m[2])];
  };
  return { position: grab('POSITION_RANGE'), shape: grab('SHAPE_RANGE') };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/** 기록 → 제안. suggestion 이 null 이면 reasons 에 까닭이 있다 */
function suggest(records) {
  const by = Object.fromEntries(KINDS.map((k) => [k, records.filter((r) => r.kind === k)]));
  const reasons = [];
  for (const k of [GOOD, OTHER]) if (by[k].length < MIN_PER_KIND) reasons.push(`"${k}" 기록이 ${by[k].length}개입니다. ${MIN_PER_KIND}개 이상 필요합니다.`);
  const pick = (k, key) => by[k].map((r) => r[key]).filter((v) => v !== null);
  const range = (key) => {
    const best = quantile(pick(GOOD, key), 0.5), worst = quantile(pick(OTHER, key), 0.5);
    if (best === null || worst === null) { reasons.push(`${key === 'position' ? '자리' : '모양'} 거리가 있는 기록이 한쪽에 없습니다.`); return null; }
    if (!(worst > best)) { reasons.push(`${key === 'position' ? '자리' : '모양'} 거리: "다른 동작"(${round3(worst)})이 "잘 따라 함"(${round3(best)})보다 크지 않아 구분되지 않습니다.`); return null; }
    return [round3(best), round3(worst)];
  };
  const position = range('position'), shape = range('shape');
  return { by, suggestion: reasons.length ? null : { position, shape }, reasons };
}

/** 범위로 매긴 점수: 종류별 중앙값과 잘못 통과 · 잘못 떨어짐 비율 */
function evaluate(by, ranges) {
  const scores = Object.fromEntries(KINDS.map((k) => [k, by[k].map((r) => combine(r, ranges.position, ranges.shape))]));
  const rate = (list, test) => (list.length ? list.filter(test).length / list.length : null);
  return {
    median: Object.fromEntries(KINDS.map((k) => [k, quantile(scores[k], 0.5)])),
    falsePass: rate(scores[OTHER], (s) => s >= PASS),
    falseFail: rate(scores[GOOD], (s) => s < PASS),
  };
}

function report(records, current) {
  const { by, suggestion, reasons } = suggest(records);
  const lines = [];
  const fmt = (v) => (v === null || v === undefined ? '-' : v.toFixed(3));
  const pct = (v) => (v === null ? '-' : `${Math.round(v * 100)}%`);
  lines.push(`기록 ${records.length}개 · ${KINDS.map((k) => `${k} ${by[k].length}`).join(' · ')} · 반대 손 ${records.filter((r) => r.mirrored).length}`);
  for (const [key, label] of [['position', '자리 거리'], ['shape', '모양 거리']]) {
    lines.push('', `[${label}] 종류  개수  최소  25%  중앙  75%  최대`);
    for (const k of KINDS) {
      const s = stats(by[k].map((r) => r[key]).filter((v) => v !== null));
      lines.push(`  ${k}  ${s.n}  ${fmt(s.min)}  ${fmt(s.p25)}  ${fmt(s.median)}  ${fmt(s.p75)}  ${fmt(s.max)}`);
    }
  }
  const show = (name, ranges) => {
    const e = evaluate(by, ranges);
    lines.push(`  ${name}: 자리 [${ranges.position.join(', ')}] · 모양 [${ranges.shape.join(', ')}]`);
    lines.push(`    점수 중앙값 ${KINDS.map((k) => `${k} ${e.median[k] ?? '-'}`).join(' · ')}`);
    lines.push(`    "다른 동작"이 ${PASS}점 이상(잘못 통과) ${pct(e.falsePass)} · "잘 따라 함"이 ${PASS}점 미만(잘못 떨어짐) ${pct(e.falseFail)}`);
  };
  lines.push('', '[점수로 보면]');
  show('지금 값', current);
  if (suggestion) {
    show('제안 값', suggestion);
    lines.push('', 'body-score.ts 에 바꿔 넣을 줄 (직접 확인 후 반영):',
      `const POSITION_RANGE: [number, number] = [${suggestion.position.join(', ')}];`,
      `const SHAPE_RANGE: [number, number] = [${suggestion.shape.join(', ')}];`);
  } else {
    lines.push('', '제안하지 않음:', ...reasons.map((r) => `  - ${r}`));
  }
  lines.push('', '주의: 몇 사람 · 몇 단어의 기록인지에 따라 값이 달라진다. 수어 뜻이 맞는지 판정한 값이 아니다.');
  return lines.join('\n');
}

module.exports = { parseLine, parseRecords, quantile, suggest, evaluate, report, readCurrentRanges, toScore, combine, MIN_PER_KIND };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('사용법: node tools/follow-baseline.cjs 기록.txt');
    process.exit(2);
  }
  try {
    const records = parseRecords(fs.readFileSync(file, 'utf8'));
    if (!records.length) throw new Error('기록 줄이 없습니다.');
    const current = readCurrentRanges(path.join(__dirname, '../components/sign-camera/body-score.ts'));
    console.log(report(records, current));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
