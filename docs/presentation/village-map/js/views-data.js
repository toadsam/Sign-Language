/* 데이터 모델 (Firestore · 파일) / 팀과 계약 */
(function () {
  'use strict';
  const SJ = window.SJ, s = SJ.s, h = SJ.h, text = SJ.text, D = window.SJD, P = D.people;
  const ROW = 19, HEAD = 46;

  /* 표 모양 상자: 머리(이름) + 필드 줄 */
  function entity(o) {
    const hh = HEAD + o.fields.length * ROW + 10, seed = SJ.hash(o.id);
    const g = s('g', { class: 'node ent', 'data-id': o.id, tabindex: 0, role: 'button', 'aria-label': o.title });
    g.appendChild(s('rect', { class: 'paperfill', x: o.x, y: o.y, width: o.w, height: hh, rx: 6 }));
    g.appendChild(s('path', { class: 'wash', d: SJ.blob(o.x - 2, o.y - 2, o.w + 4, HEAD + 2, seed, 2.4), fill: o.color || 'var(--paper-deep)' }));
    g.appendChild(s('path', { class: 'ink' + (o.dash ? ' dash' : ''), d: SJ.roughRect(o.x, o.y, o.w, hh, seed, 1.3) }));
    g.appendChild(s('path', { class: 'ink thin', d: SJ.wline(o.x, o.y + HEAD, o.x + o.w, o.y + HEAD, SJ.rng(seed + 1), 1) }));
    g.appendChild(text(o.x + 12, o.y + 20, o.title, { size: 13.5, cls: 't-mono', anchor: 'start', weight: 500 }));
    g.appendChild(text(o.x + 12, o.y + 37, o.sub, { size: 11.5, cls: 't-soft', anchor: 'start' }));
    o.fields.forEach((f, i) => {
      const y = o.y + HEAD + 17 + i * ROW;
      g.appendChild(text(o.x + 12, y, (f[2] ? '● ' : '') + f[0], { size: 11.5, cls: 't-mono' + (f[2] ? ' t-core' : ''), anchor: 'start' }));
      g.appendChild(text(o.x + o.w - 12, y, f[1], { size: 11, cls: 't-faint', anchor: 'end' }));
    });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
    return g;
  }
  function board(root, o) {
    const note = h('aside', { class: 'note' });
    const F = SJ.fig(o.w, o.h, { minw: o.minw || 980, file: o.file, label: o.label, caption: o.caption });
    root.appendChild(h('div', { class: 'block' }, [h('h2', { text: o.title }), h('p', { text: o.lead }), F.figure, note]));
    const els = {}, rel = [];
    o.rels.forEach((r) => { const a = SJ.arrow(r); F.svg.appendChild(a); rel.push({ el: a, a: r.a, b: r.b }); });
    o.ents.forEach((e) => { const g = entity(e); els[e.id] = g; F.svg.appendChild(g); g.addEventListener('click', (ev) => { ev.stopPropagation(); pick(e); }); });
    function reset() {
      Object.values(els).forEach((g) => g.classList.remove('dim', 'sel')); rel.forEach((r) => r.el.querySelectorAll('.edge,.edge-label').forEach((p) => p.classList.remove('dim')));
      note.textContent = ''; note.appendChild(h('h3', { text: o.introTitle })); o.intro.forEach((l) => note.appendChild(h('p', { text: l })));
    }
    function pick(e) {
      const near = new Set([e.id]);
      rel.forEach((r) => { const on = r.a === e.id || r.b === e.id; if (on) { near.add(r.a); near.add(r.b); } r.el.querySelectorAll('.edge,.edge-label').forEach((p) => p.classList.toggle('dim', !on)); });
      o.ents.forEach((x) => { els[x.id].classList.toggle('dim', !near.has(x.id)); els[x.id].classList.toggle('sel', x.id === e.id); });
      note.textContent = ''; note.appendChild(h('h3', { class: 'mono', text: e.title })); e.note.forEach((l) => note.appendChild(h('p', { text: l })));
      if (e.src) { note.appendChild(h('h4', { text: '코드' })); note.appendChild(h('p', { class: 'path', text: e.src })); }
    }
    F.svg.addEventListener('click', reset); reset();
    if (o.extra) o.extra(F.svg);
  }

  SJ.view('data', {
    build(root) {
      root.appendChild(h('div', { class: 'view-head' }, [h('h1', { text: '데이터가 어디에 어떤 모양으로 있나' }), h('p', { text: '앱의 기록은 Firestore에, AI의 데이터는 파일에 있다. 상자를 누르면 이어진 것만 남는다.' })]));

      board(root, {
        title: '앱 데이터: Firestore 컬렉션 (1학기부터)', lead: 'Firestore는 표와 외래키가 없는 문서 저장소다. 그래서 ERD 표기를 빌리되, 실선은 진짜 포함 관계(하위 컬렉션), 점선은 앱 코드가 지키는 약속으로 그렸다.',
        w: 1280, h: 720, file: 'suji-data-firestore', label: 'Firestore 컬렉션 구조. users, quiz_items, 그리고 users 아래의 translator_bookmarks와 wrong_note_saved.',
        caption: '● 는 다른 문서를 가리키는 값. SQL이나 JPA는 쓰지 않는다. 저장하는 코드는 모두 UserService.java와 QuizService.java 두 곳에 있다.',
        introTitle: '읽는 법', intro: ['관계형 DB였다면 "푼 문제" 표를 따로 두고 조인했을 것이다. 여기서는 사용자 문서 하나에 배열과 맵으로 넣어, 화면에 필요한 것을 한 번에 읽는다.', '대가도 있다. 문제를 지워도 사용자 문서의 quizId는 그대로 남고, 그 정리는 DB가 아니라 코드가 해야 한다.'],
        ents: [
          { id: 'users', x: 30, y: 96, w: 300, title: 'users / {Google sub}', sub: '사용자 한 명 = 문서 하나', color: 'var(--yellow-soft)', src: 'user/service/UserService.java · user/model/UserInfo.java',
            fields: [['userId', 'int (번호표에서 받음)'], ['name · email · phoneNumber', 'string'], ['organization', 'string'], ['isRegistered', 'boolean'], ['profileImageUrl', 'string'], ['userLevel', 'int'], ['totalQuestionNum', 'int'], ['correctQuestionNum', 'int'], ['totalQuestions', '[quizId]', 1], ['incorrectQuestions', '[quizId]', 1], ['incorrectQuestionCounts', '{quizId: 횟수}', 1], ['incorrectQuestionDates', '{quizId: 날짜}', 1], ['dailySolvedCounts', '{"yyyy-MM-dd": 개수}']],
            note: ['문서 id는 Google 계정의 sub 값이다. 앱이 기기에 넣어 둔 사용자 id와 같다.', '푼 문제, 틀린 문제, 날짜별 풀이 수를 모두 이 문서 안에 넣었다. 오답노트 목록, 7일 추이, 자주 틀린 단어는 저장하지 않고 읽을 때마다 여기서 계산한다.', '문제를 한 번 풀 때마다의 낱낱 기록은 남기지 않는다.'] },
          { id: 'counter', x: 30, y: 430, w: 300, title: 'users / userCounter', sub: '번호표 문서 (같은 컬렉션 안)', src: 'UserService.getNextUserId', fields: [['lastUserId', 'int']],
            note: ['가입할 때 트랜잭션 안에서 1을 올려 userId를 준다. 진짜 사용자 문서와 같은 컬렉션에 섞여 있다는 점이 특이하다.'] },
          { id: 'bm', x: 450, y: 96, w: 370, title: 'users/{uid} / translator_bookmarks', sub: '하위 컬렉션 · 북마크 두 종류가 같이 있다', color: 'var(--sky)', src: 'UserService.saveBookmark · saveTranslatorBookmark',
            fields: [['(문서 id)', 'quizId 또는 "txt_" + UUID', 1], ['quizId', 'string', 1], ['questionText', 'string (문제 글 · 넣은 문장)'], ['word', 'string'], ['videoUrl', 'string'], ['source', '"translator" (통역 북마크만)'], ['savedAt', '서버 시각']],
            note: ['퀴즈 북마크는 문서 id가 quizId라서 같은 문제를 두 번 담을 수 없다. 통역 북마크는 id가 txt_로 시작하고 quiz_items와 이어지지 않는다.', '문제 글과 영상 주소를 복사해 넣어 두어, 목록을 그릴 때 quiz_items를 다시 읽지 않는다.'] },
          { id: 'wn', x: 450, y: 310, w: 370, title: 'users/{uid} / wrong_note_saved', sub: '하위 컬렉션 · 저장한 오답', color: 'var(--sky)', src: 'UserService.saveWrongNote · deleteSavedWrongNote',
            fields: [['(문서 id)', 'quizId', 1], ['quizId', 'string', 1], ['questionText · word · videoUrl', 'string'], ['wrongAt', '날짜 (틀린 때)'], ['savedAt', '서버 시각'], ['isHidden', 'boolean'], ['hiddenAt', '서버 시각 또는 없음']],
            note: ['지울 때 문서를 없애지 않고 isHidden을 켠다. 목록에서는 숨긴 것을 건너뛴다.'] },
          { id: 'quiz', x: 940, y: 96, w: 310, title: 'quiz_items / {q001 …}', sub: '퀴즈 문제', color: 'var(--leaf)', src: 'quiz/QuizService.java · scripts/update_quiz_items.py',
            fields: [['questionText', 'string'], ['choices', '[string × 4]'], ['correctChoiceId', '"A" ~ "D"'], ['videoUrl', 'string'], ['isActive', 'boolean'], ['level · category', 'int · "basic" | "daily"'], ['difficulty_level', 'string'], ['attempt_count', 'int'], ['correct_count · wrong_count', 'int']],
            note: ['문제 20개는 파이썬 스크립트로 넣었다. 서버는 문제를 새로 만들지 않고, 풀 때마다 시도 수와 정답 수만 올린다.', '켜진(isActive) 문제만 뽑는다.'] },
          { id: 'storage', x: 940, y: 400, w: 310, title: 'Storage  Model_videos/', sub: '수어 영상 파일 (Firestore 바깥)', dash: true, src: 'storage/StorageVideoCache.java', fields: [['파일 이름', '<단어>_….mp4'], ['주소', '읽을 때마다 만든다']],
            note: ['영상 주소를 DB에 적어 두지 않는다. 정답 단어 이름으로 파일을 찾아 그때 주소를 만들고, 찾은 것과 없는 것을 서버 메모리에 기억한다.', '서버는 읽기만 하고 올리지 않는다.'] },
          { id: 'dict', x: 940, y: 520, w: 310, title: 'sign_dictionary.json', sub: '서버 안의 파일 · 120단어', dash: true, src: 'dictionary/DictionaryLoader.java', fields: [['id · word · file', 'int · string · string']],
            note: ['통역 화면의 영상 재생용 사전. 2학기 생성 길은 이 사전 대신 모델의 3,000단어 표를 쓴다.'] },
          { id: 'device', x: 450, y: 524, w: 370, title: '기기 저장소', sub: '앱은 SecureStore, 웹은 localStorage', dash: true, src: 'context/auth-context.tsx · app/translator.tsx',
            fields: [['auth.accessToken', 'JWT'], ['auth.user', '{id, email, name, picture}', 1], ['auth.isGuest', '"true"'], ['firstStorySeen', '"1"'], ['translator.bookmarks.sentences.v2', '게스트용 · 최대 20개']],
            note: ['로그인하지 않은 사람의 통역 북마크는 서버가 아니라 기기에만 남는다.', 'auth.user.id가 users 문서 id다.'] },
        ],
        rels: [
          { a: 'users', b: 'bm', from: [330, 150], to: [450, 150], label: '1 : N' },
          { a: 'users', b: 'wn', from: [330, 330], to: [450, 370], label: '1 : N' },
          { a: 'bm', b: 'quiz', from: [820, 140], to: [940, 140], label: 'id = quizId', dash: true },
          { a: 'wn', b: 'quiz', from: [820, 350], to: [940, 280], label: 'id = quizId', dash: true },
          { a: 'users', b: 'quiz', from: [200, 96], to: [1080, 96], bend: -70, label: 'quizId를 배열과 맵에 적어 둔다 (M : N)', dash: true },
          { a: 'quiz', b: 'storage', from: [1095, 327], to: [1095, 400], label: '정답 단어 이름으로', dash: true, lanchor: 'start', ldx: 8, ldy: 4 },
          { a: 'counter', b: 'users', from: [180, 430], to: [180, 403], label: '번호표', lanchor: 'start', ldx: 8, ldy: 4 },
          { a: 'device', b: 'users', from: [450, 590], to: [330, 380], bend: 30, label: 'auth.user.id', dash: true },
        ],
      });

      board(root, {
        title: 'AI 데이터: 파일과 이름표 (2학기)', lead: 'AI 쪽에는 DB가 없다. 파일들이 같은 이름표로 이어진다. 클립 이름, 단어 번호, 사람 번호, 자모표 버전 네 가지가 열쇠다.',
        w: 1280, h: 540, file: 'suji-data-files', label: 'AI 데이터 파일 구조. 동작 좌표, 메타, 분할표, 토큰, 모델 묶음이 클립 이름과 버전으로 이어진다.',
        caption: '점선 상자는 저장소에 올리지 않는 것이다(data/, runs/, *.npy, *.pt). AI Hub 약관 때문에 원본 좌표는 각자 받아서 쓴다. 분할표만 저장소에 있다.',
        introTitle: '열쇠 네 개', intro: ['clip  WORD1501_REAL01  한 사람이 한 번 한 동작', 'item  WORD1501  단어(또는 문장) 번호', 'signer  REAL01  수행자', 'vq_version  v0.3-e5  어느 자모표로 적은 토큰인가. 버전이 다른 토큰과 디코더를 섞으면 엉뚱한 동작이 나온다.'],
        ents: [
          { id: 'npy', x: 30, y: 96, w: 250, title: 'npy/<clip>.npy', sub: '동작 좌표 (계약 ①)', dash: true, color: 'var(--yellow-soft)', src: 'ml/common/data.py', fields: [['배열', 'float32 [T, 125, 3]']], note: ['한 클립의 모든 프레임. 읽을 때 [T, 375]로 편다. 목이 원점, 어깨너비가 1.'] },
          { id: 'meta', x: 30, y: 200, w: 250, title: 'meta.jsonl', sub: '클립마다 한 줄', dash: true, color: 'var(--yellow-soft)', src: 'docs/contracts.md ①',
            fields: [['clip', 'string', 1], ['item · signer · type', 'WORD | SEN', 1], ['frames · active', 'int · [시작, 끝]'], ['norm', '{origin, yaw, scale}'], ['label · gloss', '"ok" · [형태소]'], ['segments', '[{name, f0, f1}]'], ['question · dur_ratio', 'bool · 1.0이 정상'], ['check', '{src_unit, repair …}']],
            note: ['라벨이 필요한 모델은 label이 "ok"이고 dur_ratio가 0.85 이상 1.5 미만인 클립만 쓴다. dur_ratio가 3쯤이면 10fps로 뽑힌 클립이다.'] },
          { id: 'vq', x: 340, y: 96, w: 240, title: 'runs/vq_e5/model.pt', sub: '자모표 (계약 ②)', dash: true, color: 'var(--yellow-soft)', src: 'ml/vq/model.py · load_vqvae', fields: [['가중치', '인코더 · 512칸 · 디코더'], ['cfg', '{parts, nb_code}']], note: ['encode로 토큰을 만들고 decode로 동작을 되돌린다. 받아쓰기 모델은 이 디코더가 맞는 것인지 파일 지문(sha256)으로 확인한다.'] },
          { id: 'split', x: 340, y: 226, w: 240, title: 'splits/full*.json', sub: '고정 분할표 (저장소에 있음)', color: 'var(--yellow-soft)', src: 'ml/prep/make_split.py', fields: [['signers', '{train, val, test}', 1], ['exclude.clips', '[clip]', 1], ['heldout_sentences', '새 조합 문장 50개']], note: ['단어용, 문장용, 합친 것 세 개. 셋 다 같은 사람을 평가에 쓴다. 한 번 정하면 덮어쓰지 않는다.'] },
          { id: 'sen', x: 340, y: 376, w: 240, title: 'sentences.jsonl', sub: '문장 라벨 31,986줄', dash: true, color: 'var(--yellow-soft)', src: 'docs/handoff/jiheon.md', fields: [['clip', 'string', 1], ['gloss', '[형태소] 평균 3.2개'], ['nonmanual', '["의문"] 뿐']], note: ['한국어 원문은 AI Hub에 없다. 형태소 열만 있다. 표정 표시는 "의문"만 있고 약 3%다.'] },
          { id: 'tok', x: 650, y: 96, w: 280, title: 'tokens_e5.json', sub: '8만 클립의 토큰 열 (계약 ②)', dash: true, color: 'var(--yellow-soft)', src: 'ml/gen/tokenize.py',
            fields: [['vq_version', '"v0.3-e5"', 1], ['nb_code · down', '512 · 4'], ['clips{clip}', '', 1], ['  item · signer · type', ''], ['  frames', '[시작, 끝)'], ['  tokens', '[0 ~ 511]']], note: ['받아쓰기 모델의 학습 데이터. 토큰 종류 수는 코드에 박지 않고 nb_code를 읽는다.'] },
          { id: 'rec', x: 650, y: 310, w: 280, title: '읽는 모델 묶음', sub: 'runs/recog_*', dash: true, color: 'var(--leaf)', src: 'ml/recog/infer.py', fields: [['가중치', 'Conv + GRU'], ['classes', '[item × 3,000]', 1]], note: ['사람 동작으로만 학습한다. 자모표와 같은 분할표를 읽어 평가 사람이 같다.'] },
          { id: 'gen', x: 990, y: 96, w: 262, title: 'generator.json 묶음', sub: '추론 서버가 여는 것', dash: true, color: 'var(--sky)', src: 'ml/gen/infer.py · infer_models.py',
            fields: [['kind', '"word_gpt"'], ['generator_checkpoint', '+ sha256'], ['vocab_map', '단어 → item', 1], ['vq 디코더', '+ sha256', 1], ['sampling', '{guidance, signers, …}']], note: ['서버가 켜질 때 이 묶음 하나만 읽는다. 모델을 바꾸려면 폴더만 바꾸고 다시 켠다.', 'vocab_map이 한국어 단어를 WORD 번호로 이어 준다. 여기에 없으면 모르는 단어다.'] },
          { id: 'api', x: 990, y: 310, w: 262, title: '응답 JSON', sub: '앱으로 가는 것 (계약 ⑤)', color: 'var(--grape)', src: 'ml/serve/serialization.py', fields: [['fps · joints · frames', '30 · 125 · T'], ['data', 'base64 float32'], ['tokens · unknown', '[int] · [단어]'], ['source', '"model" | "baseline"']], note: ['파일이 아니라 지나가는 데이터다. 저장하지 않는다.'] },
        ],
        rels: [
          { a: 'npy', b: 'meta', from: [155, 171], to: [155, 200], label: 'clip', lanchor: 'start', ldx: 8, ldy: 4, nohead: true },
          { a: 'npy', b: 'vq', from: [280, 132], to: [340, 132], label: '학습', core: true },
          { a: 'vq', b: 'tok', from: [580, 140], to: [650, 140], label: 'encode', core: true },
          { a: 'tok', b: 'gen', from: [930, 150], to: [990, 150], label: '학습', core: true },
          { a: 'meta', b: 'split', from: [280, 290], to: [340, 290], label: 'signer', dash: true },
          { a: 'meta', b: 'sen', from: [280, 400], to: [340, 420], label: 'clip', dash: true },
          { a: 'split', b: 'rec', from: [580, 300], to: [650, 350], label: '같은 평가 사람', dash: true, at: 0, lanchor: 'start', ldx: 6, ldy: -8 },
          { a: 'vq', b: 'gen', from: [460, 96], to: [1120, 96], bend: -62, label: 'decode (같은 vq_version끼리만)', core: true },
          { a: 'gen', b: 'api', from: [1120, 251], to: [1120, 310], label: 'generate()', core: true, lanchor: 'start', ldx: 8, ldy: 4 },
          { a: 'rec', b: 'gen', from: [930, 350], to: [990, 230], label: '④ 채점', dash: true, bend: 12 },
        ],
      });
    },
  });

  /* ───────────── 팀과 계약 ───────────── */
  const DID = {
    jaehun: ['AI Hub 8만 클립을 3D 125점으로 정리하고 품질 점검', '모두가 같이 쓰는 고정 분할표', '자모표 실험 E1 ~ E5와 토큰 파일', '학습 서버 안내와 팀 규칙 문서', '앱을 색칠 마을로 새 단장'],
    jiheon: ['단어 GPT (조건 강화, guidance)', '생성 API와 오류 약속', '추론 서버 (후보 24개에서 대표 고르기)', '뜻이 같은 단어로 바꾸는 단계', '정답과의 거리로 재는 채점'],
    seunghyun: ['읽는 모델 100 → 500 → 3,000단어', '중복 클립 점검', '자모표 E5 역번역 채점', '손 가중 · 뼈 방향 자모표 후보 실험'],
    seunghyeok: ['3D 뼈대 재생기와 네 조건 비교 화면', '생성 화면의 오류 안내와 다시 시도', '아이폰 Safari · Chrome 확인', '실제 모델 첫 재생 (11월 4일)', '카메라 손 모으기와 품질 점검'],
  };
  SJ.view('team', {
    build(root) {
      root.appendChild(h('div', { class: 'view-head' }, [h('h1', { text: '네 사람, 다섯 개의 약속' }), h('p', { text: '모델마다 주인을 정하고, 주고받는 것의 모양만 먼저 약속했다. 그래서 서로 기다리지 않고 가짜 데이터로 따로 만들다가 합칠 수 있었다.' })]));
      const note = h('aside', { class: 'note' });
      const F = SJ.fig(1100, 600, { minw: 820, file: 'suji-team-contracts', label: '팀원 네 명과 계약 다섯 개. 재훈이 동작 데이터와 토큰을 주고, 지헌이 생성 함수와 API를, 승현이 채점 함수를 준다.', caption: '화살표는 "주는 사람 → 받는 사람". 약속의 모양을 바꾸려면 네 명이 모두 승인해야 한다(docs/contracts.md).' });
      root.appendChild(h('div', { class: 'cols' }, [F.figure, note]));
      const svg = F.svg, POS = { jaehun: [40, 220], jiheon: [440, 220], seunghyun: [820, 40], seunghyeok: [820, 400] }, PW = 240, PH = 150, els = {}, arrows = [];
      const A = [
        { n: '①', a: 'jaehun', b: 'jiheon', from: [280, 262], to: [440, 262] }, { n: '②', a: 'jaehun', b: 'jiheon', from: [280, 318], to: [440, 318] },
        { n: '①', a: 'jaehun', b: 'seunghyun', from: [200, 220], to: [820, 96], bend: -60 }, { n: '①', a: 'jaehun', b: 'seunghyeok', from: [200, 370], to: [820, 494], bend: 60 },
        { n: '③', a: 'jiheon', b: 'seunghyun', from: [640, 220], to: [820, 150], bend: -14 }, { n: '④', a: 'seunghyun', b: 'jiheon', from: [860, 190], to: [680, 240], bend: -14 },
        { n: '④', a: 'seunghyun', b: 'jaehun', from: [820, 66], to: [120, 220], bend: 96 }, { n: '⑤', a: 'jiheon', b: 'seunghyeok', from: [640, 370], to: [820, 450], bend: 14 },
      ];
      A.forEach((e) => { const c = D.contracts.find((x) => x.n === e.n); const el = SJ.arrow(Object.assign({ core: true, label: e.n + ' ' + c.name, lsize: 12.5 }, e)); svg.appendChild(el); arrows.push({ el, e }); });
      Object.keys(POS).forEach((k, i) => {
        const p = P[k], x = POS[k][0], y = POS[k][1];
        const g = SJ.node({ id: k, x, y, w: PW, h: PH, title: p.name, sub: [p.role].concat(p.folders.join('  ')), kind: 'plain', color: 'var(--p-' + k + ')', size: 22, subSize: 12.5, delay: i * 0.1 });
        els[k] = g; svg.appendChild(g); g.addEventListener('click', (ev) => { ev.stopPropagation(); person(k); });
      });
      function setDim(test) { arrows.forEach((a) => a.el.querySelectorAll('.edge,.edge-label').forEach((p) => p.classList.toggle('dim', !test(a.e)))); }
      function person(k) {
        setDim((e) => e.a === k || e.b === k); Object.keys(els).forEach((x) => els[x].classList.toggle('sel', x === k));
        const p = P[k]; note.textContent = '';
        note.appendChild(h('div', { class: 'chips' }, [h('span', { class: 'chip' }, [h('i', { style: { background: 'var(--p-' + k + ')' } }), p.role])]));
        note.appendChild(h('h3', { text: p.name, style: { marginTop: '8px' } }));
        note.appendChild(h('h4', { text: '맡은 폴더' })); note.appendChild(h('p', { class: 'path', text: p.folders.join(' · ') }));
        note.appendChild(h('h4', { text: '만든 것' })); note.appendChild(h('ul', {}, DID[k].map((t) => h('li', { text: t }))));
        const gives = D.contracts.filter((c) => c.from === k), takes = D.contracts.filter((c) => c.to.indexOf(k) >= 0);
        if (gives.length) { note.appendChild(h('h4', { text: '주는 약속' })); note.appendChild(h('p', { text: gives.map((c) => c.n + ' ' + c.name).join(',  ') })); }
        if (takes.length) { note.appendChild(h('h4', { text: '받는 약속' })); note.appendChild(h('p', { text: takes.map((c) => c.n + ' ' + c.name).join(',  ') })); }
      }
      function intro() {
        setDim(() => true); Object.values(els).forEach((g) => g.classList.remove('sel')); note.textContent = '';
        note.appendChild(h('h3', { text: '약속 다섯 개' }));
        D.contracts.forEach((c) => {
          const b = h('button', { class: 'btn', type: 'button', style: { display: 'block', width: '100%', textAlign: 'left', margin: '6px 0' } }, [h('b', { text: c.n + ' ' + c.name }), h('br'), h('span', { class: 'path', text: c.what }), h('br'), h('span', { class: 't-soft', style: { fontSize: '12.5px', color: 'var(--ink-soft)' }, text: P[c.from].name + ' → ' + c.to.map((t) => P[t].name).join(', ') + ' · ' + c.state })]);
          b.addEventListener('click', () => setDim((e) => e.n === c.n)); note.appendChild(b);
        });
        note.appendChild(h('p', { class: 'hand', text: '사람을 누르면 그 사람의 화살표만 남는다' }));
      }
      svg.addEventListener('click', intro); intro();

      root.appendChild(h('div', { class: 'block', style: { marginTop: '22px' } }, [
        h('h2', { text: '같이 일하는 규칙' }),
        h('div', { class: 'facts' }, [
          ['자기 폴더만', '다른 사람 폴더는 고치지 않고, 무엇을 왜 바꿔야 하는지 요청으로 쓴다'], ['약속은 넷이서', '계약 다섯 개의 모양은 혼자 바꾸지 않는다'], ['데이터는 각자', 'AI Hub 원본과 학습 결과는 저장소에 올리지 않는다'], ['서버는 쓰고 끈다', 'GPU 한 대를 같이 쓴다. 남이 쓰는 중이면 먼저 확인한다'], ['AI 기록은 따로', '작업이 끝나면 자기 파일에 "내가 판단한 것"을 적는다'],
        ].map((f) => h('div', { class: 'fact' }, [h('b', { text: f[0], style: { fontSize: '19px' } }), h('span', { text: f[1] })]))),
      ]));
    },
  });
})();
