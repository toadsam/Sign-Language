/* 빨간 방 1 · 2: 문장이 동작이 되는 길 / 데이터 정리와 동작 데이터 */
(function () {
  'use strict';
  const SJ = window.SJ, s = SJ.s, h = SJ.h, text = SJ.text, D = window.SJD, P = D.people;
  const tw = (str, size) => { let w = 0; for (const ch of String(str)) w += /[ㄱ-힝]/.test(ch) ? 1 : ch === ' ' ? 0.32 : 0.58; return w * size; };
  function chip(g, x, y, label, o) {
    o = o || {}; const size = o.size || 13, w = tw(label, size) + 16, hh = size + 11;
    const c = s('g', { class: 'chipg' });
    if (o.fill) c.appendChild(s('path', { class: 'wash', d: SJ.blob(x - 1, y - 1, w + 2, hh + 2, SJ.hash(label) + x, 1.6), fill: o.fill }));
    else c.appendChild(s('rect', { x, y, width: w, height: hh, rx: 5, class: 'paperfill' }));
    c.appendChild(s('path', { class: 'ink thin' + (o.dash ? ' dash soft' : ''), d: SJ.roughRect(x, y, w, hh, SJ.hash(label) + 3, 0.9) }));
    c.appendChild(text(x + w / 2, y + hh - 7, label, { size, cls: o.cls || null }));
    g.appendChild(c); return w;
  }
  SJ.util = { tw, chip };

  /* ───────────── 방: 문장이 동작이 되는 길 ───────────── */
  const ST = [
    { id: 'in', t: '문장', sub: ['사용자가 친 글'], k: 'old' },
    { id: 'order', t: '어순 변환', sub: ['규칙 · ETRI · OpenAI', '1학기부터 쓰던 부품'], k: 'old' },
    { id: 'vocab', t: '단어표 맞추기', sub: ['모델이 아는 3,000단어', '뜻 같은 단어로 바꾸기'], k: 'core', owner: 'jiheon', room: 'serve' },
    { id: 'gen', t: '받아쓰기', sub: ['단어 GPT', '단어 → 토큰 열'], k: 'core', owner: 'jiheon', room: 'gen' },
    { id: 'vq', t: '자모표 디코더', sub: ['VQ-VAE (E5)', '토큰 → 3D 좌표'], k: 'core', owner: 'jaehun', room: 'vq' },
    { id: 'serve', t: '추론 서버 · 검사', sub: ['FastAPI → Spring', '크기와 숫자 검사'], k: 'core', owner: 'jiheon', room: 'serve' },
    { id: 'app', t: '앱 화면', sub: ['3D 뼈대 재생'], k: 'core', owner: 'seunghyeok', room: 'screens' },
  ];
  const CAP = [
    '문장이 들어온다.',
    '조사와 어미를 떼고 수어 어순의 단어 열로 바꾼다. 물음표는 "의문" 표시가 된다.',
    '모델이 배운 3,000단어 표에 있는지 본다. 없으면 뜻이 같은 단어로 바꾸고, 그래도 없으면 모르는 단어로 남긴다.',
    '단어마다 토큰을 한 개씩 써 내려간다. 후보를 24개 만들고 가장 가운데 것을 고른다.',
    '토큰 하나가 4프레임짜리 동작 조각이다. 디코더가 토큰 열을 3D 좌표로 되돌린다.',
    '추론 서버가 좌표를 글자로 싸서 보내고, Spring이 프레임 수와 바이트 수가 맞는지 검사한다.',
    '앱이 좌표를 풀어 1초에 30장씩 뼈대로 재생한다.',
  ];
  const EX = [
    { label: '화장실 있어요?', src: '서버 설명서의 예시 문장', text: '화장실 있어요?', gloss: ['화장실', '있다'], tag: '의문', known: [true, true], clips: ['a', 'b'] },
    { label: '병원', src: '11월 4일 실제 모델로 확인한 입력', text: '병원', gloss: ['병원'], tag: null, known: [true], clips: ['a'] },
    { label: '미등록시험단어', src: '모르는 단어를 넣었을 때 (11월 4일 확인)', text: '미등록시험단어', gloss: ['미등록시험단어'], tag: null, known: [false], clips: [] },
  ];

  SJ.room('pipeline', {
    short: '길', title: '문장이 동작이 되는 길', kicker: '빨간 길을 처음부터 끝까지',
    lead: '저장해 둔 영상을 트는 대신, 문장을 단어로, 단어를 토큰으로, 토큰을 3D 좌표로 바꿔 화면에 그린다. 예시를 고르고 재생해 보자.',
    owners: [P.jaehun, P.jiheon, P.seunghyun, P.seunghyeok],
    build(body, scope) {
      const W = 1320, H = 640, SW = 164, GAP = 26, X0 = 10, SY = 64, SH = 92, TY = 190, TH = 214;
      const sx = (i) => X0 + i * (SW + GAP), cx = (i) => sx(i) + SW / 2;
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '예시 고르기' });
      const playBtn = h('button', { class: 'btn red', type: 'button', text: '▶ 재생' });
      const range = h('input', { type: 'range', id: 'pipe-step', min: 0, max: 6, step: 1, value: 6, 'aria-label': '단계' });
      const cap = h('p', { class: 'hand', 'aria-live': 'polite', style: { margin: '2px 0 6px', minHeight: '1.3em' } });
      const src = h('span', { class: 'save-note' });
      body.appendChild(h('div', { class: 'block' }, [h('div', { class: 'ctrl' }, [seg, playBtn, h('label', { for: 'pipe-step', class: 't-soft', text: '단계' }), range, src]), cap]));
      const F = SJ.fig(W, H, { minw: 1100, file: 'suji-pipeline', label: '문장이 어순 변환, 단어표, 받아쓰기, 자모표 디코더, 추론 서버를 거쳐 앱의 3D 동작이 되는 흐름', caption: '위 줄이 2학기의 새 길이다. 아래 왼쪽 연필선은 1학기의 영상 재생 길, 아래 오른쪽은 만든 동작을 다시 읽어 채점하는 고리. 뼈대는 모양만 흉내 낸 가짜 동작이다.' });
      body.lastChild.appendChild(F.figure);
      const svg = F.svg;

      // 역 사이 선과 달리는 점
      const rail = s('path', { d: 'M' + cx(0) + ' ' + (SY + SH / 2) + ' H' + cx(6), fill: 'none', stroke: 'var(--core-wash)', 'stroke-width': 18, opacity: 0.25, 'stroke-linecap': 'round' });
      svg.appendChild(rail);
      const stEls = ST.map((st, i) => {
        if (i < 6) svg.appendChild(SJ.arrow({ from: [sx(i) + SW + 2, SY + SH / 2], to: [sx(i + 1) - 3, SY + SH / 2], core: i >= 1 }));
        const g = SJ.node({ id: 'p-' + st.id, x: sx(i), y: SY, w: SW, h: SH, title: st.t, sub: st.sub, kind: st.k, owner: st.owner, size: 17, subSize: 11.5 });
        if (st.room) { g.addEventListener('click', () => SJ.enterRoom(st.room, null)); SJ.tip(g, '<b>' + st.t + '</b><br>누르면 이 부품의 방으로 간다'); }
        svg.appendChild(g); svg.appendChild(text(cx(i), SY - 12, String(i + 1), { size: 22, cls: 't-hand t-soft' }));
        return g;
      });
      const dot = s('circle', { r: 9, cy: SY + SH / 2, cx: cx(0), fill: 'var(--core)', stroke: 'var(--card)', 'stroke-width': 3, class: 'only-live' });
      svg.appendChild(dot);
      // 나온 것 칸
      const trays = ST.map((st, i) => {
        const g = s('g', { class: 'tray' });
        g.appendChild(s('path', { class: 'ink thin soft dash', d: SJ.roughRect(sx(i) + 4, TY, SW - 8, TH, 700 + i, 1) }));
        g.appendChild(s('path', { class: 'ink thin soft', d: 'M' + cx(i) + ' ' + (SY + SH + 3) + ' V' + (TY - 3) }));
        const inner = s('g'); g.appendChild(inner); svg.appendChild(g); g._inner = inner; return g;
      });
      // 아래 왼쪽: 1학기 길
      const LY = 470;
      svg.appendChild(SJ.arrow({ from: [cx(1), TY + TH + 4], to: [cx(1), LY - 4], dash: true }));
      const oldA = SJ.node({ x: sx(1) - 8, y: LY, w: SW + 16, h: 70, title: '수어 사전', sub: ['120단어 중에 있으면'], kind: 'old', static: true, size: 16 });
      const oldB = SJ.node({ x: sx(2) + 6, y: LY, w: SW + 16, h: 70, title: '저장된 영상 재생', sub: ['단어 영상을 차례로'], kind: 'old', static: true, size: 16 });
      svg.appendChild(oldA); svg.appendChild(oldB);
      svg.appendChild(SJ.arrow({ from: [sx(1) + SW + 10, LY + 35], to: [sx(2) + 4, LY + 35], dash: true }));
      svg.appendChild(text(sx(1) - 6, LY + 98, '1학기 길: 사전에 있는 단어만, 영상이 있는 만큼만 보여 줄 수 있었다', { size: 21, cls: 't-hand t-soft', anchor: 'start' }));
      // 아래 오른쪽: 채점 고리
      svg.appendChild(SJ.arrow({ from: [cx(4), TY + TH + 4], to: [cx(4), LY - 4], core: true, label: '만든 동작', lanchor: 'start', ldx: 8, ldy: 4 }));
      const rec = SJ.node({ id: 'p-recog', x: sx(4) - 8, y: LY, w: SW + 16, h: 70, title: '읽는 모델', sub: ['동작 → 단어 (3,000 중)'], kind: 'core', owner: 'seunghyun', size: 16 });
      rec.addEventListener('click', () => SJ.enterRoom('recog', null)); svg.appendChild(rec);
      svg.appendChild(SJ.arrow({ from: [sx(4) + SW + 10, LY + 35], to: [sx(5) + 30, LY + 35], core: true }));
      const verdict = s('g'); svg.appendChild(verdict);
      svg.appendChild(text(sx(4) - 6, LY + 98, '채점 고리: 다시 읽은 단어가 원래 단어와 같으면 맞음', { size: 21, cls: 't-hand t-core', anchor: 'start' }));

      // 예시별 내용 채우기
      let ex = EX[0], seq = null, figApp = null, figMini = [], stage = 6, playing = false, timer = 0, frame = 0;
      function fill() {
        trays.forEach((t) => { t._inner.textContent = ''; }); verdict.textContent = '';
        const anyKnown = ex.known.some(Boolean);
        seq = ex.clips.length ? SJ.pose.sequence(ex.clips) : null;
        const frames = seq ? seq.frames : 0, tokens = frames / 4;
        // 0 문장
        trays[0]._inner.appendChild(text(cx(0), TY + 96, ex.text, { size: tw(ex.text, 21) > SW - 16 ? 15 : 21, cls: 't-story' }));
        trays[0]._inner.appendChild(text(cx(0), TY + 124, '글자 ' + ex.text.length + '개', { size: 11.5, cls: 't-faint' }));
        // 1 단어 열
        let y = TY + 46;
        trays[1]._inner.appendChild(text(cx(1), TY + 24, '단어 열 (gloss)', { size: 11.5, cls: 't-faint' }));
        ex.gloss.forEach((w) => { const cw = tw(w, 13) + 16; chip(trays[1]._inner, cx(1) - cw / 2, y, w, { size: tw(w, 13) > 120 ? 11 : 13 }); y += 32; });
        if (ex.tag) chip(trays[1]._inner, cx(1) - 34, y + 6, '+ ' + ex.tag, { fill: 'var(--yellow-soft)' });
        // 2 단어표
        y = TY + 46;
        trays[2]._inner.appendChild(text(cx(2), TY + 24, '단어표에 있나', { size: 11.5, cls: 't-faint' }));
        ex.gloss.forEach((w, i) => {
          const lab = (ex.known[i] ? '있음  ' : '없음  ') + w, sz = tw(lab, 13) > 130 ? 10.5 : 13, cw = tw(lab, sz) + 16;
          chip(trays[2]._inner, cx(2) - cw / 2, y, lab, { size: sz, fill: ex.known[i] ? 'var(--core-pale)' : null, dash: !ex.known[i] }); y += 32;
        });
        if (!anyKnown) trays[2]._inner.appendChild(text(cx(2), y + 18, '모르는 단어로 남는다', { size: 12, cls: 't-soft' }));
        // 3 토큰
        trays[3]._inner.appendChild(text(cx(3), TY + 24, tokens ? '토큰 ' + tokens + '개 (번호는 예시)' : '토큰 없음', { size: 11.5, cls: 't-faint' }));
        const r = SJ.rng(SJ.hash(ex.label));
        for (let i = 0; i < Math.min(tokens, 30); i++) {
          const col = i % 5, row = Math.floor(i / 5), x = sx(3) + 14 + col * 28, yy = TY + 36 + row * 26;
          trays[3]._inner.appendChild(s('rect', { x, y: yy, width: 25, height: 21, rx: 4, fill: 'var(--core-pale)', stroke: 'var(--core-deep)', 'stroke-width': 1, class: 'paint-in', style: { '--d': (i * 0.03) + 's' } }));
          trays[3]._inner.appendChild(text(x + 12.5, yy + 15, String(Math.floor(r() * 512)), { size: 9.5, cls: 't-mono' }));
        }
        if (tokens > 30) trays[3]._inner.appendChild(text(cx(3), TY + TH - 10, '… 그리고 ' + (tokens - 30) + '개 더', { size: 11.5, cls: 't-soft' }));
        if (!tokens) trays[3]._inner.appendChild(text(cx(3), TY + 100, '쓸 것이 없다', { size: 13, cls: 't-soft' }));
        // 4 좌표
        figMini = [];
        trays[4]._inner.appendChild(text(cx(4), TY + 24, tokens ? '[' + frames + ', 125, 3]' : '[0, 125, 3]', { size: 12, cls: 't-mono t-soft' }));
        if (tokens) trays[4]._inner.appendChild(text(cx(4), TY + 40, '토큰 ' + tokens + '개 × 4프레임', { size: 11, cls: 't-faint' }));
        if (seq) [0.22, 0.5, 0.78].forEach((u, i) => {
          const fg = SJ.pose.figure({ scale: 27, x: sx(4) + 30 + i * 52, y: TY + 96, weight: 0.6 });
          fg.set(seq.at(u * frames)); trays[4]._inner.appendChild(fg.g); figMini.push(fg);
        });
        trays[4]._inner.appendChild(text(cx(4), TY + TH - 34, seq ? '프레임마다 125점의' : '빈 동작', { size: 12, cls: 't-soft' }));
        if (seq) trays[4]._inner.appendChild(text(cx(4), TY + TH - 18, 'x · y · z', { size: 12, cls: 't-soft' }));
        // 5 응답
        const js = ['fps: 30', 'joints: 125', 'frames: ' + frames, 'units: "shoulder"', 'data: ' + (frames ? '"AAAA…" (' + (frames * 125 * 3 * 4).toLocaleString() + 'B)' : '""'), 'unknown: [' + ex.gloss.filter((w, i) => !ex.known[i]).length + '개]', 'source: "model"'];
        trays[5]._inner.appendChild(text(cx(5), TY + 24, '응답 JSON (계약 ⑤)', { size: 11.5, cls: 't-faint' }));
        js.forEach((l, i) => trays[5]._inner.appendChild(text(sx(5) + 14, TY + 50 + i * 20, l, { size: 10.8, cls: 't-mono', anchor: 'start' })));
        trays[5]._inner.appendChild(text(cx(5), TY + TH - 10, '검사: ' + frames + ' × 125 × 3 × 4 바이트', { size: 10.5, cls: 't-soft' }));
        // 6 앱
        const px = sx(6) + 22, py = TY + 10, pw = SW - 44, ph = TH - 20;
        trays[6]._inner.appendChild(s('rect', { x: px, y: py, width: pw, height: ph, rx: 16, fill: 'var(--card)', stroke: 'var(--ink)', 'stroke-width': 2 }));
        trays[6]._inner.appendChild(s('rect', { x: px + pw / 2 - 16, y: py + 6, width: 32, height: 5, rx: 2.5, fill: 'var(--ink)' }));
        if (seq) {
          figApp = SJ.pose.figure({ scale: 46, x: cx(6), y: py + 78, weight: 0.8 });
          figApp.set(seq.at(frames * 0.3)); trays[6]._inner.appendChild(figApp.g);
        } else {
          figApp = null;
          trays[6]._inner.appendChild(text(cx(6), py + 90, '그릴 수 있는', { size: 13, cls: 't-story' }));
          trays[6]._inner.appendChild(text(cx(6), py + 110, '동작이 없어요', { size: 13, cls: 't-story' }));
          trays[6]._inner.appendChild(text(cx(6), py + 136, '안내만 보여 준다', { size: 11, cls: 't-soft' }));
        }
        // 채점 결과
        if (anyKnown) { chip(verdict, sx(5) + 36, LY + 20, '"' + ex.gloss.filter((w, i) => ex.known[i]).slice(-1)[0] + '"로 읽힘', { fill: 'var(--core-pale)', size: 14 }); verdict.appendChild(text(sx(5) + 44, LY + 66, '같으면 맞음 ✓', { size: 20, cls: 't-hand t-core', anchor: 'start' })); }
        else verdict.appendChild(text(sx(5) + 40, LY + 40, '채점할 동작이 없다', { size: 14, cls: 't-soft', anchor: 'start' }));
        src.textContent = ex.src;
        seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', EX[i] === ex ? 'true' : 'false'));
        show();
      }
      function show() {
        trays.forEach((t, i) => { t.style.opacity = i <= stage ? 1 : 0.12; });
        stEls.forEach((g, i) => g.classList.toggle('sel', i === stage));
        cap.textContent = (stage + 1) + '. ' + CAP[stage];
        range.value = stage; dot.setAttribute('cx', cx(stage));
      }
      EX.forEach((e) => seg.appendChild(h('button', { type: 'button', text: e.label, onclick: () => { ex = e; frame = 0; fill(); } })));
      range.addEventListener('input', () => { stage = +range.value; playing = false; playBtn.textContent = '▶ 재생'; show(); });
      playBtn.addEventListener('click', () => {
        playing = !playing; playBtn.textContent = playing ? '❚❚ 멈춤' : '▶ 재생';
        if (playing) { stage = 0; timer = 0; show(); }
      });
      scope.loop((dt) => {
        if (seq) { frame = (frame + dt * 30) % seq.frames; if (figApp && stage >= 6) figApp.set(seq.at(frame)); }
        if (playing) {
          timer += dt;
          const target = cx(Math.min(6, stage + (timer > 1.1 ? 1 : 0)));
          dot.setAttribute('cx', +dot.getAttribute('cx') + (target - +dot.getAttribute('cx')) * Math.min(1, dt * 7));
          if (timer > 1.7) { timer = 0; if (stage < 6) { stage++; show(); } else { playing = false; playBtn.textContent = '▶ 처음부터'; } }
        }
      });
      document.addEventListener('sj-mode', () => { if (SJ.isReport()) { stage = 6; playing = false; show(); } });
      fill();

      body.appendChild(h('div', { class: 'block' }, [
        h('h2', { text: '지금 어디까지 이어졌나' }),
        h('div', { class: 'tb-scroll' }, h('table', { class: 'tb' }, [
          h('thead', {}, h('tr', {}, [h('th', { text: '구간' }), h('th', { text: '상태' }), h('th', { text: '근거' })])),
          h('tbody', {}, [
            ['단어 하나 → 동작 → 앱 재생', '이어짐', '11월 4일 "병원" 60프레임을 실제 모델로 받아 재생 (승혁 기록)'],
            ['모르는 단어', '이어짐', '0프레임과 안내를 돌려주고, 다시 아는 단어를 넣으면 정상으로 돌아옴'],
            ['여러 단어 문장', '이어짐', '11월 14일 문장 GPT 학습, 11월 15일 실제 모델로 확인. 단어 사이 연결 동작까지 모델이 만든다'],
            ['통역 화면에서 바로 쓰기', '이어짐', '11월 15일 배포 주소에서 "배가 아파요" → 3D 친구를 확인. AI 서버(VM)가 켜져 있을 때 나온다'],
            ['문장 속 일상 낱말 (친구 · 엄마 · 커피)', '끼워 넣기 · 시연에서 켬', '11월 16일 문장 모델이 만들면 1%만 제 낱말로 읽혀, 대표 동작을 끼워 93%로 올렸다. 11월 25일 main에 합쳤다. 시연에서는 켜고 "일부 낱말은 저장된 동작"이라고 밝힌다. 평가 숫자는 끼워 넣기 없이 잰다'],
            ['퀴즈 문제를 3D 친구로', '이어짐', '11월 15일. AI가 그 단어 하나로 빠짐없이 그릴 때만(20개 중 16개) 친구가 나오고, 정답 영상으로 바꿔 볼 수 있다'],
            ['아는 낱말', '3,140개', '문장 데이터에서 온 단위 449 + 낱말 데이터에서 온 단위 3,000. 교통 · 길 찾기에 몰려 있어 좋아하다 · 집 · 내일이 없다. 문장 323개를 넣어 284개가 빠짐없이 그려졌다'],
            ['카메라로 따라 하기 → 점수', '이어짐 · 기준 보정', '상체 + 손 55점 좌표를 친구 동작과 DTW로 견주어 0~100점. 11월 17일 승혁이 웹캠 기록 20개로 손 자리 9 : 손 모양 1로 맞춰 65점 기준 오판 0건'],
            ['표정 (의문 등)', '아직', '자모표 E5의 얼굴은 평균 얼굴. "의문" 표시는 전달만 되고 동작에는 반영되지 않는다'],
          ].map((r) => h('tr', {}, r.map((c, i) => h('td', { text: c, style: i === 1 ? { whiteSpace: 'nowrap', fontWeight: 700 } : null })))))
        ])),
      ]));
    },
  });

  /* ───────────── 방: 데이터 정리 · 동작 데이터 ───────────── */
  SJ.room('prep', {
    short: '데이터', title: '데이터 정리와 동작 데이터', kicker: 'ml/prep · ml/common',
    lead: 'AI Hub 수어 영상의 키포인트를 모델이 먹을 수 있는 모양으로 바꾼다. 한 프레임은 관절 125점, 한 클립은 [T, 125, 3] 배열이다.',
    owners: [P.jaehun],
    build(body, scope) {
      body.appendChild(h('div', { class: 'facts' }, [
        ['80,000', '클립 (단어 48,000 + 문장 32,000)', 1], ['3,000', '단어'], ['2,000', '문장'], ['16', '수행자'], ['30', '1초에 프레임'], ['125', '한 프레임의 관절 점'],
      ].map((f) => h('div', { class: 'fact' + (f[2] ? ' core' : '') }, [h('b', { text: f[0] }), h('span', { text: f[1] })]))));

      /* 그림 1: 125점과 토큰 */
      const W = 1240, H = 520;
      const partBtns = h('div', { class: 'ctrl' });
      const dimNote = h('span', { class: 'mono' });
      const b1 = h('div', { class: 'block' }, [h('h2', { text: '한 프레임 = 125점, 토큰 한 개 = 4프레임' }), h('p', { text: '부위를 켜고 끄면 차원 수가 어떻게 바뀌는지 보인다. 오른쪽 띠에서 토큰을 누르면 그 4프레임만 되풀이한다.' }), partBtns]);
      body.appendChild(b1);
      const F = SJ.fig(W, H, { minw: 900, file: 'suji-motion-data', label: '관절 125점 뼈대와 프레임, 토큰의 관계', caption: '뼈대는 수식으로 만든 가짜 동작이다. 관절 번호와 연결선만 실제 정의(ml/common/skeleton.py)를 따른다.' });
      b1.appendChild(F.figure); const svg = F.svg;
      const FX = 250, FY = 215, SC = 150;
      svg.appendChild(s('path', { class: 'wash', d: SJ.blob(40, 30, 420, 450, 11, 8), fill: 'var(--paper-deep)', opacity: 0.6 }));
      // 좌표축
      svg.appendChild(SJ.arrow({ from: [FX, FY], to: [FX + 92, FY], dash: true, label: 'x 오른쪽', at: 1, lanchor: 'start', ldx: 6, ldy: 4 }));
      svg.appendChild(SJ.arrow({ from: [FX, FY], to: [FX, FY + 246], dash: true, label: 'y 아래', at: 1, ldy: 16 }));
      svg.appendChild(text(FX + 8, FY - 10, '원점 = 목', { size: 12, cls: 't-soft', anchor: 'start' }));
      svg.appendChild(s('path', { class: 'ink thin soft', d: 'M' + (FX - 75) + ' ' + (FY - 26) + ' v-8 h150 v8' }));
      svg.appendChild(text(FX, FY - 40, '어깨너비 = 1', { size: 12, cls: 't-soft' }));
      const fg = SJ.pose.figure({ scale: SC, x: FX, y: FY, dots: true }); svg.appendChild(fg.g);
      const PARTS = [['body', '상체', 13, 'var(--ink)'], ['lhand', '왼손', 21, '#3E7CB1'], ['rhand', '오른손', 21, 'var(--core)'], ['face', '얼굴', 70, 'var(--ink-faint)']];
      const on = { body: true, lhand: true, rhand: true, face: true };
      function dims() { const n = PARTS.reduce((a, p) => a + (on[p[0]] ? p[2] : 0), 0); dimNote.textContent = '켜진 점 ' + n + '개 × 3 = ' + (n * 3) + '차원'; }
      PARTS.forEach((p) => {
        const b = h('button', { class: 'btn on', type: 'button', 'aria-pressed': 'true' }, [h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: p[3], marginRight: '6px' } }), p[1] + ' ' + p[2]]);
        b.addEventListener('click', () => { on[p[0]] = !on[p[0]]; fg.show(p[0], on[p[0]]); b.classList.toggle('on', on[p[0]]); b.setAttribute('aria-pressed', on[p[0]]); dims(); draw(); });
        b._key = p[0]; partBtns.appendChild(b);
      });
      partBtns.appendChild(h('button', { class: 'btn', type: 'button', text: '자모표 E5가 배우는 55점만', onclick: () => { PARTS.forEach((p) => { on[p[0]] = p[0] !== 'face'; fg.show(p[0], on[p[0]]); }); partBtns.querySelectorAll('button').forEach((b) => { if (b._key) { b.classList.toggle('on', on[b._key]); b.setAttribute('aria-pressed', on[b._key]); } }); dims(); draw(); } }));
      partBtns.appendChild(dimNote); dims();

      // 오른쪽: 프레임 띠와 토큰 띠
      const N = SJ.pose.CLIPS.a.frames, A0 = 4, A1 = 56, TX = 520, TW = 690, fw = TW / N, YF = 250, YT = 170;
      svg.appendChild(text(TX, 70, '파일 한 개  npy/<클립>.npy', { size: 15, cls: 't-story', anchor: 'start' }));
      svg.appendChild(text(TX, 94, '[T, 125, 3]  float32   →   읽을 때 [T, 375] 로 편다', { size: 13, cls: 't-mono t-soft', anchor: 'start' }));
      svg.appendChild(text(TX, YT - 18, '토큰 (자모표가 붙인 번호, 0 ~ 511)', { size: 12.5, cls: 't-soft', anchor: 'start' }));
      svg.appendChild(text(TX, YF + 62, '프레임 (30장 = 1초)', { size: 12.5, cls: 't-soft', anchor: 'start' }));
      const frameRects = [], tokRects = [];
      for (let i = 0; i < N; i++) {
        const act = i >= A0 && i < A1;
        const r = s('rect', { x: TX + i * fw + 0.8, y: YF, width: fw - 1.6, height: 40, rx: 2, fill: act ? 'var(--yellow-soft)' : 'var(--paper-deep)', stroke: 'var(--line-strong)', 'stroke-width': 0.8 });
        svg.appendChild(r); frameRects.push(r);
      }
      const rr = SJ.rng(77), nt = (A1 - A0) / 4; let loopTok = -1;
      for (let k = 0; k < nt; k++) {
        const x = TX + (A0 + k * 4) * fw + 1.5, w = fw * 4 - 3, id = Math.floor(rr() * 512);
        const g = s('g', { class: 'node', tabindex: 0, role: 'button', 'aria-label': '토큰 ' + (k + 1) + '번째' });
        const r = s('rect', { x, y: YT, width: w, height: 44, rx: 6, fill: 'var(--core-pale)', stroke: 'var(--core-deep)', 'stroke-width': 1.4 });
        g.appendChild(r); g.appendChild(text(x + w / 2, YT + 28, String(id), { size: 13, cls: 't-mono' }));
        g.appendChild(s('path', { class: 'ink thin soft', d: 'M' + x + ' ' + (YT + 46) + ' L' + x + ' ' + (YF - 2) + ' M' + (x + w) + ' ' + (YT + 46) + ' L' + (x + w) + ' ' + (YF - 2) }));
        const pick = () => { loopTok = loopTok === k ? -1 : k; tokRects.forEach((t, j) => t.setAttribute('fill', j === loopTok ? 'var(--core-wash)' : 'var(--core-pale)')); };
        g.addEventListener('click', pick); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        SJ.tip(g, '<b>토큰 ' + id + '</b> (번호는 예시)<br>프레임 ' + (A0 + k * 4) + ' ~ ' + (A0 + k * 4 + 3) + ' · 0.13초');
        svg.appendChild(g); tokRects.push(r);
      }
      const br = (x1, x2, y, lab, cls) => { svg.appendChild(s('path', { class: 'ink thin', d: 'M' + x1 + ' ' + y + ' v8 H' + x2 + ' v-8' })); svg.appendChild(text((x1 + x2) / 2, y + 26, lab, { size: 12.5, cls: cls || 't-soft' })); };
      br(TX + A0 * fw, TX + A1 * fw, YF + 76, '움직임 구간(active)에 앞뒤 4프레임 여유. 단어 클립은 여기만 토큰으로 바꾼다');
      svg.appendChild(text(TX + 2 * fw, YF - 8, '손 내림', { size: 11, cls: 't-faint' })); svg.appendChild(text(TX + 58 * fw, YF - 8, '손 내림', { size: 11, cls: 't-faint' }));
      const head = s('path', { d: '', stroke: 'var(--ink)', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round' }); svg.appendChild(head);
      const info = text(TX, YF + 150, '', { size: 14, cls: 't-mono', anchor: 'start' }); svg.appendChild(info);
      svg.appendChild(text(TX, 420, '토큰 열 길이: 단어 3 ~ 46개(평균 20), 문장 16 ~ 85개(평균 44)', { size: 13, cls: 't-soft', anchor: 'start' }));
      svg.appendChild(text(TX, 444, '좌표에 meta의 norm.scale(약 0.32)을 곱하면 미터가 된다', { size: 13, cls: 't-soft', anchor: 'start' }));
      svg.appendChild(text(TX, 484, '같은 클립 이름으로 npy · meta.jsonl · tokens.json 이 이어진다', { size: 21, cls: 't-hand t-core', anchor: 'start' }));
      let fr = 22;
      function draw() {
        fg.set(SJ.pose.clipFrame('a', fr)); const x = TX + (Math.floor(fr) + 0.5) * fw;
        head.setAttribute('d', 'M' + x + ' ' + (YF - 4) + ' V' + (YF + 46));
        info.textContent = '프레임 ' + String(Math.floor(fr)).padStart(2, '0') + ' / ' + N + '   ' + (Math.floor(fr) / 30).toFixed(2) + '초';
      }
      scope.loop((dt) => {
        fr += dt * 30 * 0.6;
        if (loopTok >= 0) { const a = A0 + loopTok * 4; if (fr < a || fr >= a + 4) fr = a; } else if (fr >= N) fr = 0;
        draw();
      });
      draw();

      /* 그림 2: 정리 과정 */
      const b2 = h('div', { class: 'block' }, [h('h2', { text: '원본에서 학습 데이터까지' }), h('p', { text: '숫자는 품질 점검 기록(ml/prep/quality_policy.md)에서 가져왔다.' })]);
      body.appendChild(b2);
      const F2 = SJ.fig(1240, 250, { minw: 900, file: 'suji-prep-flow', label: '데이터 정리 과정', caption: '제외한 클립은 지우지 않고 분할표의 exclude 목록에 적어 둔다. 그래서 어떤 모델이든 같은 클립을 같은 이유로 뺀다.' });
      b2.appendChild(F2.figure);
      const steps = [
        ['AI Hub 키포인트', ['프레임마다 JSON', '137점 · 5방향'], 'ext'],
        ['정면 3D 고르기', ['하체 12점은 가짜 값', '→ 125점만'], 'core'],
        ['정규화', ['목이 원점', '어깨너비 = 1'], 'core'],
        ['귀 · 눈 고치기', ['왼쪽 귀가 틀린', '16,771클립 재계산'], 'core'],
        ['품질 점검', ['10fps로 뽑힌 985', '동작 보류 883'], 'core'],
        ['고정 분할표', ['학습 12 · 검증 2', '· 평가 2명'], 'core'],
      ];
      steps.forEach((st, i) => {
        const x = 14 + i * 205;
        F2.svg.appendChild(SJ.node({ x, y: 60, w: 172, h: 110, title: st[0], sub: st[1], kind: st[2], static: true, size: 16, delay: i * 0.1 }));
        if (i < 5) F2.svg.appendChild(SJ.arrow({ from: [x + 174, 115], to: [x + 203, 115], core: true }));
      });
      F2.svg.appendChild(text(14, 214, '단어 48,000클립 중 1,855개(3.9%), 문장 32,000클립 중 153개(0.48%)를 학습에서 뺐다', { size: 21, cls: 't-hand t-soft', anchor: 'start' }));

      /* 그림 3: 사람으로 나누기 */
      const sp = D.split, segS = h('div', { class: 'seg', role: 'group', 'aria-label': '데이터 고르기' });
      const b3 = h('div', { class: 'block' }, [h('h2', { text: '사람으로 나눈다: 처음 보는 사람의 동작으로 평가' }), h('p', { text: '클립을 섞어서 나누면 같은 사람의 동작이 학습과 평가에 같이 들어간다. 그래서 수행자 16명을 통째로 나눴고, 모든 모델이 같은 평가 사람을 쓴다.' }), h('div', { class: 'ctrl' }, segS)]);
      body.appendChild(b3);
      const F3 = SJ.fig(1240, 330, { minw: 900, file: 'suji-split', label: '수행자 16명을 학습 12명, 검증 2명, 평가 2명으로 나눈 그림', caption: '검증(val)은 설정을 고르는 데만 쓰고 최종 숫자는 평가(test)로 낸다.' });
      b3.appendChild(F3.figure); const sv3 = F3.svg;
      const groups = [['train', '학습 12명', 'var(--yellow-soft)', 30, 12], ['val', '검증 2명', 'var(--sky)', 780, 2], ['test', '평가 2명', 'var(--grape)', 1000, 2]];
      groups.forEach((gr) => {
        const ids = sp[gr[0]], gw = ids.length * 58 + 24;
        sv3.appendChild(s('path', { class: 'wash', d: SJ.blob(gr[3], 34, gw, 128, SJ.hash(gr[0]), 4), fill: gr[2], opacity: 0.7 }));
        sv3.appendChild(text(gr[3] + 14, 30, gr[1], { size: 22, cls: 't-hand', anchor: 'start' }));
        ids.forEach((id, i) => {
          const x = gr[3] + 40 + i * 58, g = s('g', { class: 'paint-in', style: { '--d': (i * 0.04) + 's' } });
          g.appendChild(s('circle', { cx: x, cy: 78, r: 13, class: 'paperfill', stroke: 'var(--ink)', 'stroke-width': 1.8 }));
          g.appendChild(s('path', { class: 'ink', d: 'M' + (x - 19) + ' 128 Q' + (x - 19) + ' 97 ' + x + ' 97 Q' + (x + 19) + ' 97 ' + (x + 19) + ' 128' }));
          g.appendChild(text(x, 146, id.replace('REAL', 'R'), { size: 11.5, cls: 't-mono' }));
          sv3.appendChild(g);
        });
      });
      const barG = s('g'); sv3.appendChild(barG);
      function bars(key) {
        barG.textContent = ''; const d = sp[key], BX = 30, BW = 1180, BY = 214, tot = d.total;
        const parts = [['학습', d.train, 'var(--yellow)'], ['검증', d.val, 'var(--sky)'], ['평가', d.test, 'var(--grape)'], ['제외', d.out, 'var(--paper-deep)']];
        let x = BX;
        parts.forEach((p, i) => {
          const w = Math.max(3, (p[1] / tot) * BW - 2);
          barG.appendChild(s('rect', { x, y: BY, width: w, height: 30, rx: 4, fill: p[2], stroke: 'var(--ink)', 'stroke-width': 1.2, class: 'growX', style: { '--d': (i * 0.08) + 's' } }));
          const lab = p[0] + ' ' + p[1].toLocaleString();
          if (w > tw(lab, 13) + 10) barG.appendChild(text(x + w / 2, BY + 20, lab, { size: 13 }));
          else barG.appendChild(text(x + w / 2, BY - 8, lab, { size: 12.5, anchor: i === 3 ? 'end' : 'middle' }));
          x += w + 2;
        });
        barG.appendChild(text(BX, BY + 56, '모두 ' + tot.toLocaleString() + '클립.  제외 ' + d.out.toLocaleString() + ' = ' + d.why, { size: 13, cls: 't-soft', anchor: 'start' }));
        barG.appendChild(text(BX, BY + 92, '문장은 여기에 더해 "새 조합 문장" 50개를 학습에서 빼 두고(919클립), 평가 사람의 150클립으로 따로 본다', { size: 20, cls: 't-hand t-soft', anchor: 'start' }));
        segS.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === key ? 'true' : 'false'));
      }
      [['word', '단어 48,000'], ['sen', '문장 32,000'], ['all', '합쳐서 80,000']].forEach((o) => segS.appendChild(h('button', { type: 'button', 'data-k': o[0], text: o[1], onclick: () => bars(o[0]) })));
      bars('word');
    },
  });
})();
