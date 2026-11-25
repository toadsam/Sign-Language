/* 앱 화면 흐름 / 결과 / 일정표 / 1학기 → 2학기 */
(function () {
  'use strict';
  const SJ = window.SJ, s = SJ.s, h = SJ.h, text = SJ.text, D = window.SJD, P = D.people, C = SJ.chart.C;

  /* ───────────── 앱 화면 흐름 ───────────── */
  const PW = 124, PH = 168;
  const SCR = [
    { id: 'login', x: 30, y: 70, t: '로그인', c: 'var(--yellow-soft)', what: 'Google로 계속하기, 또는 로그인 없이 둘러보기.', api: 'POST /api/auth/login' },
    { id: 'signup', x: 30, y: 340, t: '가입', c: 'var(--yellow-soft)', what: '처음 온 사람만. 이름, 연락처, 소속을 받는다.', api: 'POST /api/auth/signup · /signup/complete' },
    { id: 'home', x: 235, y: 200, t: '마을', c: 'var(--yellow)', what: '오늘 목표와 연속 학습일. 배운 장소만 색이 칠해진다. 아래 탭 네 개의 출발점.', api: 'GET /api/users/{uid}' },
    { id: 'learn', x: 455, y: 40, t: '표현', c: 'var(--leaf)', what: '스케치북에서 퀴즈 묶음을 고른다. 기본, 일상, 오답 복습.', api: 'GET /api/users/{uid}' },
    { id: 'quiz', x: 665, y: 40, t: '퀴즈', c: 'var(--leaf)', what: '3D 친구(AI가 그린 손짓)나 영상을 보고 넷 중 하나. AI가 그 단어 하나로 빠짐없이 그릴 때만 친구가 나오고, 정답 영상으로 바꿔 볼 수 있다. 맞고 틀림이 사용자 문서에 쌓인다.', api: 'GET /api/quiz/session · POST /api/quiz/answer · POST /api/sign/generate' },
    { id: 'wrongnote', x: 875, y: 40, t: '오답노트', c: 'var(--blossom)', what: '저장한 오답을 모아 다시 푼다.', api: '/api/users/{uid}/wrong-note-saved' },
    { id: 'translator', x: 455, y: 240, t: '통역', c: 'var(--sky)', what: '문장을 넣으면 수어 어순으로 바꾸고, AI가 만든 동작을 3D 친구가 보여 준다. 카메라로 따라 하면 점수가 나온다. AI 서버가 꺼져 있으면 단어 영상을 차례로 재생한다.', api: 'POST /translate · POST /api/sign/generate' },
    { id: 'bookmark', x: 665, y: 240, t: '북마크', c: 'var(--sky)', what: '담아 둔 통역 문장. 로그인 전에는 기기에만 20개까지.', api: '/api/users/{uid}/translator-bookmarks' },
    { id: 'mypage', x: 455, y: 448, t: '기록', c: 'var(--blossom)', what: '푼 문제 수, 자주 틀린 단어, 도장 달력, 스티커.', api: 'GET /api/users/{uid} · /top-wrong-words' },
    { id: 'lab', x: 880, y: 448, t: 'AI 작업실', c: 'var(--core-wash)', core: 1, what: 'AI 화면 일곱 개의 입구. 탭에는 없고 주소(/sign-lab)로 들어간다.', api: '없음' },
    { id: 'generate', x: 1090, y: 300, t: '동작 만들기', c: 'var(--core-wash)', core: 1, what: '단어를 넣으면 실제 모델이 만든 3D 동작을 받아 재생한다.', api: 'POST /api/sign/generate' },
    { id: 'player', x: 1090, y: 510, t: '3D 재생기', c: 'var(--core-wash)', core: 1, what: '동작을 속도와 방향을 바꿔 가며 본다. 비교, 복원, 자모표 화면도 여기서 이어진다.', api: '없음 (파일을 읽는다)' },
  ];
  const cxy = (id) => { const p = SCR.find((q) => q.id === id); return [p.x + PW / 2, p.y + PH / 2]; };
  const LINKS = [
    ['login', 'home', '로그인', [154, 150], [235, 260]], ['login', 'signup', '처음이면', [92, 238], [92, 340], 1], ['signup', 'home', '', [154, 410], [235, 320]],
    ['home', 'learn', '표현 탭', [359, 240], [455, 130]], ['home', 'translator', '통역 탭', [359, 290], [455, 320]], ['home', 'mypage', '기록 탭', [359, 340], [455, 520]],
    ['learn', 'quiz', '고르면', [579, 110], [665, 110]], ['quiz', 'wrongnote', '틀리면 저장', [789, 110], [875, 110]], ['wrongnote', 'quiz', '다시 풀기', [875, 160], [789, 160], 0, 16],
    ['translator', 'bookmark', '담기', [579, 324], [665, 324]], ['mypage', 'wrongnote', '', [579, 500], [900, 208], 0, 0, 40], ['mypage', 'bookmark', '', [560, 448], [700, 408]],
    ['lab', 'generate', '', [1004, 500], [1090, 420]], ['lab', 'player', '', [1004, 560], [1090, 590]],
  ];
  const TRIPS = [
    { id: 'all', label: '전체' },
    { id: 'new', label: '처음 온 사람', path: ['login', 'signup', 'home', 'learn', 'quiz'], say: '가입하고, 마을에서 표현을 골라 첫 퀴즈를 푼다.' },
    { id: 'retry', label: '틀린 문제 다시', path: ['home', 'mypage', 'wrongnote', 'quiz'], say: '기록에서 오답노트로 가서 틀린 것만 다시 푼다.' },
    { id: 'talk', label: '문장 통역', path: ['home', 'translator', 'bookmark'], say: '문장을 수어 영상으로 보고, 쓸 문장을 담아 둔다.' },
    { id: 'ai', label: 'AI 동작 보기', path: ['lab', 'generate', 'player'], say: '단어를 넣어 모델이 만든 동작을 3D로 본다. 이번 학기에 생긴 길.' },
  ];
  SJ.view('flow', {
    build(root, scope) {
      root.appendChild(h('div', { class: 'view-head' }, [h('h1', { text: '앱에서 사람이 걷는 길' }), h('p', { text: '화면 열두 개와 그 사이의 길. 아래에서 여정을 고르면 그 길만 남고 점이 따라 걷는다.' })]));
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '여정 고르기' }), say = h('span', { class: 'hand', 'aria-live': 'polite' });
      root.appendChild(h('div', { class: 'ctrl' }, [seg, say]));
      const note = h('aside', { class: 'note' });
      const F = SJ.fig(1240, 720, { minw: 900, file: 'suji-app-flow', label: '앱 화면 흐름. 로그인에서 마을로, 마을에서 표현, 통역, 기록으로 갈라지고, AI 작업실은 따로 들어간다.', caption: '위쪽 띠 색은 탭 색이다(마을 노랑, 표현 초록, 통역 하늘, 기록 분홍). 붉은 세 장이 이번 학기에 생긴 AI 화면.' });
      root.appendChild(F.figure); root.appendChild(h('div', { style: { marginTop: '12px', maxWidth: '640px' } }, note));
      const svg = F.svg, els = {}, edges = [];
      LINKS.forEach((l) => { const el = SJ.arrow({ from: l[3], to: l[4], label: l[2] || null, lanchor: l[5] ? 'start' : 'middle', ldx: l[5] ? 8 : 0, ldy: l[6] || (l[5] ? 4 : -5), bend: l[7] || 0, core: l[0] === 'lab' }); svg.appendChild(el); edges.push({ el, a: l[0], b: l[1] }); });
      svg.appendChild(text(942, 644, '탭에는 없다. 주소로 들어간다', { size: 19, cls: 't-hand t-core' }));
      SCR.forEach((p, i) => {
        const g = s('g', { class: 'node' + (p.core ? ' core' : ''), tabindex: 0, role: 'button', 'aria-label': p.t });
        g.appendChild(s('rect', { x: p.x, y: p.y, width: PW, height: PH, rx: 16, class: 'paperfill' }));
        g.appendChild(s('path', { class: 'wash paint-in', d: SJ.blob(p.x + 4, p.y + 6, PW - 8, 52, SJ.hash(p.id), 2.5), fill: p.c, style: { '--d': (i * 0.05) + 's' } }));
        g.appendChild(s('rect', { x: p.x, y: p.y, width: PW, height: PH, rx: 16, class: 'ink' }));
        g.appendChild(s('rect', { x: p.x + PW / 2 - 14, y: p.y + 7, width: 28, height: 4, rx: 2, fill: 'var(--ink)' }));
        g.appendChild(text(p.x + PW / 2, p.y + 40, p.t, { size: 16, cls: 't-story' }));
        for (let k = 0; k < 3; k++) g.appendChild(s('rect', { x: p.x + 16, y: p.y + 74 + k * 20, width: PW - 32 - k * 16, height: 10, rx: 5, fill: 'var(--paper-deep)' }));
        if (p.id === 'home') ['var(--yellow)', 'var(--leaf)', 'var(--sky)', 'var(--blossom)'].forEach((c, k) => g.appendChild(s('circle', { cx: p.x + 22 + k * 27, cy: p.y + PH - 16, r: 7, fill: c, stroke: 'var(--ink)', 'stroke-width': 1.2 })));
        g.addEventListener('click', (ev) => { ev.stopPropagation(); pick(p); });
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p); } });
        svg.appendChild(g); els[p.id] = g;
      });
      const walker = s('circle', { r: 10, fill: 'var(--core)', stroke: 'var(--card)', 'stroke-width': 3, class: 'only-live', style: { display: 'none' } }); svg.appendChild(walker);
      let trip = TRIPS[0], tt = 0;
      function pick(p) {
        note.textContent = ''; note.appendChild(h('h3', { text: p.t })); note.appendChild(h('p', { text: p.what }));
        note.appendChild(h('h4', { text: '서버에 하는 말' })); note.appendChild(h('p', { class: 'path', text: p.api }));
      }
      function setTrip(t) {
        trip = t; tt = 0; say.textContent = t.say || '';
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === t.id ? 'true' : 'false'));
        const on = t.path ? new Set(t.path) : null;
        SCR.forEach((p) => els[p.id].classList.toggle('dim', !!on && !on.has(p.id)));
        edges.forEach((e) => { let ok = !on; if (on) for (let i = 0; i < t.path.length - 1; i++) if (t.path[i] === e.a && t.path[i + 1] === e.b) ok = true; e.el.querySelectorAll('.edge,.edge-label').forEach((x) => x.classList.toggle('dim', !ok)); });
        walker.style.display = t.path ? '' : 'none';
      }
      TRIPS.forEach((t) => seg.appendChild(h('button', { type: 'button', 'data-k': t.id, text: t.label, onclick: () => setTrip(t) })));
      scope.loop((dt) => {
        if (!trip.path) return; tt += dt * 0.7; const n = trip.path.length - 1, u = tt % (n + 0.8), i = Math.min(n - 1, Math.floor(u)), f = Math.min(1, u - i), e = f * f * (3 - 2 * f);
        const a = cxy(trip.path[i]), b = cxy(trip.path[i + 1]); walker.setAttribute('cx', a[0] + (b[0] - a[0]) * e); walker.setAttribute('cy', a[1] + (b[1] - a[1]) * e);
      });
      setTrip(TRIPS[0]); pick(SCR[2]);
    },
  });

  /* ───────────── 결과 ───────────── */
  SJ.view('results', {
    build(root) {
      root.appendChild(h('div', { class: 'view-head' }, [h('h1', { text: '숫자로 본 지금' }), h('p', { text: '① ~ ③은 처음 보는 사람 두 명(REAL03 · REAL12)의 동작으로 잰 것이고, ④는 켜져 있는 서버에 낱말과 문장을 넣어 잰 것이다. 막대에 올리면 설명이 뜬다.' })]));
      root.appendChild(h('div', { class: 'facts' }, [
        ['97.33%', '읽는 모델이 3,000단어 중 맞히는 비율', 1], ['28.2mm', '자모표로 되돌린 손의 평균 오차'], ['74.2%', '만든 동작이 제 단어로 읽히는 비율 (사람 동작 71.7%)', 1], ['0.090', '정답과의 손 모양 거리 (목표 0.082)'], ['0.40초', '3단어 만드는 시간, T4'], ['100%', '쓰이는 자모표 칸 (관문 기준 50%)'], ['1% → 93%', '문장 속 일상 낱말이 제 낱말로 읽히는 비율 (대표 동작 끼워 넣기, 11월 16일)', 1], ['61.4%', '문장 속 낱말 전체가 제 낱말로 읽히는 비율 (예전 26.5%)'],
      ].map((f) => h('div', { class: 'fact' + (f[2] ? ' core' : '') }, [h('b', { text: f[0] }), h('span', { text: f[1] })]))));

      const F1 = SJ.fig(1240, 360, { minw: 900, file: 'suji-result-vq', label: '자모표 실험별 복원 오차', caption: '자모표(재훈). 단어 기준 손 오차는 E1 28.1mm와 E5 28.2mm로 비슷하다. E5를 고른 이유는 오른쪽이다. 문장에서 손 오차가 37.3mm에서 28.1mm로 줄었다.' });
      root.appendChild(h('div', { class: 'block', style: { marginTop: '22px' } }, [h('h2', { text: '① 자모표: 동작을 토큰으로 적었다가 되돌리면 얼마나 어긋나나' }), F1.figure]));
      SJ.chart.columns(F1.svg, { x: 0, y: 10, w: 760, h: 330, max: 36, ticks: [0, 12, 24, 36], unit: 'mm', dec: 1, series: [{ name: '상체', color: C.blue }, { name: '손', color: C.ochre }, { name: '손가락(손목 기준)', color: C.green }],
        cats: D.vqRuns.map((r) => ({ label: r.id, sub: r.set, pick: r.pick, under: r.use + '% 사용' })), values: D.vqRuns.map((r) => [r.body, r.hand, r.finger]) });
      F1.svg.appendChild(text(800, 44, '문장 클립에서 손 오차 (mm)', { size: 15, cls: 't-story', anchor: 'start' }));
      SJ.chart.hbars(F1.svg, { x: 800, y: 80, w: 430, labelW: 150, max: 40, dec: 1, gap: 44, barH: 20, rows: [{ label: 'E4b (단어로만)', value: D.vqSen.e4b.sen, color: C.gray, note: '단어 클립만 배운 자모표' }, { label: 'E5 (단어+문장)', value: D.vqSen.e5.sen, color: C.ochre, pick: true, note: '문장 클립까지 같이 배운 자모표' }] });
      F1.svg.appendChild(text(800, 230, '−9.2mm', { size: 44, cls: 't-hand t-core', anchor: 'start' }));

      const F2 = SJ.fig(1240, 250, { minw: 900, file: 'suji-result-recog', label: '읽는 모델로 본 실제 동작과 복원 동작의 정확도', caption: '읽는 모델(승현). 실제 동작은 97.33%가 읽힌다. 자모표를 거친 동작은 77.98%다. 옅은 막대는 손과 뼈 방향을 더 챙긴 자모표 후보로, 평가만 했다.' });
      root.appendChild(h('div', { class: 'block' }, [h('h2', { text: '② 읽는 모델: 채점관이 믿을 만한가, 자모표는 얼마나 잃나' }), F2.figure]));
      SJ.chart.hbars(F2.svg, { x: 10, y: 34, w: 860, labelW: 210, max: 100, dec: 2, unit: '%', gap: 46, barH: 20, rows: D.backtrans.map((r, i) => ({ label: r.name, value: r.top1, color: i === 0 ? C.gray : C.ochre, dash: r.cand, pick: i === 1, note: r.note + ' · 5등 안 ' + r.top5 + '%' })) });
      F2.svg.appendChild(text(910, 80, '3,000단어', { size: 40, cls: 't-hand t-core', anchor: 'start' })); F2.svg.appendChild(text(910, 108, '평가 클립 5,907개 · 1등 정확도', { size: 13, cls: 't-soft', anchor: 'start' }));

      const F3 = SJ.fig(1240, 250, { minw: 900, file: 'suji-result-gen', label: '받아쓰기 모델의 정확도와 손 모양 거리', caption: '받아쓰기(지헌). 왼쪽은 높을수록, 오른쪽은 낮을수록 좋다. 회색은 사람이 한 실제 동작끼리 잰 값. 숫자 단어 326개는 생성과 실제 재생이 같은 수준(0.148 대 0.149)이고, 나머지 단어에서 차이가 난다.' });
      root.appendChild(h('div', { class: 'block' }, [h('h2', { text: '③ 받아쓰기: 만든 동작이 그 단어다운가' }), F3.figure]));
      F3.svg.appendChild(text(10, 24, '제 단어가 1등인 비율 (200단어)', { size: 14, cls: 't-story', anchor: 'start' }));
      SJ.chart.hbars(F3.svg, { x: 10, y: 50, w: 580, labelW: 210, max: 100, dec: 1, unit: '%', gap: 40, barH: 18, rows: D.genRank.map((r) => ({ label: r.name, value: r.top1, color: r.human ? C.gray : r.pick ? C.ochre : C.blue, pick: r.pick, note: '5등 안 ' + r.top5 + '%' })) });
      F3.svg.appendChild(text(650, 24, '정답과의 손 모양 거리 (2,999단어)', { size: 14, cls: 't-story', anchor: 'start' }));
      SJ.chart.hbars(F3.svg, { x: 650, y: 50, w: 580, labelW: 220, max: 0.11, dec: 3, gap: 40, barH: 18, ref: 0.082, refLabel: '목표 0.082', rows: D.genDist.map((r) => ({ label: r.name, value: r.hand, color: r.human ? C.gray : r.pick ? C.ochre : C.blue, pick: r.pick, note: '몸+손 전체 ' + r.all })) });

      const F4 = SJ.fig(1240, 330, { minw: 900, file: 'suji-result-stage', label: '단계별로 읽히는 비율과, 대표 동작을 끼워 넣기 전후', caption: '11월 16일(재훈). 왼쪽: 깎이는 곳은 자모표(97 → 78)보다 문장 모델이 낱말 데이터 낱말을 만드는 단계(86 → 1)다. 오른쪽: 그 낱말 자리에 대표 동작을 끼우니 93%가 읽힌다. 대표 동작은 사람 동작을 자모표로 다시 그린 것 가운데 하나라, 93%는 처음 보는 동작의 정확도가 아니다. 끼운 앞뒤가 눈에 자연스러운지는 아직 보지 않았다.' });
      root.appendChild(h('div', { class: 'block' }, [h('h2', { text: '④ 문장 모델: 어디서 깎이나, 어떻게 올렸나' }), F4.figure]));
      F4.svg.appendChild(text(10, 24, '단계마다 제 낱말이 1등인 비율', { size: 14, cls: 't-story', anchor: 'start' }));
      SJ.chart.hbars(F4.svg, { x: 10, y: 50, w: 560, labelW: 230, max: 100, dec: 1, unit: '%', gap: 46, barH: 20, rows: D.stage.map((r) => ({ label: r.name, value: r.top1, color: r.bad ? C.blue : r.ctrl ? C.gray : C.ochre, dash: r.ctrl, pick: r.bad, note: r.note + ' · 5등 안 ' + r.top5 + '%' })) });
      F4.svg.appendChild(text(20, 270, '86 → 1', { size: 44, cls: 't-hand t-core', anchor: 'start' })); F4.svg.appendChild(text(190, 264, '가장 크게 깎이는 곳', { size: 13, cls: 't-soft', anchor: 'start' }));
      F4.svg.appendChild(text(630, 24, '대표 동작을 끼워 넣기 전과 후 (문장 284개)', { size: 14, cls: 't-story', anchor: 'start' }));
      SJ.chart.hbars(F4.svg, { x: 630, y: 50, w: 600, labelW: 270, max: 100, dec: 1, unit: '%', gap: 46, barH: 20, rows: D.splice.map((r) => ({ label: r.name, value: r.v, color: r.pick ? C.ochre : r.same ? C.gray : C.blue, pick: r.pick, note: r.note })) });

      root.appendChild(h('div', { class: 'block' }, [h('h2', { text: '아직 숫자가 없는 것' }), h('ul', {}, ['네 조건 비교표: B1 · B2 · Ours-H · Ours-HF를 한 표로 잰 결과가 없다. B2는 정식 학습 전이다.', '사람 평가: 네 조건 비교 영상은 준비 중이고 결과가 없다.', '따라 하기 점수: 기준선이 임시값이다. 실제로 따라 한 기록으로 맞춰야 한다.', '끼운 자리의 자연스러움: 낱말 데이터 낱말에 대표 동작을 끼운 앞뒤가 눈에 어색하지 않은지 아직 사람이 보지 않았다.', '문장 데이터 낱말: 가다는 33번 중 30번 읽히지만 아프다 · 없다 · 오다는 한 번도 읽히지 않았다. 읽는 모델이 문장 속 짧은 동작에 약해(사람 동작도 45%) 더 나아졌는지를 지금 도구로는 볼 수 없다.', '아는 낱말: 3,140개이고 교통 · 길 찾기에 몰려 있다. 좋아하다 · 집 · 내일 · 언제 같은 낱말이 없다 (문장 323개 중 284개만 빠짐없이 그려졌다).'].map((t) => h('li', { text: t })))]));
    },
  });

  /* ───────────── 일정표 ───────────── */
  const day = (m, d) => (m === 9 ? d : m === 10 ? 30 + d : m === 11 ? 61 + d : 91 + d);
  const LANES = [
    { k: 'all', name: '함께', ev: [[9, 22, '방향 결정', 1, '영상 재생 대신 토큰으로 동작을 만드는 방식으로 정했다'], [9, 29, '계획 발표', 0, '계획서 일정'], [10, 3, '역할 나누기', 1, '모델마다 주인을 정했다'], [10, 11, '규칙 · 계약 초안', 1, 'CLAUDE.md와 docs/contracts.md'], [10, 27, '중간 발표', 1, ''], [11, 13, '모두 합치기', 1, '통합 브랜치 jjh-sum에 일곱 갈래를 합쳤다'], [11, 15, 'main · 배포', 1, 'jjh-sum을 main에 합치고 웹과 서버를 새로 배포했다'], [11, 21, '자모표 v2 마감', 0, '꼭 필요할 때만 (계획)', 'plan'], [12, 8, '최종 발표', 1, '계획서 일정', 'plan']] },
    { k: 'jaehun', name: '정재훈', ev: [[9, 15, '샘플 실측', 0, '샘플 20단어로 좌표와 떨림을 확인'], [10, 14, '8만 클립 정리', 1, '정식 데이터 변환과 품질 점검 v1'], [10, 15, 'E1 ~ E4b', 0, '자모표 실험 네 번'], [10, 16, 'E5 · 토큰', 1, '단어+문장 자모표와 토큰 v0.3'], [10, 18, '인수인계', 0, '사람별 전달 문서와 서버 안내'], [11, 4, '색칠 마을', 1, '앱 전체 디자인을 새로'], [11, 8, '3D 캐릭터 데모', 0, '통역 화면에 발표 영상의 3D 캐릭터를 데모로 넣어 봄'], [11, 7, 'v1 동결(예정)', 1, '예정일이었고 확정은 아직 팀 결정 전', 'open'], [11, 15, '친구 · 따라 하기', 1, '통역 화면에 AI 친구 연결, 55점 좌표, 따라 하기 채점, 읽는 모델 연결, 퀴즈 문제도 3D 친구로, 웹 입력 칸과 마을 건물 누르기 수정'], [11, 16, '단계별 표 · 끼워 넣기', 1, '어디서 정확도가 깎이는지 재고, 낱말 데이터 낱말 자리에 대표 동작을 끼워 1% → 93%. 브랜치 jjh-accuracy, main 전']] },
    { k: 'jiheon', name: '박지헌', ev: [[10, 25, '생성 API 통합', 1, 'Generator · FastAPI · Spring을 잇고 오류 약속을 정했다'], [10, 28, '3,000단어 재학습', 1, '조건을 강하게 주는 구조로 다시 학습'], [10, 29, '거리 채점', 0, '등수 대신 정답과의 거리로'], [11, 1, '후보 24개 · 속도', 1, '화자 12명 × 2개에서 대표 고르기, 8단어 2.0초 → 1.2초'], [11, 14, '문장 GPT · 번역기', 1, '글로스 표 v2, 번역기, 문장 GPT 학습과 서버 문장 모드']] },
    { k: 'seunghyun', name: '류승현', ev: [[10, 18, '100단어', 0, '읽는 모델 첫 확인'], [10, 22, '500단어', 0, ''], [10, 27, '3,000단어 97.3%', 1, '86,400회, 162분'], [11, 1, '역번역 · 후보 실험', 1, 'E5 복원 77.98%, 손 가중과 뼈 방향 후보'], [11, 5, 'main 반영', 0, '']] },
    { k: 'seunghyeok', name: '유승혁', ev: [[10, 27, '아이폰 확인', 0, '응답 파일 가져오기와 Safari 재생'], [10, 28, '생성 화면 계약', 1, '오류 안내와 다시 시도 버튼'], [11, 2, '단어 입력 화면', 0, ''], [11, 4, '실제 모델 첫 재생', 1, '"병원" 60프레임']] },
  ];
  SJ.view('plan', {
    build(root) {
      root.appendChild(h('div', { class: 'view-head' }, [h('h1', { text: '9월부터 12월까지' }), h('p', { text: '칠한 점은 저장소 기록으로 확인한 일, 빈 점은 앞으로의 계획이다. 점에 올리면 내용이 뜬다.' })]));
      const X0 = 170, X1 = 1240, D0 = day(9, 7), D1 = day(12, 8), xx = (m, d) => X0 + ((day(m, d) - D0) / (D1 - D0)) * (X1 - X0);
      const F = SJ.fig(1280, 690, { minw: 1000, file: 'suji-timeline', label: '2학기 일정표. 9월 방향 결정, 10월 데이터와 모델, 11월 통합, 12월 8일 최종 발표.', caption: '날짜는 커밋과 작업 기록에서 가져왔다. 계획 발표와 최종 발표 날짜는 계획서 기준이다.' });
      root.appendChild(F.figure); const svg = F.svg;
      [[9, 7, '9월'], [10, 1, '10월'], [11, 1, '11월'], [12, 1, '12월']].forEach((m) => { const x = xx(m[0], m[1]); svg.appendChild(s('line', { x1: x, x2: x, y1: 70, y2: 664, stroke: 'var(--line)', 'stroke-width': 1.2 })); svg.appendChild(text(x + 8, 62, m[2], { size: 24, cls: 't-hand t-soft', anchor: 'start' })); });
      const tx = xx(11, 16); svg.appendChild(s('path', { class: 'wash', d: SJ.blob(tx - 9, 74, 18, 590, 5, 2), fill: 'var(--core-pale)' })); svg.appendChild(text(tx, 34, '그린 날 11월 16일', { size: 20, cls: 't-hand t-core' }));
      svg.appendChild(s('path', { class: 'wash', d: SJ.blob(tx + 12, 86, X1 - tx + 10, 574, 6, 4), fill: 'var(--paper-deep)', opacity: 0.5 })); svg.appendChild(text((tx + X1) / 2 + 10, 652, '앞으로', { size: 22, cls: 't-hand t-faint' }));
      const leaders = s('g'); svg.appendChild(leaders);
      LANES.forEach((ln, li) => {
        const y = 140 + li * 112;
        svg.appendChild(s('path', { class: 'ink thin soft', d: SJ.wline(X0 - 10, y, X1 + 10, y, SJ.rng(li + 3), 1.2) }));
        if (ln.k !== 'all') svg.appendChild(s('circle', { cx: 24, cy: y - 5, r: 8, fill: 'var(--p-' + ln.k + ')', stroke: 'var(--ink)', 'stroke-width': 1.4 }));
        svg.appendChild(text(ln.k === 'all' ? 16 : 40, y, ln.name, { size: 17, cls: 't-story', anchor: 'start' }));
        const used = [[], [], [], []], ys = [y - 18, y + 30, y - 38, y + 50], place = {};
        ln.ev.map((e, i) => i).sort((a, b) => (ln.ev[b][3] - ln.ev[a][3]) || (a - b)).forEach((i) => {
          const e = ln.ev[i], w = e[2].length * 12.5 + 14, lx = Math.min(X1 - w / 2 + 30, Math.max(X0 + w / 2 - 20, xx(e[0], e[1])));
          for (let k = 0; k < 4; k++) if (used[k].every((u) => lx + w / 2 < u[0] || lx - w / 2 > u[1])) { used[k].push([lx - w / 2, lx + w / 2]); place[i] = [lx, ys[k], k]; break; }
        });
        ln.ev.forEach((e, i) => {
          const x = xx(e[0], e[1]), st = e[5], lab = e[2], w = lab.length * 12.5 + 10;
          const g = s('g', { tabindex: 0 });
          g.appendChild(s('circle', { cx: x, cy: y, r: e[3] ? 9 : 6, fill: st === 'plan' ? 'var(--card)' : st === 'open' ? 'var(--yellow-soft)' : ln.k === 'all' ? 'var(--ink)' : 'var(--p-' + ln.k + ')', stroke: 'var(--ink)', 'stroke-width': 1.8, 'stroke-dasharray': st ? '3 3' : null, class: 'paint-in', style: { '--d': (li * 0.1 + i * 0.05) + 's' } }));
          g.appendChild(s('circle', { cx: x, cy: y, r: 16, fill: 'transparent' }));
          const pl = place[i];
          if (pl) { if (pl[2] >= 2) leaders.appendChild(s('path', { class: 'ink thin soft', d: 'M' + x + ' ' + (pl[2] === 2 ? y - 11 : y + 11) + ' L' + pl[0] + ' ' + (pl[2] === 2 ? y - 34 : y + 37) })); g.appendChild(text(pl[0], pl[1], lab, { size: 13, cls: (st ? 't-soft ' : '') + 'val-label', weight: e[3] && !st ? 700 : null })); }
          SJ.tip(g, '<b>' + e[0] + '월 ' + e[1] + '일 · ' + lab + '</b>' + (e[4] ? '<br>' + e[4] : '') + (st === 'plan' ? '<br>계획' : st === 'open' ? '<br>아직 정해지지 않음' : ''));
          svg.appendChild(g);
        });
      });
      root.appendChild(h('div', { class: 'cols', style: { marginTop: '18px' } }, [
        h('div', { class: 'block' }, [h('h2', { text: '남은 일' }), h('div', { class: 'tb-scroll' }, h('table', { class: 'tb' }, [
          h('thead', {}, h('tr', {}, ['할 일', '누가', '왜 중요한가'].map((c) => h('th', { text: c })))),
          h('tbody', {}, [
            ['자모표 v1 확정', '넷이서', 'E5로 갈지 손 · 뼈 방향 후보로 갈지. 바뀌면 받아쓰기는 토큰 변환과 재학습을 다시 한다'],
            ['문장 모델이 낱말 데이터 낱말을 못 만든다', '박지헌 · 정재훈', '모델이 만들면 1%만 읽힌다. 지금은 대표 동작을 끼워 가린다. 다시 학습할지 정해야 한다'],
            ['끼워 넣기를 main과 배포에 반영', '정재훈 · 박지헌', '지금은 jjh-accuracy 브랜치에만 있다. 지헌 폴더(ml/gen)를 고친 것이라 지헌 확인이 먼저다'],
            ['따라 하기 점수 기준선', '정재훈', '임시값이다. 실제로 따라 한 기록으로 맞춰야 한다'],
            ['네 조건 비교 영상과 사람 평가', '류승현 · 유승혁', '숫자만으로는 자연스러움을 말할 수 없다'],
            ['최종 발표 (12월 8일)', '넷이서', '계획서 일정'],
          ].map((r) => h('tr', {}, r.map((c) => h('td', { text: c }))))),
        ]))]),
        h('aside', { class: 'note' }, [h('h3', { text: '1학기는 이랬다 (2 ~ 5월)' }), h('ul', {}, ['2월 1일 첫 커밋, 17일 Google 로그인', '2월 24일 영상 퀴즈', '3월 9일 Cloud Run 배포', '3월 말 통역과 북마크', '4월 29일 Firebase 영상 연결', '5월 28일 GitHub Pages 배포'].map((t) => h('li', { text: t }))), h('p', { class: 'hand', text: '9월 7일에 1학기 끝 상태를 따로 보관해 두고 시작했다' })]),
      ]));
    },
  });

  /* ───────────── 1학기 → 2학기 ───────────── */
  SJ.view('diff', {
    build(root, scope) {
      root.appendChild(h('div', { class: 'view-head' }, [h('h1', { text: '틀어 주던 앱에서 만들어 내는 앱으로' }), h('p', { text: '앞부분(문장 → 수어 어순)은 그대로 두고, 뒷부분을 통째로 바꿨다. 스위치를 눌러 두 학기를 오가 보자.' })]));
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '학기 고르기' });
      root.appendChild(h('div', { class: 'ctrl' }, seg));
      const F = SJ.fig(1280, 470, { minw: 1000, file: 'suji-semester-diff', label: '1학기와 2학기의 흐름 비교. 어순 변환까지는 같고, 그 뒤가 영상 재생에서 동작 생성으로 바뀌었다.', caption: '위가 1학기, 아래가 2학기 길이다. 어순 변환은 두 학기가 같이 쓴다. 1학기 길은 지금도 통역 화면에서 그대로 돈다.' });
      root.appendChild(F.figure); const svg = F.svg;
      const shared = s('g'), g1 = s('g'), g2 = s('g'); svg.appendChild(shared); svg.appendChild(g1); svg.appendChild(g2);
      shared.appendChild(SJ.node({ x: 20, y: 190, w: 150, h: 90, title: '문장', sub: ['"화장실 있어요?"'], kind: 'old', static: true, size: 18 }));
      shared.appendChild(SJ.arrow({ from: [172, 235], to: [208, 235] }));
      shared.appendChild(SJ.node({ x: 212, y: 180, w: 200, h: 110, title: '어순 변환', sub: ['규칙 · ETRI · OpenAI', '→ [화장실, 있다] + 의문'], kind: 'old', static: true, size: 18 }));
      shared.appendChild(text(312, 318, '두 학기가 같이 쓴다', { size: 20, cls: 't-hand t-soft' }));
      // 1학기
      g1.appendChild(SJ.arrow({ from: [414, 215], to: [500, 110], bend: -10 }));
      [['수어 사전', ['120단어 JSON'], 504], ['영상 찾기', ['Storage에 있는 것만'], 730], ['영상 재생', ['단어 영상을 차례로'], 956]].forEach((n, i) => { g1.appendChild(SJ.node({ x: n[2], y: 60, w: 190, h: 90, title: n[0], sub: n[1], kind: 'old', static: true, size: 17 })); if (i < 2) g1.appendChild(SJ.arrow({ from: [n[2] + 192, 105], to: [n[2] + 224, 105] })); });
      g1.appendChild(text(1160, 96, '1학기', { size: 34, cls: 't-hand', anchor: 'start' })); g1.appendChild(text(1160, 122, '저장한 것을 튼다', { size: 13, cls: 't-soft', anchor: 'start' }));
      // 2학기
      g2.appendChild(SJ.arrow({ from: [414, 255], to: [470, 360], bend: 10, core: true }));
      [['단어표', ['3,000단어 · 뜻 바꾸기'], 474, 150], ['받아쓰기', ['단어 → 토큰'], 646, 140], ['자모표', ['토큰 → 3D 좌표'], 808, 150], ['3D 동작', ['뼈대로 그린다'], 980, 150]].forEach((n, i) => { g2.appendChild(SJ.node({ x: n[2], y: 320, w: n[3], h: 90, title: n[0], sub: n[1], kind: 'core', static: true, size: 17, delay: i * 0.1 })); if (i < 3) g2.appendChild(SJ.arrow({ from: [n[2] + n[3] + 2, 365], to: [n[2] + n[3] + 20, 365], core: true })); });
      g2.appendChild(text(1160, 356, '2학기', { size: 34, cls: 't-hand t-core', anchor: 'start' })); g2.appendChild(text(1160, 382, '그 자리에서 만든다', { size: 13, cls: 't-soft', anchor: 'start' }));
      const fg = SJ.pose.figure({ scale: 28, x: 1055, y: 262, weight: 0.6 }); g2.appendChild(fg.g); fg.set(SJ.pose.clipFrame('a', 24));
      let fr = 0; scope.loop((dt) => { fr = (fr + dt * 30 * 0.6) % 60; fg.set(SJ.pose.clipFrame('a', fr)); });
      function mode(m) { g1.style.opacity = m === '2' ? 0.16 : 1; g2.style.opacity = m === '1' ? 0.16 : 1; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === m ? 'true' : 'false')); }
      [['b', '둘 다'], ['1', '1학기 길'], ['2', '2학기 길']].forEach((o) => seg.appendChild(h('button', { type: 'button', 'data-k': o[0], text: o[1], onclick: () => mode(o[0]) })));
      [g1, g2].forEach((g) => { g.style.transition = 'opacity .4s'; }); mode('b');

      root.appendChild(h('div', { class: 'block', style: { marginTop: '20px' } }, [h('h2', { text: '무엇이 달라졌나' }), h('div', { class: 'tb-scroll' }, h('table', { class: 'tb' }, [
        h('thead', {}, h('tr', {}, ['', '1학기 (2 ~ 5월)', '2학기 (9월 ~)'].map((c) => h('th', { text: c })))),
        h('tbody', {}, [
          ['보여 주는 것', '저장해 둔 단어 영상', '모델이 만든 3D 관절 좌표'],
          ['다룰 수 있는 단어', '사전 120단어, 그중 영상이 있는 17단어', '학습한 3,000단어'],
          ['데이터', '직접 모은 영상 파일', 'AI Hub 키포인트 8만 클립 (단어 3,000 · 문장 2,000 · 16명)'],
          ['모르는 단어', '사전에서 비슷한 단어를 찾거나 건너뜀', '뜻이 같은 아는 단어로 바꾸고, 안 되면 빠진 단어를 알려 줌'],
          ['맞는지 확인', '눈으로', '읽는 모델로 자동 채점 + 정답과의 거리'],
          ['코드', 'backend · frontendcodes', '+ ml/ 전체, viewer/, 앱 · 서버에 새 파일 190개'],
          ['앱 모습', '기본 디자인', '색칠 마을, 이름은 수어링고'],
          ['팀', '정재훈 · 류태원 · 박지헌 · 박가원', '정재훈 · 박지헌 · 류승현 · 유승혁'],
        ].map((r) => h('tr', {}, r.map((c, i) => h('td', { text: c, style: i === 0 ? { fontWeight: 700, whiteSpace: 'nowrap' } : i === 2 ? { color: 'var(--core-deep)' } : null })))))
      ])), h('p', { class: 'hand', text: '할 수 없는 것도 분명하다. 학습 데이터에 없는 단어의 동작은 만들지 못한다.', style: { marginTop: '8px' } })]));
    },
  });
})();
