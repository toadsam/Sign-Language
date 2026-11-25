/* 빨간 방 6 · 7: 추론 서버와 생성 API (요청 한 번의 순서도) / 앱의 AI 화면과 뷰어 */
(function () {
  'use strict';
  const SJ = window.SJ, s = SJ.s, h = SJ.h, text = SJ.text, D = window.SJD, P = D.people;

  /* ───────────── 추론 서버 · 생성 API ───────────── */
  const LANES = [
    { t: '앱', sub: 'AI 작업실 화면', x: 100, k: 'core' },
    { t: 'Spring 생성', sub: 'generation 패키지', x: 370, k: 'core' },
    { t: '어순 변환 · 단어표', sub: 'GlossTranslator', x: 640, k: 'old' },
    { t: '추론 서버', sub: 'FastAPI :8000', x: 910, k: 'core' },
    { t: '모델', sub: '단어 GPT + 자모표 E5', x: 1180, k: 'core' },
  ];
  // [from, to, 글, 작은 글, 종류]  종류: q 요청 · r 응답 · s 혼자 하는 일 · e 오류
  const BASE = (gloss, unk, frames) => [
    [0, 1, 'POST /api/sign/generate', '{ "text": 문장 }  딱 이 한 칸만 받는다', 'q'],
    [1, 2, 'translate(문장)', '규칙 · ETRI · OpenAI 세 갈래로 단어 열을 만든다', 'q'],
    [2, 1, '단어 열 ' + gloss, '단어표(3,000)에 가장 많이 맞는 갈래 + 뜻 같은 단어로 바꾸기', 'r'],
    [1, 3, 'POST /generate', '{ gloss, nonmanual }  연결 1초 · 전체 10초 안에', 'q'],
    [3, 4, 'generate(gloss)', '자물쇠를 잡는다. 한 번에 한 요청만', 'q'],
    [4, 4, '단어마다 후보 24개 → 대표 1개 → 디코드', unk ? '아는 단어만 만든다' : '화자 12명 × 2개, 가장 가운데 것', 's'],
    [4, 3, 'motion ' + frames + ' · tokens · unknown ' + (unk || '[]'), '', 'r'],
    [3, 1, '200  { fps 30, joints 125, frames, data, … }', '좌표를 float32 → base64 글자로 싼다', 'r'],
    [1, 1, '검사: 바이트 수 = frames × 125 × 3 × 4', '숫자가 모두 유한한가, 형식이 계약 ⑤와 같은가', 's'],
  ];
  const SC = [
    { id: 'ok', label: '정상', steps: BASE('[화장실, 있다] + 의문', null, '[T,125,3]').concat([[1, 0, '200 좌표 응답', '앱이 base64를 풀어 30fps로 재생', 'r']]), end: '화면에 3D 뼈대가 재생된다.' },
    { id: 'part', label: '일부 모르는 단어', steps: BASE('[병원, ○○]', '["○○"]', '[T,125,3]').concat([[1, 0, '200 좌표 + unknown ["○○"]', '아는 단어는 재생하고, 빠진 단어를 화면에 알려 준다', 'r']]), end: '오류가 아니다. 그릴 수 있는 만큼 그리고 빠진 단어를 알려 준다.' },
    { id: 'none', label: '전부 모르는 단어', steps: BASE('[○○]', '["○○"]', '[0,125,3]').concat([[1, 0, '200  frames 0 · data ""', '재생 대신 "그릴 수 있는 동작이 없어요" 안내', 'r']]), end: '빈 동작도 정상 응답이다. 11월 4일 실제로 확인한 경우.' },
    { id: 'busy', label: '서버가 바쁠 때', steps: BASE('[화장실, 있다]', null, '').slice(0, 4).concat([[3, 3, '자물쇠가 이미 잡혀 있다', '줄 세우지 않고 바로 거절한다', 'e'], [3, 1, '503  Retry-After: 1', '', 'e'], [1, 0, '503 GENERATION_UNAVAILABLE', 'retryable: true → 다시 시도 버튼', 'e']]), end: '서버가 몰래 다시 시도하지 않는다. 사용자가 누르면 새 요청으로 보낸다.' },
    { id: 'slow', label: '시간 초과', steps: BASE('[화장실, 있다]', null, '').slice(0, 5).concat([[4, 4, '모델이 10초 넘게 걸린다', '', 'e'], [1, 1, '전체 10초 제한에 걸림', '기다리던 요청을 끊는다', 'e'], [1, 0, '504 GENERATION_TIMEOUT', 'retryable: true', 'e']]), end: '입력한 문장은 그대로 두고, 오류 안내와 다시 시도만 보여 준다.' },
    { id: 'down', label: '추론 서버가 꺼졌을 때', steps: BASE('[화장실, 있다]', null, '').slice(0, 3).concat([[1, 3, 'POST /generate', '1초 안에 연결이 안 된다', 'e'], [1, 0, '503 GENERATION_UNAVAILABLE', '영상으로 몰래 바꾸지 않는다', 'e']]), end: '실패를 성공처럼 꾸미지 않는다는 것이 이 API의 원칙이다.' },
  ];

  SJ.room('serve', {
    short: '서버', title: '요청 한 번이 지나가는 길', kicker: 'backend/generation · ml/serve',
    lead: '앱이 문장을 보내면 Spring이 단어 열로 바꾸고, 추론 서버가 좌표를 만들고, Spring이 검사해서 돌려준다. 상황을 골라 한 걸음씩 재생해 보자.',
    owners: [P.jiheon],
    build(body, scope) {
      const W = 1280, ROW = 50, Y0 = 122;
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '상황 고르기' });
      const play = h('button', { class: 'btn red', type: 'button', text: '▶ 재생' }), next = h('button', { class: 'btn', type: 'button', text: '한 걸음 ›' });
      const endP = h('p', { class: 'hand', 'aria-live': 'polite', style: { margin: '2px 0 6px', minHeight: '1.3em' } });
      const b1 = h('div', { class: 'block' }, [h('div', { class: 'ctrl' }, [seg, play, next]), endP]);
      body.appendChild(b1);
      const F = SJ.fig(W, 680, { minw: 1000, file: 'suji-generate-sequence', label: '생성 요청의 순서도. 앱, Spring, 어순 변환, 추론 서버, 모델 사이를 오가는 메시지', caption: '빨간 화살표는 요청, 먹색 점선은 응답, 굵은 붉은 글씨는 오류다. 시간 제한과 오류 이름은 backend/generation 코드와 ml/serve/README.md 그대로다.' });
      b1.appendChild(F.figure); const svg = F.svg;
      LANES.forEach((l, i) => {
        svg.appendChild(s('path', { class: 'ink thin soft dash', d: 'M' + l.x + ' 84 V660' }));
        svg.appendChild(SJ.node({ x: l.x - 96, y: 22, w: 192, h: 60, title: l.t, sub: [l.sub], kind: l.k, static: true, size: 16, delay: i * 0.06 }));
      });
      const layer = s('g'); svg.appendChild(layer);
      let cur = SC[0], shown = 99, playing = false, timer = 0, groups = [];
      function build() {
        layer.textContent = ''; groups = [];
        cur.steps.forEach((st, i) => {
          const y = Y0 + i * ROW, a = LANES[st[0]].x, b = LANES[st[1]].x, err = st[4] === 'e', g = s('g');
          if (st[0] === st[1]) {
            const L = st[0] === LANES.length - 1 ? -1 : 1;
            g.appendChild(s('path', { class: 'ink' + (err ? '' : ' thin'), d: 'M' + a + ' ' + (y - 12) + ' h' + (34 * L) + ' v24 h' + (-28 * L), style: err ? { stroke: 'var(--core)' } : null }));
            g.appendChild(text(a + 44 * L, y - 2, st[2], { size: 13.5, anchor: L > 0 ? 'start' : 'end', cls: (err ? 't-core ' : '') + 'val-label', weight: err ? 700 : null }));
            if (st[3]) g.appendChild(text(a + 44 * L, y + 15, st[3], { size: 11.5, anchor: L > 0 ? 'start' : 'end', cls: 't-soft val-label' }));
          } else {
            const dir = b > a ? 1 : -1;
            g.appendChild(SJ.arrow({ from: [a + dir * 4, y], to: [b - dir * 5, y], core: st[4] === 'q' || err, dash: st[4] === 'r' }));
            g.appendChild(text((a + b) / 2, y - 8, st[2], { size: 13.5, cls: (err ? 't-core ' : '') + 'edge-label', weight: err ? 700 : null }));
            if (st[3]) g.appendChild(text((a + b) / 2, y + 16, st[3], { size: 11.5, cls: 't-soft val-label' }));
          }
          g.insertBefore(text(22, y + 5, String(i + 1), { size: 20, cls: 't-hand t-faint' }), g.firstChild);
          layer.appendChild(g); groups.push(g);
        });
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === cur.id ? 'true' : 'false'));
        show();
      }
      function show() {
        const n = SJ.isReport() ? 99 : shown;
        groups.forEach((g, i) => { g.style.opacity = i < n ? 1 : 0.07; });
        endP.textContent = n >= groups.length ? cur.end : (Math.min(n, groups.length)) + ' / ' + groups.length + ' 걸음';
      }
      SC.forEach((sc) => seg.appendChild(h('button', { type: 'button', 'data-k': sc.id, text: sc.label, onclick: () => { cur = sc; shown = 99; playing = false; play.textContent = '▶ 재생'; build(); } })));
      play.addEventListener('click', () => { playing = !playing; play.textContent = playing ? '❚❚ 멈춤' : '▶ 재생'; if (playing) { shown = 0; timer = 0.5; show(); } });
      next.addEventListener('click', () => { playing = false; play.textContent = '▶ 재생'; shown = shown >= groups.length ? 1 : shown + 1; show(); });
      scope.loop((dt) => { if (!playing) return; timer += dt; if (timer > 0.95) { timer = 0; shown++; show(); if (shown >= groups.length) { playing = false; play.textContent = '▶ 처음부터'; } } });
      document.addEventListener('sj-mode', show);
      build();

      body.appendChild(h('div', { class: 'block' }, [
        h('h2', { text: '오류는 숨기지 않고 이름을 붙여 돌려준다' }),
        h('div', { class: 'tb-scroll' }, h('table', { class: 'tb' }, [
          h('thead', {}, h('tr', {}, ['상황', 'HTTP', 'error.code', '다시 시도'].map((c) => h('th', { text: c })))),
          h('tbody', {}, [
            ['요청 모양이 틀림, 빈 문장, 너무 긴 문장', '400', 'INVALID_REQUEST', '안 됨'],
            ['바꿀 단어가 없음, 추론 서버가 입력을 거절', '422', 'NO_GENERATABLE_INPUT', '안 됨'],
            ['어순 변환이 실패', '502', 'TRANSLATION_UNAVAILABLE', '됨'],
            ['추론 서버에 연결 안 됨, 준비 안 됨, 바쁨', '503', 'GENERATION_UNAVAILABLE', '됨'],
            ['시간 안에 답이 안 옴', '504', 'GENERATION_TIMEOUT', '됨'],
            ['좌표 모양이 틀림, 예상 못 한 응답', '502', 'GENERATION_FAILED', '됨'],
          ].map((r) => h('tr', {}, r.map((c, i) => h('td', { text: c, class: i === 2 ? 'mono' : null }))))),
        ])),
        h('p', { class: 'hand', text: '모르는 단어는 오류가 아니다. 그릴 수 있는 만큼 그린 정상 응답이다.', style: { marginTop: '8px' } }),
      ]));

      body.appendChild(h('div', { class: 'block' }, [
        h('h2', { text: '좌표를 주고받는 약속 (계약 ⑤)' }),
        h('div', { class: 'cols' }, [
          h('pre', { class: 'mono', style: { margin: 0, padding: '14px 16px', background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: '14px 18px 13px 20px', overflowX: 'auto', fontSize: '13px', lineHeight: 1.6 }, text:
            'POST /generate   { "gloss": ["화장실", "있다"], "nonmanual": ["의문"] }\n\n→ { "fps": 30, "joints": 125, "frames": T, "units": "shoulder",\n    "data": "base64( float32 little-endian, T × 125 × 3 )",\n    "tokens": [...], "segments": [{"gloss", "start", "end"}, …], "unknown": [], "source": "model" }\n# segments: 문장 모드에서 낱말마다의 구간(프레임). 단어 모드는 []\n\n# 받는 쪽\nraw    = base64.b64decode(data)          # 길이 = T × 125 × 3 × 4\nmotion = np.frombuffer(raw, "<f4").reshape(T, 125, 3)' }),
          h('aside', { class: 'note' }, [
            h('h3', { text: '숫자로 본 추론 서버' }),
            h('div', { class: 'facts' }, [['0.2 ~ 0.7초', '문장 하나, T4 GPU (11월 15일 12문장)'], ['0.40초', '3단어(단어 모델), T4 GPU'], ['2.3초', '3단어, CPU 8코어'], ['1개', '동시에 받는 요청']].map((f) => h('div', { class: 'fact' }, [h('b', { text: f[0], style: { fontSize: '21px' } }), h('span', { text: f[1] })]))),
            h('h4', { text: '알아 둘 점' }),
            h('ul', {}, [h('li', { text: '모델은 서버가 켜질 때 한 번만 올린다.' }), h('li', { text: '배포된 Spring(Cloud Run)이 내부 네트워크로 VM의 추론 서버를 부른다. VM은 쓸 때만 켜고, 꺼져 있으면 앱은 1학기 영상으로 보여 준다.' }), h('li', { text: '읽기 주소 POST /recognize 는 동작 좌표를 읽는 모델에 넣어 어떤 단어로 읽히는지 돌려준다 (11월 15일 추가).' }), h('li', { text: '낱말 데이터에서 온 낱말 자리에 대표 동작을 끼우는 설정(word_source = exemplar, 11월 16일)으로 켤 수 있다. 아직 jjh-accuracy 브랜치에만 있다.' }), h('li', { text: '"의문" 표시는 전달되지만 동작에는 아직 반영되지 않는다.' })]),
          ]),
        ]),
      ]));
    },
  });

  /* ───────────── 앱의 AI 화면 · 뷰어 ───────────── */
  const mini = {
    list(g, x, y) { for (let i = 0; i < 4; i++) { g.appendChild(s('rect', { x: x + 16, y: y + 10 + i * 17, width: 110 - i * 12, height: 9, rx: 4, fill: i === 0 ? 'var(--core-wash)' : 'var(--paper-deep)', stroke: 'var(--line-strong)', 'stroke-width': 0.8 })); } },
    player(g, x, y) { const f = SJ.pose.figure({ scale: 24, x: x + 70, y: y + 30, weight: 0.5 }); f.set(SJ.pose.clipFrame('b', 30)); g.appendChild(f.g); g.appendChild(s('rect', { x: x + 14, y: y + 74, width: 112, height: 5, rx: 2.5, fill: 'var(--paper-deep)' })); g.appendChild(s('rect', { x: x + 14, y: y + 74, width: 48, height: 5, rx: 2.5, fill: 'var(--core)' })); return f; },
    four(g, x, y) { ['원본', 'B1', 'B2', '토큰'].forEach((t, i) => { const px = x + 8 + (i % 2) * 64, py = y + 4 + Math.floor(i / 2) * 40; g.appendChild(s('rect', { x: px, y: py, width: 60, height: 36, rx: 4, fill: i === 3 ? 'var(--core-pale)' : 'var(--card)', stroke: 'var(--line-strong)', 'stroke-width': 0.9 })); g.appendChild(text(px + 30, py + 23, t, { size: 11 })); }); },
    two(g, x, y) { [0, 1].forEach((i) => { const f = SJ.pose.figure({ scale: 17, x: x + 38 + i * 62, y: y + 26, weight: 0.45 }); f.set(SJ.pose.clipFrame('a', 24 + i)); g.appendChild(f.g); }); g.appendChild(text(x + 70, y + 82, '원본  |  복원', { size: 10.5, cls: 't-soft' })); },
    grid(g, x, y) { const r = SJ.rng(5); for (let i = 0; i < 60; i++) g.appendChild(s('rect', { x: x + 14 + (i % 12) * 9.5, y: y + 10 + Math.floor(i / 12) * 13, width: 7.5, height: 10, rx: 1.5, fill: r() > 0.6 ? 'var(--core-wash)' : 'var(--card)', stroke: 'var(--line-strong)', 'stroke-width': 0.6 })); },
    input(g, x, y) { g.appendChild(s('rect', { x: x + 12, y: y + 6, width: 116, height: 20, rx: 6, fill: 'var(--card)', stroke: 'var(--ink)', 'stroke-width': 1.2 })); g.appendChild(text(x + 20, y + 20, '병원', { size: 11.5, anchor: 'start' })); const f = SJ.pose.figure({ scale: 17, x: x + 70, y: y + 46, weight: 0.45 }); f.set(SJ.pose.clipFrame('a', 26)); g.appendChild(f.g); },
    cam(g, x, y) { g.appendChild(s('rect', { x: x + 16, y: y + 4, width: 108, height: 78, rx: 8, fill: 'var(--paper-deep)', stroke: 'var(--ink)', 'stroke-width': 1.2 })); const pts = SJ.pose.clipFrame('b', 30); let d = ''; SJ.pose.EDGES.rhand.forEach((e) => { const a = pts[e[0]], b = pts[e[1]]; d += 'M' + (x + 70 + (a[0] - pts[34][0]) * 150) + ' ' + (y + 66 + (a[1] - pts[34][1]) * 150) + 'L' + (x + 70 + (b[0] - pts[34][0]) * 150) + ' ' + (y + 66 + (b[1] - pts[34][1]) * 150); }); g.appendChild(s('path', { d, fill: 'none', stroke: 'var(--core)', 'stroke-width': 1.6, 'stroke-linecap': 'round' })); },
    gaps(g, x, y) { const r = SJ.rng(3); for (let i = 0; i < 28; i++) { const miss = r() < 0.18; g.appendChild(s('rect', { x: x + 12 + i * 4.2, y: y + 30, width: 3.2, height: 22, fill: miss ? 'var(--paper-deep)' : '#3E7CB1' })); } g.appendChild(text(x + 70, y + 74, '손이 빠진 프레임 찾기', { size: 10.5, cls: 't-soft' })); },
  };
  const SCREENS = [
    { id: 'sign-lab', t: '작업실 입구', m: 'list', st: '입구', what: 'AI 화면 일곱 개로 가는 목록. 탭 메뉴에는 없고 주소로 들어간다.', files: ['app/sign-lab.tsx'] },
    { id: 'sign-generate', t: '단어 → 동작 만들기', m: 'input', st: '실제 모델과 확인', hot: 1, what: '단어를 넣으면 Spring을 거쳐 실제 모델이 만든 좌표를 받아 재생한다. 오류 안내와 다시 시도 버튼, 모르는 단어 안내가 있다. 가짜 서버로도 켤 수 있다.', files: ['components/sign-player/GenerationLab.web.tsx', 'components/sign-player/playback.ts'] },
    { id: 'sign-player', t: '3D 뼈대 재생기', m: 'player', st: '동작', hot: 1, what: '동작 JSON 하나를 재생한다. 속도와 보는 방향을 바꾸고, 몸 · 손 · 얼굴을 따로 켠다.', files: ['components/sign-player/SignPlayer.tsx', 'components/sign-player/motion.ts'] },
    { id: 'sign-compare', t: '네 조건 나란히', m: 'four', st: '동작', what: '원본, 이어 붙이기(B1), 좌표 회귀(B2), 토큰 방식을 같은 시간과 방향으로 맞춰 본다. 사람 평가용 영상도 여기서 뽑는다.', files: ['components/sign-player/ComparisonPlayer'] },
    { id: 'sign-reconstruct', t: '원본과 복원 비교', m: 'two', st: '동작', what: '자모표가 되돌린 동작을 원본과 겹쳐 보고 좌표 오차를 계산한다. 학습 결과 viewer.html을 그대로 읽는다.', files: ['components/sign-player/AiViewerImport', 'components/sign-player/reconstruction-metrics.ts'] },
    { id: 'sign-codebook', t: '자모표 구경', m: 'grid', st: '동작', what: '토큰 512개가 각각 어떤 동작 조각인지 격자로 본다.', files: ['components/sign-player/CodebookGrid', 'components/sign-player/TokenAtlas'] },
    { id: 'sign-camera', t: '카메라로 손 모으기', m: 'cam', st: '수집까지', what: 'MediaPipe 손 인식으로 양손 21점씩을 5초(최대 150프레임) 모은다. 손목을 원점으로 맞춘 2D 점이다. 상체까지 잡는 판은 sign-body, 친구와 견주는 판은 sign-follow 다.', files: ['components/sign-camera/CameraLab.web.tsx', 'components/sign-camera/hand-features.ts'] },
    { id: 'sign-hand-review', t: '모은 손 점검', m: 'gaps', st: '수집까지', what: '저장한 손 기록을 다시 재생하며 손이 빠진 비율, 초당 장수, 끊긴 구간을 잰다.', files: ['components/sign-camera/SequenceReview.web.tsx', 'components/sign-camera/sequence-quality.ts'] },
    { id: 'sign-body', t: '카메라로 상체 + 손', m: 'cam', st: '동작', hot: 1, what: 'MediaPipe 상체와 손 인식을 같이 돌려, AI 동작과 같은 55점 좌표(목 원점, 어깨너비 1)로 바꾼다. 영상은 저장하거나 보내지 않는다.', files: ['components/sign-camera/BodyTracker.web.tsx', 'components/sign-camera/body-frame.ts', 'components/sign-camera/body-sequence.ts'] },
    { id: 'sign-follow', t: '따라 하고 점수 받기', m: 'cam', st: '동작 · 기준선 임시', hot: 1, what: '친구(AI 동작)를 보며 따라 하면 손 자리와 손가락 모양을 시간에 맞춰 견주어 점수와 고칠 곳을 알려 준다. 통역 화면의 "따라 하기"가 같은 부품이다.', files: ['components/sign-camera/FollowAlong.web.tsx', 'components/sign-camera/body-score.ts', 'lib/api/recognize.ts'] },
  ];

  SJ.room('screens', {
    short: 'AI 화면', title: 'AI 작업실: 만든 동작을 눈으로 보는 곳', kicker: 'frontendcodes/app/sign-* · viewer/',
    lead: '숫자만으로는 동작이 맞는지 알 수 없다. 좌표를 뼈대로 그려 재생하고, 원본과 나란히 놓고, 카메라로 따라 하는 화면까지 열 개다. 카드를 눌러 보자.',
    owners: [P.seunghyeok],
    build(body, scope) {
      const note = h('aside', { class: 'note' });
      const F = SJ.fig(1000, 770, { minw: 760, file: 'suji-ai-screens', label: 'AI 작업실의 화면 열 개', caption: '카드 안의 그림은 화면 모양을 흉내 낸 것이다. 붉게 칠한 네 장이 "문장이 동작이 되고, 따라 하면 점수가 나오는 길"에 있는 화면.' });
      body.appendChild(h('div', { class: 'block' }, h('div', { class: 'cols' }, [F.figure, note])));
      const live = [];
      SCREENS.forEach((sc, i) => {
        const x = 12 + (i % 4) * 247, y = 20 + Math.floor(i / 4) * 250;
        const g = SJ.node({ id: sc.id, x, y, w: 228, h: 224, title: sc.t, sub: [sc.id], kind: sc.hot ? 'core' : 'touch', top: true, size: 16, subCls: 't-mono t-soft', delay: i * 0.05 });
        const art = s('g'); g.appendChild(art);
        g.appendChild(s('rect', { x: x + 44, y: y + 78, width: 140, height: 96, rx: 10, fill: 'var(--card)', stroke: 'var(--ink)', 'stroke-width': 1.4 }));
        const inner = s('g'); g.appendChild(inner);
        const f = mini[sc.m](inner, x + 44, y + 82); if (f) live.push(f);
        g.appendChild(text(x + 114, y + 204, sc.st, { size: 13, cls: sc.st === '수집까지' ? 't-soft' : 't-core', weight: 700 }));
        g.addEventListener('click', () => pick(sc)); F.svg.appendChild(g);
      });
      function pick(sc) {
        note.textContent = '';
        note.appendChild(h('div', { class: 'chips' }, [h('span', { class: 'chip' + (sc.hot ? ' core' : ''), text: sc.st }), h('span', { class: 'chip mono', text: '/' + sc.id })]));
        note.appendChild(h('h3', { text: sc.t, style: { marginTop: '8px' } })); note.appendChild(h('p', { text: sc.what }));
        note.appendChild(h('h4', { text: '파일' })); note.appendChild(h('ul', {}, sc.files.map((p) => h('li', { class: 'path', text: p }))));
      }
      pick(SCREENS[1]);
      let fr = 0; scope.loop((dt) => { fr = (fr + dt * 30 * 0.7) % 72; live.forEach((f) => f.set(SJ.pose.clipFrame('b', fr))); });

      body.appendChild(h('div', { class: 'block' }, [
        h('h2', { text: '어디까지 이어졌고 무엇이 남았나' }),
        h('div', { class: 'tb-scroll' }, h('table', { class: 'tb' }, [
          h('thead', {}, h('tr', {}, ['것', '상태', '근거'].map((c) => h('th', { text: c })))),
          h('tbody', {}, [
            ['단어 만들기 화면 ↔ 실제 모델', '확인함', '11월 4일 "병원" 60프레임(약 2초) 재생, 모르는 단어 안내, 다시 정상으로 돌아옴'],
            ['오류 안내와 다시 시도', '확인함', '가짜 503에서 서버 문구 표시, 입력 유지, 다시 시도 버튼'],
            ['아이폰 Safari · Chrome', '확인함', '응답 파일 가져오기와 재생, 렌더링 전후 성능 비교'],
            ['통역 화면에서 AI 동작 쓰기', '이어짐', '11월 15일 배포 주소에서 문장 → 3D 친구를 확인. AI 서버가 꺼져 있으면 영상으로 넘어간다'],
            ['카메라로 따라 하기 · 채점', '이어짐 · 기준선 임시', '친구 동작과 직접 견주는 점수. 읽는 모델도 연결했지만 점수에 넣지 않는다 (문장 속 낱말 전체 61.4%, 끼워 넣기 전 26.5%)'],
            ['웹 입력 칸 · 마을 건물 누르기', '고침', '11월 15일. 상자 바탕 그림이 글 칸을 덮던 것, 웹에서 누른 자리 값이 오지 않아 건물이 눌리지 않던 것'],
            ['뷰어 (viewer/)', '쓰는 중', '학습 결과를 원본 · 복원 나란히 보는 HTML. 앱 재생기의 바탕이 됐다'],
          ].map((r) => h('tr', {}, r.map((c, i) => h('td', { text: c, style: i === 1 ? { whiteSpace: 'nowrap', fontWeight: 700 } : null }))))),
        ])),
      ]));
    },
  });
})();
