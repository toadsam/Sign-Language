/* 여러 그림이 같이 쓰는 사실. 숫자는 모두 저장소 기록에서 가져왔다 (출처는 각 줄 끝). */
(function () {
  'use strict';
  const D = {};

  D.people = {
    jaehun: { key: 'jaehun', name: '정재훈', role: '자모표 · 데이터 정리', folders: ['ml/prep', 'ml/vq', 'ml/common'] },
    jiheon: { key: 'jiheon', name: '박지헌', role: '받아쓰기 · 추론 서버', folders: ['ml/gen', 'ml/serve', 'backend'] },
    seunghyun: { key: 'seunghyun', name: '류승현', role: '읽는 모델 · 비교 실험', folders: ['ml/recog', 'ml/eval'] },
    seunghyeok: { key: 'seunghyeok', name: '유승혁', role: '화면 · 3D · 손 인식', folders: ['viewer', 'frontendcodes'] },
  };

  /* 계약 다섯 개 — docs/contracts.md */
  D.contracts = [
    { n: '①', name: '동작 데이터 + 분할표', from: 'jaehun', to: ['jiheon', 'seunghyun', 'seunghyeok'], what: 'npy [T,125,3] + meta.jsonl + splits/*.json', where: 'ml/common/data.py · ml/splits/', state: '코드 있음' },
    { n: '②', name: '토큰 + 디코더', from: 'jaehun', to: ['jiheon'], what: 'tokens.json + vq.decode()', where: 'ml/gen/tokenize.py · ml/vq/model.py', state: '코드 있음' },
    { n: '③', name: '생성 함수', from: 'jiheon', to: ['seunghyun'], what: 'Generator.generate(gloss) → 동작', where: 'ml/gen/infer.py', state: '단어 모델 연결됨' },
    { n: '④', name: '채점 함수', from: 'seunghyun', to: ['jaehun', 'jiheon'], what: 'Recognizer.score(동작) → top5', where: 'ml/recog/infer.py', state: '3000단어 모델' },
    { n: '⑤', name: 'API 응답 JSON', from: 'jiheon', to: ['seunghyeok'], what: 'POST /generate → 좌표 base64', where: 'ml/serve/ · backend/', state: '앱에서 재생 확인' },
  ];

  /* 자모표 실험 — ml/experiments.md:9-13 (test 수행자 REAL03 · REAL12, mm) */
  D.vqRuns = [
    { id: 'E1', set: '상체+손 55점 · 512개 · 10만 회 · 단어', body: 22.9, hand: 28.1, finger: 21.3, use: 97, min: 54.7 },
    { id: 'E2', set: '얼굴 포함 125점 · 512개 · 10만 회', body: 21.9, hand: 31.7, finger: 22.0, use: 98, min: 56.0 },
    { id: 'E4a', set: '토큰 1024개 · 10만 회', body: 23.4, hand: 29.9, finger: 21.8, use: 99, min: 56.9 },
    { id: 'E4b', set: '512개 · 20만 회 · 단어', body: 23.0, hand: 27.0, finger: 20.6, use: 100, min: 105.2 },
    { id: 'E5', set: '단어+문장 · 512개 · 20만 회', body: 24.5, hand: 28.2, finger: 20.6, use: 100, min: 98.7, pick: true },
  ];
  /* 문장에서 손 오차 — docs/ai-log/jaehun.md:396-397 */
  D.vqSen = { e4b: { word: 27.1, sen: 37.3 }, e5: { word: 28.4, sen: 28.1 } };

  /* 읽는 모델 — docs/ai-log/seunghyun.md */
  D.recogRuns = [
    { cls: 100, clips: '1,200 / 197 / 200', top1: 100, top5: 100 },
    { cls: 500, clips: '6,000 / 908 / 979', top1: 100, top5: 100 },
    { cls: 3000, clips: '34,498 / 5,453 / 5,907', top1: 97.33, top5: 99.53 },
  ];
  /* 역번역 (3000단어 읽는 모델, test 5,907클립) — seunghyun.md:280, ml/recog/README.md */
  D.backtrans = [
    { name: '실제 동작', top1: 97.33, top5: 99.53, n1: 5749, note: '읽는 모델 자체의 정확도' },
    { name: 'E5로 복원한 동작', top1: 77.98, top5: 90.94, n1: 4606, note: '자모표를 거치면 잃는 만큼' },
    { name: '손 가중 후보 (lam2)', top1: 79.09, top5: 92.97, note: '평가만, 배포 전', cand: true },
    { name: '뼈 방향 후보 (0.1)', top1: 80.02, top5: 93.25, note: '토큰 경로 기준, 평가만', cand: true },
  ];

  /* 받아쓰기 — docs/ai-log/jiheon.md:70, 79 */
  D.genRank = [
    { name: '처음 모델 A', top1: 45.0, top5: 73.5 },
    { name: '조건 강화 C (guidance 1)', top1: 62.8, top5: 87.2 },
    { name: '조건 강화 C (guidance 2)', top1: 74.2, top5: 91.7, pick: true },
    { name: '사람이 한 실제 동작', top1: 71.7, top5: 87.2, human: true },
  ];
  D.genDist = [
    { name: '꺼내 주기 (실제 토큰 재생)', all: 0.183, hand: 0.078 },
    { name: '사람끼리 (상한)', all: 0.201, hand: 0.082, human: true },
    { name: '생성 · 후보 5개 중 대표', all: 0.205, hand: 0.090, pick: true },
    { name: '생성 · 후보 1개', all: 0.220, hand: 0.095 },
  ];

  /* 데이터 — docs/handoff/jaehun-to-jiheon-e5.md, ml/prep/quality_policy.md */
  D.split = {
    train: ['REAL01', 'REAL02', 'REAL05', 'REAL06', 'REAL07', 'REAL08', 'REAL09', 'REAL10', 'REAL13', 'REAL14', 'REAL15', 'REAL16'],
    val: ['REAL04', 'REAL11'], test: ['REAL03', 'REAL12'],
    word: { total: 48000, train: 34574, val: 5664, test: 5907, out: 1855, why: '10fps로 뽑힌 클립 985 + 동작 보류 883 − 겹침 13' },
    sen: { total: 32000, train: 23884, val: 3986, test: 3977, out: 153, why: '순간 튐 등 153' },
    all: { total: 80000, train: 58458, val: 9650, test: 9884, out: 2008, why: '단어 1,855 + 문장 153' },
  };

  window.SJD = D;
})();
