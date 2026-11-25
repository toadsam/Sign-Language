/* 전체 구조 지도: 앱 · 서버 · AI · 바깥. 빨간 물감 = 이번 학기 핵심(누르면 확대), 노란 물감 = 이번 학기에 손본 곳, 연필선 = 1학기부터. */
(function () {
  'use strict';
  const SJ = window.SJ, s = SJ.s, h = SJ.h, text = SJ.text;
  const W = 1720, H = 1030;

  /* k: core | touch | old | ext,  room: 눌렀을 때 들어갈 빨간 방 */
  const NODES = [
    // ── 앱 동네 ──
    { id: 'a-login', x: 44, y: 170, w: 152, h: 52, t: '로그인 · 가입', sub: 'Google 계정', k: 'touch', sem: '1학기 · 2학기에 새 단장',
      what: 'Google 로그인 뒤 서버에서 JWT를 받는다. 처음이면 가입 화면으로 가고, 로그인 없이 둘러보기도 된다.', files: ['app/login.tsx', 'app/signup.tsx', 'lib/auth/google.ts'], talks: 'POST /api/auth/login · /signup · /signup/complete' },
    { id: 'a-home', x: 208, y: 170, w: 152, h: 52, t: '마을 (홈)', sub: '오늘 목표 · 첫 이야기', k: 'touch', sem: '1학기 · 2학기에 새 단장',
      what: '배운 장소만 색이 칠해지는 마을 거리. 오늘 목표와 연속 학습일을 보여 준다.', files: ['app/home.tsx', 'components/paint/first-story.tsx'], talks: 'GET /api/users/{uid}' },
    { id: 'a-learn', x: 44, y: 232, w: 152, h: 52, t: '표현 (배우기)', sub: '스케치북에서 고르기', k: 'touch', sem: '1학기 · 2학기에 새 단장',
      what: '퀴즈 묶음(기본 · 일상 · 오답 복습)을 고르는 화면.', files: ['app/learn.tsx', 'components/paint/sketchbook.tsx'], talks: 'GET /api/users/{uid}' },
    { id: 'a-quiz', x: 208, y: 232, w: 152, h: 52, t: '퀴즈', sub: '영상 보고 넷 중 하나', k: 'touch', sem: '1학기 · 2학기에 새 단장',
      what: '3D 친구(AI가 그린 손짓, 11월 15일)나 수어 영상을 보고 뜻을 고른다. AI가 그 단어 하나로 빠짐없이 그릴 때만 친구가 나오고, 정답 영상으로 바꿔 볼 수 있다. 채점 결과와 오답이 기록된다.', files: ['app/quiz.tsx', 'lib/api/quiz.ts', 'lib/api/generate.ts'], talks: 'GET /api/quiz/session · POST /api/quiz/answer · PATCH /api/users/{uid}/tryQuestion · POST /api/sign/generate' },
    { id: 'a-translator', x: 44, y: 294, w: 152, h: 52, t: '통역 (번역기)', sub: '문장 → AI 친구 · 따라 하기', k: 'touch', sem: '1학기 · 2학기에 AI 연결',
      what: '문장을 넣으면 AI가 만든 3D 친구가 수어를 한다. 카메라로 따라 하면 점수와 고칠 곳을 알려 준다. AI 동작을 못 받으면 1학기처럼 단어 영상을 차례로 재생한다.', files: ['app/translator.tsx', 'lib/api/generate.ts', 'lib/api/recognize.ts', 'components/sign-camera/FollowAlong.web.tsx'], talks: 'POST /translate · POST /api/sign/generate · POST /api/sign/recognize' },
    { id: 'a-mypage', x: 208, y: 294, w: 152, h: 52, t: '기록 (마이페이지)', sub: '도장 달력 · 스티커', k: 'touch', sem: '1학기 · 2학기에 새 단장',
      what: '푼 문제 수, 자주 틀린 단어, 도장 달력, 프로필 사진.', files: ['app/mypage.tsx', 'components/paint/stamp-calendar.tsx'], talks: 'GET /api/users/{uid} · /top-wrong-words' },
    { id: 'a-notes', x: 44, y: 356, w: 152, h: 52, t: '오답노트 · 북마크', sub: '다시 풀기', k: 'touch', sem: '1학기 · 2학기에 새 단장',
      what: '저장한 오답과 통역 북마크를 모아 보고 다시 푼다.', files: ['app/wrongnote.tsx', 'app/bookmark.tsx'], talks: '/api/users/{uid}/wrong-note-saved · /translator-bookmarks' },
    { id: 'a-paint', x: 208, y: 356, w: 152, h: 52, t: '색칠 마을 디자인', sub: '먹선 · 물감 부품', k: 'touch', sem: '2학기에 새로', owner: 'jaehun',
      what: '앱 전체를 종이 위 수채 그림으로 바꾼 디자인 부품 21개. 이 지도도 같은 값으로 그렸다.', files: ['components/paint/*', 'constants/paint.ts'], talks: '화면 전부가 가져다 쓴다' },
    { id: 'a-api', x: 384, y: 170, w: 76, h: 238, t: ['API', '모듈'], sub: 'lib/api', k: 'old', sem: '1학기부터',
      what: '서버와 말하는 창구 11개. 서버 주소(EXPO_PUBLIC_API_BASE_URL)를 한 곳에서 정한다.', files: ['lib/api/base-url.ts', 'lib/api/*.ts'], talks: '서버 동네의 모든 입구' },
    { id: 'a-lab', x: 44, y: 440, w: 416, h: 150, t: 'AI 작업실', sub: ['sign-generate  단어 → 동작 만들기', 'sign-player · compare · reconstruct · codebook', 'sign-camera · hand-review  손 인식 모으기'], k: 'core', room: 'screens', owner: 'seunghyeok', tag: '이번 학기 핵심', size: 19,
      what: '만든 동작을 3D 뼈대로 재생하고, 원본과 비교하고, 카메라로 손 모양을 모으는 화면 8개.' },
    { id: 'a-state', x: 44, y: 620, w: 200, h: 58, t: '로그인 상태 보관', sub: '토큰 · 게스트 여부', k: 'old', sem: '1학기부터',
      what: '토큰과 사용자 정보를 기기에 저장한다. 앱은 SecureStore, 웹은 localStorage.', files: ['context/auth-context.tsx'], talks: 'POST /api/auth/google' },
    { id: 'a-tools', x: 260, y: 620, w: 200, h: 58, t: '검사 도구', sub: '응답 계약 검사 · 가짜 서버', k: 'touch', sem: '2학기에 새로', owner: 'seunghyeok',
      what: '서버 없이도 화면을 만들 수 있게 한 가짜 생성 서버(8085)와 응답 형식 검사 스크립트.', files: ['frontendcodes/tools/*'], talks: '계약 ⑤ 형식을 흉내 낸다' },

    // ── 서버 동네 ──
    { id: 'b-auth', x: 532, y: 170, w: 180, h: 54, t: '로그인 auth', sub: 'Google 토큰 → JWT', k: 'old', sem: '1학기부터',
      what: 'Google ID 토큰을 확인하고 JWT를 내준다. 가입할 때 사용자 문서를 만든다. JWT를 서버가 검사하는 필터는 아직 없다.', files: ['auth/AuthController.java', 'auth/GoogleAuthService.java', 'auth/JwtService.java'], talks: 'Google · Firestore users' },
    { id: 'b-user', x: 532, y: 236, w: 180, h: 54, t: '사용자 user', sub: '기록 · 북마크 · 오답', k: 'old', sem: '1학기부터',
      what: '/api/users 아래 입구 18개. 푼 문제, 날짜별 풀이 수, 북마크, 오답노트를 읽고 쓴다.', files: ['user/controller/UserController.java', 'user/service/UserService.java'], talks: 'Firestore users · quiz_items' },
    { id: 'b-quiz', x: 532, y: 302, w: 180, h: 54, t: '퀴즈 quiz', sub: '문제 뽑기 · 채점', k: 'old', sem: '1학기부터',
      what: '켜져 있는 문제만 뽑아 주고, 답을 채점하고, 문제별 정답 수를 올린다.', files: ['quiz/QuizController.java', 'quiz/QuizService.java'], talks: 'Firestore quiz_items · Storage 영상 주소' },
    { id: 'b-translate', x: 532, y: 368, w: 180, h: 54, t: '번역 입구 api', sub: 'POST /translate', k: 'old', sem: '1학기부터',
      what: '1학기 번역의 입구. 어순 변환 결과와 재생할 영상 목록을 돌려준다.', files: ['api/TranslateController.java', 'api/HealthController.java'], talks: '어순 변환 → 수어 사전 → 영상 찾기' },
    { id: 'b-storage', x: 752, y: 170, w: 180, h: 54, t: '영상 찾기 storage', sub: '단어 → 영상 주소', k: 'old', sem: '1학기부터',
      what: '단어 이름으로 Firebase Storage에서 영상을 찾아 주소를 만든다. 찾은 것과 없는 것을 기억해 둔다.', files: ['storage/StorageVideoCache.java'], talks: 'Firebase Storage (읽기만)' },
    { id: 'b-dict', x: 752, y: 236, w: 180, h: 54, t: '수어 사전', sub: '120단어 JSON', k: 'old', sem: '1학기부터',
      what: '영상 재생용 단어 사전. 서버가 켜질 때 한 번 읽는다.', files: ['dictionary/DictionaryLoader.java', 'resources/sign_dictionary.json'], talks: '어순 변환이 단어를 맞춰 볼 때 쓴다' },
    { id: 'b-service', x: 752, y: 302, w: 180, h: 120, t: '어순 변환', sub: ['service', '규칙 · ETRI · OpenAI', '세 갈래 중 고르기'], k: 'old', sem: '1학기부터 (2학기 길도 다시 쓴다)',
      what: '문장을 수어 어순의 단어 열로 바꾼다. 규칙, ETRI 형태소, OpenAI 세 갈래로 만들어 보고 사전에 가장 많이 맞는 갈래를 고른다.', files: ['service/TranslationService.java', 'service/SignSentenceSimplifier.java', 'service/ExternalLexiconApiClient.java', 'service/OpenAiMorphologyNormalizerService.java'], talks: 'ETRI · OpenAI · 우리말샘 · 한국어기초사전' },
    { id: 'b-generation', x: 532, y: 470, w: 400, h: 130, t: '생성 generation', sub: ['POST /api/sign/generate', '단어표 3,000 맞추기 · 뜻 같은 단어로 바꾸기', '좌표 응답 검사 · 오류 안내'], k: 'core', room: 'serve', owner: 'jiheon', tag: '이번 학기 핵심', size: 19,
      what: '문장을 받아 단어 열로 바꾸고, 추론 서버에 보내고, 돌아온 좌표를 검사해 앱에 넘긴다.' },
    { id: 'b-config', x: 532, y: 640, w: 400, h: 50, t: '설정 config', sub: '공개 경로 · CORS · Firebase 계정 두 개 연결', k: 'old', sem: '1학기부터',
      what: '어떤 경로를 열어 둘지, 어느 주소의 앱을 받을지, Firestore와 Storage에 어떤 계정으로 붙을지 정한다.', files: ['config/SecurityConfig.java', 'config/WebConfig.java', 'config/FirebaseConfig.java'], talks: 'Firestore · Storage' },

    // ── AI 동네 ──
    { id: 'c-prep', x: 1010, y: 170, w: 178, h: 92, t: '데이터 정리', sub: ['prep', '키포인트 → 3D 125점', '품질 점검 · 분할표'], k: 'core', room: 'prep', owner: 'jaehun', what: 'AI Hub 키포인트를 정면 3D 125점으로 바꾸고, 이상한 클립을 걸러 내고, 학습 · 평가 사람을 고정한다.' },
    { id: 'c-vq', x: 1254, y: 170, w: 178, h: 92, t: '자모표', sub: ['vq', 'VQ-VAE · 토큰 512개', '동작 ↔ 토큰'], k: 'core', room: 'vq', owner: 'jaehun', what: '동작을 4프레임짜리 조각 512종으로 받아 적는 사전. 토큰을 다시 동작으로 되돌리는 디코더이기도 하다.' },
    { id: 'c-common', x: 1498, y: 170, w: 178, h: 92, t: '공통', sub: ['common', '관절 정의 · 읽기 · 지표'], k: 'core', room: 'prep', owner: 'jaehun', what: '관절 번호, 데이터 읽기, 오차 계산처럼 모든 모델이 같이 쓰는 코드.' },
    { id: 'c-viewer', x: 1010, y: 330, w: 178, h: 100, t: '뼈대 뷰어', sub: ['viewer/', '원본과 복원 나란히'], k: 'core', room: 'screens', owner: 'seunghyeok', what: '동작을 선 그림으로 재생하는 HTML. 학습 결과를 눈으로 확인할 때 쓴다.' },
    { id: 'c-gen', x: 1254, y: 330, w: 178, h: 100, t: '받아쓰기', sub: ['gen', '단어 GPT · 3,000단어', '단어 → 토큰 열'], k: 'core', room: 'gen', owner: 'jiheon', what: '단어를 주면 그 단어의 토큰 열을 한 개씩 써 내려가는 모델.' },
    { id: 'c-recog', x: 1498, y: 330, w: 178, h: 100, t: '읽는 모델', sub: ['recog · eval', '동작 → 단어', '채점과 비교 실험'], k: 'core', room: 'recog', owner: 'seunghyun', what: '동작을 보고 어떤 단어인지 맞히는 모델. 만든 동작이 읽히는지 채점한다.' },
    { id: 'c-serve', x: 1010, y: 530, w: 666, h: 110, t: '추론 서버 serve', sub: ['FastAPI  POST /generate   ·   한 번에 한 요청   ·   좌표를 base64 float32 로'], k: 'core', room: 'serve', owner: 'jiheon', size: 19, what: '학습한 모델을 한 번 올려 두고, 단어 열을 받으면 3D 좌표를 돌려주는 작은 서버.' },

    // ── 마을 바깥 ──
    { id: 'x-pages', x: 44, y: 880, w: 170, h: 62, t: 'GitHub Pages', sub: '앱 웹 버전 배포', k: 'ext', sem: '1학기부터', what: 'main에 올리면 자동으로 웹 버전을 만들어 올린다.', files: ['.github/workflows/deploy-pages.yml'] },
    { id: 'x-google', x: 240, y: 880, w: 160, h: 62, t: 'Google 로그인', sub: 'ID 토큰', k: 'ext', sem: '1학기부터', what: '앱이 받은 Google ID 토큰을 서버가 확인한다.' },
    { id: 'x-firestore', x: 424, y: 880, w: 190, h: 62, t: 'Firestore', sub: 'users · quiz_items', k: 'ext', sem: '1학기부터', what: '사용자와 퀴즈 문서를 넣어 두는 곳. 컬렉션 구조는 데이터 그림에 있다.', go: 'data', goLabel: '데이터 그림 보기' },
    { id: 'x-fstorage', x: 638, y: 880, w: 180, h: 62, t: 'Firebase Storage', sub: '수어 영상 파일', k: 'ext', sem: '1학기부터', what: '단어 영상이 들어 있는 곳. 서버는 목록을 읽고 주소만 만든다.' },
    { id: 'x-openai', x: 842, y: 880, w: 180, h: 62, t: 'OpenAI', sub: 'gpt-4o-mini · 임베딩', k: 'ext', sem: '1학기부터 (임베딩은 2학기)', what: '문장을 단어 열로 풀고, 2학기에는 뜻이 같은 단어를 찾는 데도 쓴다.' },
    { id: 'x-etri', x: 1046, y: 880, w: 230, h: 62, t: 'ETRI · 우리말샘 · 기초사전', sub: '형태소 · 뜻풀이', k: 'ext', sem: '1학기부터', what: '형태소 분석과 사전 뜻풀이. 사전에 없는 단어를 아는 단어로 바꿔 볼 때 쓴다.' },
    { id: 'x-vm', x: 1300, y: 880, w: 180, h: 62, t: 'GCP VM sign-ml', sub: 'T4 한 대 · 학습과 추론', k: 'ext', sem: '2학기', what: '서울 리전 VM. 학습과 추론 서버가 여기서 돈다. 같이 쓰는 규칙은 docs/server.md.', files: ['docs/server.md', 'docs/handoff/RULES.md'] },
    { id: 'x-aihub', x: 1504, y: 880, w: 172, h: 62, t: 'AI Hub 수어 영상', sub: '키포인트 8만 클립', k: 'ext', sem: '2학기', what: '단어 3,000 × 16명, 문장 2,000 × 16명. 한국지능정보사회진흥원 사업 결과물이며, 원본 좌표는 저장소에 올리지 않는다.' },
  ];

  /* 선: [from, to, 좌표…, 옵션] */
  const EDGES = [
    { a: 'a-api', b: 'b-auth', from: [460, 197], to: [532, 197], label: '/api/auth' },
    { a: 'a-api', b: 'b-user', from: [460, 263], to: [532, 263], label: '/api/users' },
    { a: 'a-api', b: 'b-quiz', from: [460, 329], to: [532, 329], label: '/api/quiz' },
    { a: 'a-api', b: 'b-translate', from: [460, 395], to: [532, 395], label: '/translate' },
    { a: 'b-translate', b: 'b-service', from: [712, 395], to: [752, 395] },
    { a: 'b-service', b: 'b-dict', from: [842, 302], to: [842, 290] },
    { a: 'b-dict', b: 'b-storage', from: [842, 236], to: [842, 224] },
    { a: 'b-generation', b: 'b-service', from: [842, 470], to: [842, 422], label: '다시 씀', lanchor: 'start', ldx: 8, ldy: 4, dash: true },
    // 빨간 길
    { a: 'a-lab', b: 'b-generation', from: [460, 500], to: [532, 500], label: '문장', core: true },
    { a: 'b-generation', b: 'a-lab', from: [532, 552], to: [460, 552], label: '⑤ 좌표', core: true, ldy: 16 },
    { a: 'b-generation', b: 'c-serve', from: [932, 556], to: [1010, 556], label: '단어 열', core: true },
    { a: 'c-serve', b: 'b-generation', from: [1010, 592], to: [932, 592], label: '⑤ 좌표', core: true, ldy: 16 },
    { a: 'c-gen', b: 'c-serve', from: [1343, 430], to: [1343, 530], label: '③ 생성 함수', core: true, lanchor: 'start', ldx: 10, ldy: 4 },
    { a: 'c-vq', b: 'c-gen', from: [1343, 262], to: [1343, 330], label: '② 토큰 · 디코더', core: true, lanchor: 'start', ldx: 10, ldy: 4 },
    { a: 'c-prep', b: 'c-vq', from: [1188, 216], to: [1254, 216], label: '①', core: true },
    { a: 'c-gen', b: 'c-recog', from: [1432, 368], to: [1498, 368], label: '④ 채점', core: true },
    { a: 'c-vq', b: 'c-recog', from: [1432, 250], to: [1540, 330], core: true, bend: -8 },
    { a: 'c-vq', b: 'c-viewer', from: [1262, 262], to: [1150, 330], core: true, bend: 8 },
    { a: 'c-prep', b: 'c-viewer', from: [1099, 262], to: [1099, 330], core: true },
    // 바깥
    { a: 'a-login', b: 'x-pages', from: [129, 756], to: [129, 880], label: '웹 배포', dash: true, lanchor: 'start', ldx: 8, at: 0.14, ldy: 4 },
    { a: 'b-auth', b: 'x-google', from: [590, 756], to: [330, 880], dash: true, bend: 20 },
    { a: 'b-user', b: 'x-firestore', from: [650, 756], to: [530, 880], dash: true, bend: 10 },
    { a: 'b-storage', b: 'x-fstorage', from: [728, 756], to: [728, 880], dash: true },
    { a: 'b-service', b: 'x-openai', from: [810, 756], to: [920, 880], dash: true, bend: -10 },
    { a: 'b-service', b: 'x-etri', from: [880, 756], to: [1140, 880], dash: true, bend: -22 },
    { a: 'c-serve', b: 'x-vm', from: [1390, 756], to: [1390, 880], label: '여기서 돈다', dash: true, lanchor: 'start', ldx: 8, at: 0.14, ldy: 4 },
    { a: 'x-aihub', b: 'c-prep', from: [1590, 880], to: [1590, 756], label: '데이터 출처', dash: true, lanchor: 'start', ldx: 8, at: 0.86, ldy: 4 },
  ];
  const ALSO = { 'b-quiz': ['x-firestore', 'x-fstorage'], 'b-auth': ['x-firestore'], 'b-config': ['x-firestore', 'x-fstorage'], 'b-generation': ['x-openai', 'x-etri'] };

  const DISTRICTS = [
    { x: 24, y: 96, w: 452, h: 660, t: '앱 동네', sub: 'frontendcodes/  ·  Expo(React Native)  ·  화면과 손맛' },
    { x: 512, y: 96, w: 440, h: 660, t: '서버 동네', sub: 'backend/  ·  Spring Boot  ·  Cloud Run 에 배포' },
    { x: 988, y: 96, w: 708, h: 660, t: 'AI 동네', sub: 'ml/ · viewer/  ·  PyTorch  ·  이번 학기에 통째로 새로 지은 곳' },
    { x: 24, y: 800, w: 1672, h: 206, t: '마을 바깥', sub: '빌려 쓰는 서비스와 저장소 · 점선은 마을 밖으로 나가는 길' },
  ];

  SJ.view('map', {
    build(root, scope) {
      root.appendChild(h('div', { class: 'view-head' }, [
        h('h1', { text: '한 장으로 보는 수어링고' }),
        h('p', { text: '앱, 서버, AI, 바깥 서비스까지 전부 그렸다. 빨갛게 칠한 곳이 이번 학기에 새로 만든 핵심이고, 누르면 그 자리로 확대해 들어간다.' }),
      ]));
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '칠한 곳 고르기' });
      const FILTERS = [['all', '전체'], ['core', '빨간 곳만'], ['touch', '손본 곳만'], ['old', '1학기부터']];
      root.appendChild(h('div', { class: 'ctrl' }, [
        seg,
        h('div', { class: 'legend' }, [
          h('span', {}, [h('i', { class: 'lg-core' }), '이번 학기 핵심 (누르면 확대)']),
          h('span', {}, [h('i', { class: 'lg-touch' }), '이번 학기에 손본 곳']),
          h('span', {}, [h('i', { class: 'lg-old' }), '1학기부터 있던 곳']),
          h('span', {}, [h('i', { class: 'lg-ext' }), '바깥 서비스']),
        ]),
      ]));

      const F = SJ.fig(W, H, { minw: 1080, file: 'suji-map-structure', label: '수어링고 전체 구조 지도. 앱, 서버, AI 세 동네와 바깥 서비스가 있고 이번 학기 핵심은 빨갛게 칠해져 있다.', caption: '동그란 숫자 ①~⑤는 팀이 정한 계약 다섯 개다. 점선은 마을 바깥으로 나가는 연결.' });
      const svg = F.svg;
      const wrap = h('div', { id: 'map-wrap' }, F.figure);
      const note = h('aside', { class: 'note float-note', 'aria-live': 'polite', hidden: '' });
      const strip = h('div', { class: 'intro-strip' });
      root.appendChild(wrap); root.appendChild(strip); document.body.appendChild(note);
      scope.onHide.push(() => { note.hidden = true; });

      // 동네 테두리
      DISTRICTS.forEach((d, i) => {
        svg.appendChild(s('path', { class: 'wash', d: SJ.blob(d.x, d.y, d.w, d.h, 500 + i, 6), fill: 'var(--paper-deep)', opacity: 0.55 }));
        svg.appendChild(s('path', { class: 'ink soft thin', d: SJ.roughRect(d.x, d.y, d.w, d.h, 40 + i, 2.5) }));
        svg.appendChild(text(d.x + 18, d.y + 36, d.t, { size: 30, cls: 't-hand', anchor: 'start' }));
        svg.appendChild(text(d.x + d.w - 16, d.y + 30, d.sub, { size: 13, cls: 't-soft', anchor: 'end' }));
      });

      // 빨간 길 (점이 달리는 길)
      const road = s('path', { d: 'M460 526 L532 526 L932 574 L1010 574 L1343 574 L1343 480 L1343 296', fill: 'none', stroke: 'var(--core-wash)', 'stroke-width': 26, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.22 });
      svg.appendChild(road);

      const gE = s('g'), gN = s('g'); svg.appendChild(gE); svg.appendChild(gN);
      const edgeEls = EDGES.map((e) => { const el = SJ.arrow(Object.assign({}, e)); gE.appendChild(el); return el; });

      const els = {};
      NODES.forEach((n, i) => {
        const g = SJ.node({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, title: n.t, sub: n.sub, kind: n.k, owner: n.owner, tag: n.tag, size: n.size || (n.w < 160 ? 15 : 16), delay: 0.15 + i * 0.025, subCls: n.k === 'core' ? 't-mono' : 't-soft', subSize: n.k === 'core' ? 12 : 12.5 });
        els[n.id] = g; gN.appendChild(g);
        SJ.tip(g, '<b>' + (Array.isArray(n.t) ? n.t.join(' ') : n.t) + '</b><br>' + n.what.split('. ')[0].replace(/\.$/, '') + '.' + (n.room ? '<br>누르면 확대해서 들어간다' : ''));
        g.addEventListener('click', (ev) => { ev.stopPropagation(); if (n.room) SJ.enterRoom(n.room, g); else select(n); });
      });

      // 맨 위 띠: 길 따라가기
      const ban = SJ.node({ id: 'banner', x: 560, y: 18, w: 600, h: 58, title: '문장이 동작이 되는 길 따라가기', sub: '빨간 길을 처음부터 끝까지 한 번에 본다', kind: 'core', size: 20, subCls: 't-soft' });
      ban.addEventListener('click', (ev) => { ev.stopPropagation(); SJ.enterRoom('pipeline', ban); });
      SJ.tip(ban, '<b>길 따라가기</b><br>문장 하나가 단어, 토큰, 3D 동작으로 바뀌는 과정을 재생한다');
      gN.appendChild(ban);

      // 길 위를 달리는 점
      const dot = s('circle', { r: 8, fill: 'var(--core)', stroke: 'var(--card)', 'stroke-width': 2.5, class: 'only-live' });
      svg.appendChild(dot);
      const len = road.getTotalLength ? road.getTotalLength() : 0; let pos = 0;
      scope.loop((dt) => {
        if (!len) return;
        pos += dt * 230; const cyc = len * 2 + 240, p = pos % cyc;
        const at = p < len ? p : p < len + 120 ? len : p < len * 2 + 120 ? len * 2 + 120 - p : 0;
        const pt = road.getPointAtLength(at); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      });
      if (len) { const p0 = road.getPointAtLength(0); dot.setAttribute('cx', p0.x); dot.setAttribute('cy', p0.y); }

      function clearSel() {
        Object.values(els).forEach((g) => g.classList.remove('dim', 'sel'));
        edgeEls.forEach((e) => e.querySelectorAll('.edge, .edge-label').forEach((p) => p.classList.remove('dim')));
      }
      function applyFilter(k) {
        clearSel();
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === k ? 'true' : 'false'));
        if (k === 'all') return;
        NODES.forEach((n) => { if (n.k !== k) els[n.id].classList.add('dim'); });
        EDGES.forEach((e, i) => { const on = k === 'core' ? !!e.core : (byId[e.a].k === k || byId[e.b].k === k); if (!on) edgeEls[i].querySelectorAll('.edge, .edge-label').forEach((p) => p.classList.add('dim')); });
      }
      const byId = {}; NODES.forEach((n) => { byId[n.id] = n; });
      FILTERS.forEach((fl) => seg.appendChild(h('button', { type: 'button', 'data-k': fl[0], 'aria-pressed': fl[0] === 'all' ? 'true' : 'false', text: fl[1], onclick: () => { applyFilter(fl[0]); intro(); } })));

      function select(n) {
        applyFilter('all');
        const near = new Set([n.id].concat(ALSO[n.id] || []));
        EDGES.forEach((e, i) => {
          const on = e.a === n.id || e.b === n.id;
          if (on) { near.add(e.a); near.add(e.b); }
          edgeEls[i].querySelectorAll('.edge, .edge-label').forEach((p) => p.classList.toggle('dim', !on));
        });
        NODES.forEach((m) => els[m.id].classList.toggle('dim', !near.has(m.id)));
        els[n.id].classList.add('sel');
        note.textContent = ''; note.hidden = false;
        note.appendChild(h('button', { class: 'note-x', type: 'button', 'aria-label': '쪽지 닫기', text: '×', onclick: () => { applyFilter('all'); intro(); } }));
        const title = Array.isArray(n.t) ? n.t.join(' ') : n.t;
        note.appendChild(h('div', { class: 'chips' }, [h('span', { class: 'chip', text: n.sem || '' }), n.owner ? h('span', { class: 'chip' }, [h('i', { style: { background: 'var(--p-' + n.owner + ')' } }), window.SJD.people[n.owner].name]) : null]));
        note.appendChild(h('h3', { text: title, style: { marginTop: '8px' } }));
        note.appendChild(h('p', { text: n.what }));
        if (n.talks) { note.appendChild(h('h4', { text: '누구와 말하나' })); note.appendChild(h('p', { class: 'path', text: n.talks })); }
        if (n.files) { note.appendChild(h('h4', { text: '파일' })); note.appendChild(h('ul', {}, n.files.map((p) => h('li', { class: 'path', text: p })))); }
        if (n.go) note.appendChild(h('button', { class: 'btn', type: 'button', text: n.goLabel, style: { marginTop: '10px' }, onclick: () => SJ.go(n.go) }));
      }
      function intro() { note.hidden = true; }
      const P = window.SJD.people;
      strip.appendChild(h('div', {}, [
        h('h3', { text: '지도 읽는 법' }),
        h('ul', {}, [
          h('li', { text: '왼쪽부터 앱, 서버, AI 순서다. 누른 것이 오른쪽으로 건너가고 답이 왼쪽으로 돌아온다.' }),
          h('li', { text: '빨간 상자를 누르면 그 자리로 확대해 안쪽 그림을 본다.' }),
          h('li', { text: '다른 상자를 누르면 하는 일과 파일이 쪽지로 뜬다.' }),
        ]),
      ]));
      strip.appendChild(h('div', {}, [
        h('h3', { text: '상자 귀퉁이 색 점은 맡은 사람' }),
        h('div', { class: 'chips' }, Object.values(P).map((p) => h('span', { class: 'chip' }, [h('i', { style: { background: 'var(--p-' + p.key + ')' } }), p.name + ' · ' + p.role]))),
      ]));
      strip.appendChild(h('div', {}, [
        h('h3', { text: '이번 학기에 늘어난 것' }),
        h('div', { class: 'facts' }, [
          h('div', { class: 'fact core' }, [h('b', { text: '190' }), h('span', { text: '앱 · 서버에 새로 생긴 파일' })]),
          h('div', { class: 'fact' }, [h('b', { text: '27' }), h('span', { text: '고친 파일' })]),
        ]),
        h('p', { class: 'hand', text: 'AI 동네(ml/)와 뷰어는 통째로 새로 지었다' }),
      ]));
      svg.addEventListener('click', () => { applyFilter('all'); intro(); });
      intro();
    },
  });
})();
