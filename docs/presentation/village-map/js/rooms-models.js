/* 빨간 방 3 · 4 · 5: 자모표(VQ-VAE) / 받아쓰기(단어 GPT) / 읽는 모델 */
(function () {
  'use strict';
  const SJ = window.SJ, s = SJ.s, h = SJ.h, text = SJ.text, D = window.SJD, P = D.people, C = SJ.chart.C;
  const table = (head, rows, numFrom) => h('div', { class: 'tb-scroll' }, h('table', { class: 'tb' }, [
    h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { text: c, class: numFrom != null && i >= numFrom ? 'num' : null })))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { text: String(c), class: numFrom != null && i >= numFrom ? 'num' : null })))))]));
  const noteBox = (title, lines) => h('aside', { class: 'note' }, [h('h3', { text: title })].concat(lines.map((l) => (typeof l === 'string' ? h('p', { text: l }) : l))));

  /* ───────────── 자모표 ───────────── */
  SJ.room('vq', {
    short: '자모표', title: '자모표: 동작을 512가지 조각으로 받아 적기', kicker: 'ml/vq · VQ-VAE',
    lead: '한글이 자모 몇십 개로 모든 글자를 적듯, 동작을 4프레임짜리 조각 512종으로 적는다. 적은 번호(토큰)만 있으면 디코더가 동작으로 되돌린다.',
    owners: [P.jaehun],
    build(body, scope) {
      const W = 1320, H = 560;
      const note = noteBox('상자를 눌러 보세요', ['인코더, 양자화, 디코더, 평균 얼굴을 누르면 안에서 하는 일이 여기에 나온다.']);
      const F = SJ.fig(W, H, { minw: 1000, file: 'suji-vqvae', label: 'VQ-VAE 구조. 64프레임이 인코더에서 16칸으로 줄고, 가장 가까운 자모표 칸의 번호가 되고, 디코더가 다시 64프레임으로 되돌린다.', caption: '아래 격자가 자모표 512칸이다. 재생 중에 불이 켜지는 칸이 지금 4프레임에 붙은 번호(번호와 뼈대는 예시).' });
      body.appendChild(h('div', { class: 'block' }, [h('h2', { text: '구조: 줄이고, 번호로 바꾸고, 되돌린다' }), F.figure, note]));
      const svg = F.svg, CY = 120;
      const INFO = {
        enc: ['인코더', ['Conv1d(165→256, k3) + ReLU', '[ Conv1d(k4, 보폭 2) → 잔차 블록(팽창 3) → 잔차 블록(팽창 1) ] × 2', 'Conv1d(256→256, k3)', '보폭 2를 두 번 거쳐 시간이 4분의 1이 된다. 64프레임 → 16칸.'], 'ml/vq/model.py:25'],
        q: ['양자화 (자모표 찾기)', ['칸마다 256차원 벡터가 하나씩, 모두 512칸.', '인코더가 낸 벡터와 가장 가까운 칸의 번호를 적는다.', '자모표는 기울기가 아니라 이동 평균(EMA 0.99)으로 고친다.', '거의 안 쓰이는 칸은 지금 배치의 벡터로 다시 뽑아 죽은 칸을 없앤다.'], 'ml/vq/model.py:52'],
        dec: ['디코더', ['Conv1d(k3) + ReLU', '[ 잔차 블록 × 2 → 2배 늘리기 → Conv1d(k3) ] × 2', 'Conv1d → ReLU → Conv1d(256→165)', '받아쓰기 모델이 쓴 토큰도 이 디코더가 동작으로 바꾼다 (계약 ②).'], 'ml/vq/model.py:38'],
        face: ['평균 얼굴 붙이기', ['E5는 상체와 손 55점만 배운다.', '얼굴 70점은 학습 데이터의 평균 얼굴로 채워 항상 375차원으로 돌려준다.', '그래서 얼굴이 안 움직이는 것은 정상이다.'], 'ml/vq/model.py:116'],
      };
      function pick(k) {
        note.textContent = ''; const it = INFO[k];
        note.appendChild(h('h3', { text: it[0] })); note.appendChild(h('ul', {}, it[1].map((l) => h('li', { text: l }))));
        note.appendChild(h('h4', { text: '코드' })); note.appendChild(h('p', { class: 'path', text: it[2] }));
      }
      // 입력 띠
      const NB = 64, IX = 24, bw = 2.4;
      svg.appendChild(text(IX + 78, CY - 52, '동작 64프레임', { size: 14, cls: 't-story' }));
      const inB = [], outB = [];
      for (let i = 0; i < NB; i++) { const r = s('rect', { x: IX + i * bw, y: CY - 28, width: bw - 0.6, height: 56, fill: 'var(--ink-faint)' }); svg.appendChild(r); inB.push(r); }
      svg.appendChild(text(IX + 78, CY + 52, '[B, 64, 165]', { size: 12, cls: 't-mono t-soft' }));
      svg.appendChild(text(IX + 78, CY + 68, '55점 × 3', { size: 11.5, cls: 't-faint' }));
      const mk = (id, x, w, t, sub, k) => { const g = SJ.node({ id: 'vq-' + id, x, y: CY - 56, w, h: 112, title: t, sub, kind: 'core', size: 18, subSize: 12 }); g.addEventListener('click', () => pick(k)); svg.appendChild(g); return g; };
      svg.appendChild(SJ.arrow({ from: [186, CY], to: [214, CY], core: true }));
      mk('enc', 218, 200, '인코더', ['Conv 층으로', '시간을 4분의 1로'], 'enc');
      svg.appendChild(SJ.arrow({ from: [420, CY], to: [488, CY], core: true, label: '[B,16,256]' }));
      mk('q', 492, 200, '양자화', ['가장 가까운', '자모표 칸의 번호'], 'q');
      svg.appendChild(SJ.arrow({ from: [694, CY], to: [716, CY], core: true }));
      const TX = 720, tw = 13.5, toks = [], rr = SJ.rng(4242), ids = [];
      for (let k = 0; k < 16; k++) { ids.push(Math.floor(rr() * 512)); const r = s('rect', { x: TX + k * tw, y: CY - 16, width: tw - 2, height: 32, rx: 3, fill: 'var(--core-pale)', stroke: 'var(--core-deep)', 'stroke-width': 1 }); svg.appendChild(r); toks.push(r); }
      svg.appendChild(text(TX + 108, CY - 28, '토큰 16개', { size: 14, cls: 't-story' }));
      svg.appendChild(text(TX + 108, CY + 36, '[B, 16]', { size: 12, cls: 't-mono t-soft' }));
      svg.appendChild(SJ.arrow({ from: [940, CY], to: [962, CY], core: true }));
      mk('dec', 966, 160, '디코더', ['시간을 4배로', '되돌린다'], 'dec');
      svg.appendChild(SJ.arrow({ from: [1128, CY], to: [1150, CY], core: true }));
      mk('face', 1154, 150, '평균 얼굴', ['165 → 375', '얼굴 70점 채움'], 'face');
      svg.appendChild(text(1229, CY + 78, '[B, 64, 375]', { size: 12, cls: 't-mono t-soft' }));
      // 자모표 격자
      const GX = 350, GY = 262, cw = 16, ch = 14, cells = [];
      svg.appendChild(text(GX, GY - 14, '자모표 512칸  (칸마다 256차원 벡터 하나)', { size: 14, cls: 't-story', anchor: 'start' }));
      const cellG = s('g'); svg.appendChild(cellG);
      for (let i = 0; i < 512; i++) { const r = s('rect', { x: GX + (i % 32) * cw, y: GY + Math.floor(i / 32) * ch, width: cw - 2, height: ch - 2, rx: 2, fill: 'var(--card)', stroke: 'var(--line-strong)', 'stroke-width': 0.7 }); cellG.appendChild(r); cells.push(r); }
      cellG.addEventListener('pointermove', (e) => { const i = cells.indexOf(e.target); if (i >= 0) cellG.setAttribute('data-i', i); });
      SJ.tip(cellG, () => '<b>토큰 ' + (cellG.getAttribute('data-i') || 0) + '</b><br>이 칸은 4프레임짜리 동작 조각 하나를 뜻한다');
      const link = s('path', { class: 'edge core', d: '' }); svg.appendChild(link);
      // 원래 동작과 되돌린 동작
      const figA = SJ.pose.figure({ scale: 84, x: 170, y: 340, weight: 1 }), figB = SJ.pose.figure({ scale: 84, x: 1120, y: 340, weight: 1 });
      svg.appendChild(figA.g); svg.appendChild(figB.g);
      svg.appendChild(text(170, 236, '원래 동작', { size: 15, cls: 't-story' })); svg.appendChild(text(1120, 236, '되돌린 동작', { size: 15, cls: 't-story' }));
      svg.appendChild(text(1120, 512, '손이 조금 어긋난다', { size: 20, cls: 't-hand t-core' }));
      svg.appendChild(text(1120, 534, '평가 사람 기준 손 28.2mm · 상체 24.5mm', { size: 12, cls: 't-soft' }));
      svg.appendChild(text(170, 512, '토큰 1개 = 4프레임 = 0.13초', { size: 20, cls: 't-hand t-soft' }));
      for (let k = 0; k < 16; k++) outB.push(null);
      const jit = SJ.rng(9); const off = []; for (let i = 0; i < 125; i++) off.push([(jit() - 0.5) * 0.07, (jit() - 0.5) * 0.07]);
      let fr = 22;
      function draw() {
        const k = Math.min(15, Math.floor(fr / 4)), pts = SJ.pose.clipFrame('b', fr);
        figA.set(pts);
        figB.set(pts.map((p, i) => (i >= 13 && i < 55 ? [p[0] + off[i][0], p[1] + off[i][1], p[2]] : p)));
        inB.forEach((r, i) => r.setAttribute('fill', Math.floor(i / 4) === k ? 'var(--core)' : Math.floor(i / 4) < k ? 'var(--core-wash)' : 'var(--ink-faint)'));
        toks.forEach((r, i) => r.setAttribute('fill', i === k ? 'var(--core)' : i < k ? 'var(--core-wash)' : 'var(--core-pale)'));
        cells.forEach((r) => { if (r._on) { r.setAttribute('fill', 'var(--core-pale)'); } });
        for (let i = 0; i <= k; i++) { const c = cells[ids[i]]; c._on = true; c.setAttribute('fill', i === k ? 'var(--core)' : 'var(--core-wash)'); }
        const c = ids[k], cx = GX + (c % 32) * cw + cw / 2 - 1, cy = GY + Math.floor(c / 32) * ch;
        link.setAttribute('d', 'M592 ' + (CY + 58) + ' Q592 ' + (GY - 40) + ' ' + cx + ' ' + cy);
      }
      scope.loop((dt) => { fr += dt * 30 * 0.45; if (fr >= 64) { fr = 0; cells.forEach((r) => { if (r._on) { r._on = false; r.setAttribute('fill', 'var(--card)'); } }); } draw(); });
      draw();

      // 손실
      body.appendChild(h('div', { class: 'block' }, [
        h('h2', { text: '무엇을 맞히도록 배우나' }),
        h('p', { class: 'mono', style: { fontSize: '15px', color: 'var(--ink)' }, text: '손실 = 위치 + 0.5 × 속도 + 1.0 × 손가락(손목 기준) + 0.02 × commit' }),
        h('div', { class: 'facts' }, [
          ['위치', '관절이 제자리에 있나. 손은 2배, 상체 1배, 얼굴 0.5배로 센다'], ['속도', '프레임 사이 움직임이 같은가. 떨림을 줄인다'], ['손가락', '손목에서 본 손가락 21점 × 양손. 손 모양을 따로 챙긴다'], ['commit', '인코더 출력이 고른 칸에서 멀어지지 않게'],
        ].map((f) => h('div', { class: 'fact' }, [h('b', { text: f[0], style: { fontSize: '19px' } }), h('span', { text: f[1] })]))),
      ]));

      // 실험
      const b3 = h('div', { class: 'block' }, [h('h2', { text: '실험 다섯 번, 그리고 E5를 고른 이유' }), h('p', { text: '처음 보는 사람(평가 수행자 2명)의 동작을 되돌렸을 때의 오차. 낮을수록 좋다.' })]);
      body.appendChild(b3);
      const F2 = SJ.fig(1240, 360, { minw: 900, file: 'suji-vq-experiments', label: '자모표 실험 E1부터 E5까지의 상체, 손, 손가락 오차', caption: '왼쪽: 단어 데이터에서의 오차(ml/experiments.md). 오른쪽: 문장 데이터에서 손 오차. 단어로만 배운 E4b는 문장에서 37.3mm였고, 문장까지 같이 배운 E5는 28.1mm다.' });
      b3.appendChild(F2.figure);
      SJ.chart.columns(F2.svg, { x: 0, y: 10, w: 760, h: 330, max: 36, ticks: [0, 12, 24, 36], unit: 'mm', dec: 1,
        series: [{ name: '상체', color: C.blue }, { name: '손', color: C.ochre }, { name: '손가락(손목 기준)', color: C.green }],
        cats: D.vqRuns.map((r) => ({ label: r.id, under: r.id === 'E5' ? '단어+문장' : r.id === 'E2' ? '얼굴 포함' : r.id === 'E4a' ? '1024칸' : r.id === 'E4b' ? '20만 회' : '기준', sub: r.set, pick: r.pick })),
        values: D.vqRuns.map((r) => [r.body, r.hand, r.finger]) });
      F2.svg.appendChild(text(800, 44, '문장에서 손 오차 (mm)', { size: 15, cls: 't-story', anchor: 'start' }));
      SJ.chart.hbars(F2.svg, { x: 800, y: 76, w: 430, labelW: 150, max: 40, dec: 1, gap: 38, barH: 18, rows: [
        { label: 'E4b · 단어 클립', value: D.vqSen.e4b.word, color: C.gray }, { label: 'E4b · 문장 클립', value: D.vqSen.e4b.sen, color: C.gray, note: '단어로만 배운 자모표는 문장에서 손이 크게 어긋난다' },
        { label: 'E5 · 단어 클립', value: D.vqSen.e5.word, color: C.ochre }, { label: 'E5 · 문장 클립', value: D.vqSen.e5.sen, color: C.ochre, pick: true, note: '문장까지 같이 배우면 문장에서도 단어만큼 맞는다' } ] });
      F2.svg.appendChild(text(800, 262, '37.3 → 28.1', { size: 34, cls: 't-hand t-core', anchor: 'start' }));
      F2.svg.appendChild(text(800, 288, '문장을 같이 가르치자 문장의 손 오차가 9mm 줄었다', { size: 13, cls: 't-soft', anchor: 'start' }));
      b3.appendChild(table(['실험', '설정', '상체 mm', '손 mm', '쓰인 칸', '학습 분'], D.vqRuns.map((r) => [r.id + (r.pick ? ' (v1 후보)' : ''), r.set, r.body.toFixed(1), r.hand.toFixed(1), r.use + '%', r.min.toFixed(1)]), 2));
      b3.appendChild(h('p', { class: 'hand', text: 'E5는 v1 후보(v0.3-e5)다. 11월 7일 동결 예정이었고, 확정은 아직 팀 결정 전이다.', style: { marginTop: '8px' } }));
    },
  });

  /* ───────────── 받아쓰기 ───────────── */
  SJ.room('gen', {
    short: '받아쓰기', title: '받아쓰기: 단어를 듣고 토큰을 써 내려간다', kicker: 'ml/gen · 단어 GPT',
    lead: '단어 번호를 조건으로 받아 다음 토큰을 하나씩 고른다. 글을 이어 쓰는 GPT와 같은 방식인데, 쓰는 것이 글자가 아니라 동작 조각 번호다.',
    owners: [P.jiheon],
    build(body, scope) {
      const W = 1320, H = 550;
      const gS = h('input', { type: 'range', id: 'gen-g', min: 1, max: 3, step: 0.1, value: 2, 'aria-label': 'guidance' });
      const gV = h('span', { class: 'mono', text: 'g = 2.0' });
      const b1 = h('div', { class: 'block' }, [h('h2', { text: '한 단어를 만드는 과정' }), h('div', { class: 'ctrl' }, [h('label', { for: 'gen-g', text: '단어 조건을 얼마나 세게 믿을까 (guidance)' }), gS, gV, h('span', { class: 'save-note', text: '배포 설정은 2.0' })])]);
      body.appendChild(b1);
      const F = SJ.fig(W, H, { minw: 1000, file: 'suji-word-gpt', label: '단어 GPT. 단어와 화자를 조건으로 받아 토큰을 하나씩 쓰고, 후보 24개 중 가운데 것을 고른다.', caption: '막대 높이와 점 위치는 원리를 보여 주는 모식도다. 구조와 설정값은 실제 코드(ml/gen/model.py, ml/serve/README.md)와 같다.' });
      b1.appendChild(F.figure); const svg = F.svg;
      // 조건
      svg.appendChild(SJ.node({ x: 20, y: 70, w: 170, h: 64, title: '단어 "병원"', sub: ['번호 → 256차원'], kind: 'touch', static: true, size: 16 }));
      svg.appendChild(SJ.node({ x: 20, y: 160, w: 170, h: 64, title: '화자', sub: ['학습한 12명 중 하나'], kind: 'touch', static: true, size: 16 }));
      svg.appendChild(text(105, 152, '+', { size: 22, cls: 't-hand' }));
      svg.appendChild(SJ.arrow({ from: [192, 148], to: [248, 250], core: true, label: '조건', bend: -14 }));
      svg.appendChild(text(20, 262, '조건은 맨 앞 자리에 놓고,', { size: 12.5, cls: 't-soft', anchor: 'start' }));
      svg.appendChild(text(20, 280, '모든 자리에도 더해 준다', { size: 12.5, cls: 't-soft', anchor: 'start' }));
      // 자리들
      const NX = 250, SW = 46, NT = 12, SY = 300;
      svg.appendChild(SJ.node({ id: 'gen-tf', x: NX - 6, y: 190, w: SW * (NT + 1) + 12, h: 72, title: 'Transformer 4층 · 폭 256 · 머리 4', sub: ['앞쪽 자리만 볼 수 있다 (causal)'], kind: 'core', static: true, size: 17 }));
      const slots = [], rr = SJ.rng(31), seqIds = []; for (let i = 0; i < NT; i++) seqIds.push(Math.floor(rr() * 512));
      for (let i = 0; i <= NT; i++) {
        const x = NX + i * SW, g = s('g');
        g.appendChild(s('rect', { x: x + 2, y: SY, width: SW - 6, height: 34, rx: 6, fill: i === 0 ? 'var(--yellow-soft)' : 'var(--core-pale)', stroke: 'var(--ink)', 'stroke-width': 1.3 }));
        g.appendChild(text(x + SW / 2 - 1, SY + 22, i === 0 ? '조건' : i === NT ? '끝' : String(seqIds[i - 1]), { size: i === 0 || i === NT ? 12 : 11.5, cls: i === 0 || i === NT ? null : 't-mono' }));
        g.appendChild(s('path', { class: 'ink thin soft', d: 'M' + (x + SW / 2 - 1) + ' ' + (SY - 2) + ' V266' }));
        svg.appendChild(g); slots.push(g);
      }
      svg.appendChild(text(NX, SY + 58, '512는 "끝" 표시. 끝이 나올 때까지(길어도 54개) 한 칸씩 쓴다', { size: 12.5, cls: 't-soft', anchor: 'start' }));
      // 다음 토큰 후보 막대
      const BX = NX + 40, BY = 150, bars = [], base = [], cond = [];
      const r2 = SJ.rng(8); for (let i = 0; i < 10; i++) { base.push(0.25 + r2() * 0.5); cond.push(i === 3 ? 1 : i === 6 ? 0.62 : 0.08 + r2() * 0.3); }
      svg.appendChild(text(BX - 10, 44, '다음 토큰 후보 (가장 그럴듯한 10개만 남기고 그중에서 뽑는다)', { size: 13.5, cls: 't-story', anchor: 'start' }));
      for (let i = 0; i < 10; i++) { const b = s('rect', { x: BX + i * 26, y: BY - 40, width: 18, height: 40, rx: 3, fill: C.gray }); svg.appendChild(b); bars.push(b); }
      svg.appendChild(s('line', { x1: BX - 6, x2: BX + 262, y1: BY, y2: BY, stroke: 'var(--ink)', 'stroke-width': 1.4 }));
      const fm = text(BX + 290, 100, '', { size: 13, cls: 't-mono', anchor: 'start' }); svg.appendChild(fm);
      svg.appendChild(text(BX + 290, 122, '단어 없이 본 예측과 단어를 보고 한 예측의 차이를 g배 키운다', { size: 12, cls: 't-soft', anchor: 'start' }));
      svg.appendChild(text(BX + 290, 144, 'g가 크면 "이 단어다움"이 강해진다', { size: 19, cls: 't-hand t-core', anchor: 'start' }));
      function setG() {
        const g = +gS.value; gV.textContent = 'g = ' + g.toFixed(1); fm.textContent = '점수 = free + ' + g.toFixed(1) + ' × (cond − free)';
        const v = base.map((b, i) => Math.max(0.02, b + g * (cond[i] - b))), m = Math.max.apply(null, v);
        bars.forEach((b, i) => { const hh = (v[i] / m) * 78; b.setAttribute('y', BY - hh); b.setAttribute('height', hh); b.setAttribute('fill', i === 3 ? C.core : C.gray); });
      }
      gS.addEventListener('input', setG); setG();
      // 후보 24개와 대표
      const MX = 1030, MY = 320;
      svg.appendChild(s('path', { class: 'wash', d: SJ.blob(MX - 130, MY - 110, 400, 270, 55, 6), fill: 'var(--paper-deep)', opacity: 0.7 }));
      svg.appendChild(text(MX - 110, MY - 78, '후보 24개 중 대표 고르기', { size: 15, cls: 't-story', anchor: 'start' }));
      svg.appendChild(text(MX - 110, MY - 58, '화자 12명 × 2개. 정답은 보지 않는다', { size: 12, cls: 't-soft', anchor: 'start' }));
      const r3 = SJ.rng(12), pts = []; for (let i = 0; i < 24; i++) { const a = r3() * 6.283, d = Math.pow(r3(), 0.7) * 92; pts.push([MX + 60 + Math.cos(a) * d * 1.25, MY + 44 + Math.sin(a) * d * 0.8]); }
      let best = 0, bd = 1e9; pts.forEach((p, i) => { const t = pts.reduce((a, q) => a + Math.hypot(p[0] - q[0], p[1] - q[1]), 0); if (t < bd) { bd = t; best = i; } });
      const rays = s('g'); svg.appendChild(rays);
      pts.forEach((p, i) => { if (i !== best) rays.appendChild(s('line', { x1: pts[best][0], y1: pts[best][1], x2: p[0], y2: p[1], stroke: 'var(--core-wash)', 'stroke-width': 0.9, opacity: 0.55 })); });
      pts.forEach((p, i) => svg.appendChild(s('circle', { cx: p[0], cy: p[1], r: i === best ? 9 : 5, fill: i === best ? 'var(--core)' : 'var(--card)', stroke: 'var(--ink)', 'stroke-width': 1.4, class: 'paint-in', style: { '--d': (i * 0.03) + 's' } })));
      svg.appendChild(text(MX + 70, MY + 142, '다른 후보들과 가장 가까운 것을 고른다', { size: 19, cls: 't-hand t-core' }));
      svg.appendChild(SJ.arrow({ from: [NX + SW * (NT + 1) + 8, SY + 17], to: [MX - 132, MY + 30], core: true, bend: 20 }));
      svg.appendChild(SJ.arrow({ from: [MX + 70, MY + 160], to: [MX + 70, MY + 192], core: true }));
      svg.appendChild(text(MX + 70, MY + 212, '자모표 디코더로 → 3D 동작', { size: 14, cls: 't-story' }));
      // 한 칸씩 써 내려가는 움직임
      let t = NT + 1;
      const showSlots = () => slots.forEach((g, i) => { g.style.opacity = i <= Math.floor(t) ? 1 : 0.14; });
      scope.loop((dt) => { t += dt * 2.6; if (t > NT + 4) t = 0; showSlots(); });
      scope.onShow.push(() => { t = 0; }); showSlots();

      // 결과
      const b2 = h('div', { class: 'block' }, [h('h2', { text: '얼마나 그 단어답게 나오나' }), h('p', { text: '왼쪽은 "만든 동작이 3,000단어 중 제 단어와 가장 가까운가"(높을수록 좋다). 오른쪽은 정답 동작과의 손 모양 거리(낮을수록 좋다, 어깨너비 단위).' })]);
      body.appendChild(b2);
      const F2 = SJ.fig(1240, 250, { minw: 900, file: 'suji-gen-results', label: '받아쓰기 모델의 정확도와 손 모양 거리', caption: '회색은 사람이 한 실제 동작끼리 잰 값이다. 손 모양 거리의 목표는 사람끼리 수준인 0.082 이하(docs/ai-log/jiheon.md).' });
      b2.appendChild(F2.figure);
      F2.svg.appendChild(text(10, 24, '제 단어가 1등인 비율 (200단어, %)', { size: 14, cls: 't-story', anchor: 'start' }));
      SJ.chart.hbars(F2.svg, { x: 10, y: 50, w: 580, labelW: 210, max: 100, dec: 1, unit: '%', gap: 40, barH: 18, rows: D.genRank.map((r) => ({ label: r.name, value: r.top1, color: r.human ? C.gray : r.pick ? C.ochre : C.blue, pick: r.pick, note: '5등 안에 드는 비율 ' + r.top5 + '%' })) });
      F2.svg.appendChild(text(650, 24, '정답과의 손 모양 거리 (2,999단어, 낮을수록 좋다)', { size: 14, cls: 't-story', anchor: 'start' }));
      SJ.chart.hbars(F2.svg, { x: 650, y: 50, w: 580, labelW: 220, max: 0.11, dec: 3, gap: 40, barH: 18, ref: 0.082, refLabel: '목표 0.082', rows: D.genDist.map((r) => ({ label: r.name, value: r.hand, color: r.human ? C.gray : r.pick ? C.ochre : C.blue, pick: r.pick, note: '몸+손 전체 거리 ' + r.all })) });

      // 비교 조건과 문장 모델
      body.appendChild(h('div', { class: 'block' }, [
        h('h2', { text: '비교 기준과 아직 남은 것' }),
        table(['이름', '방식', '상태'], [
          ['B1 이어 붙이기', '사람이 한 단어 클립의 움직임 구간을 잘라 8프레임씩 섞어 이어 붙인다', '있음 (기준선, 모델 없이 동작)'],
          ['B2 좌표 회귀', '토큰 없이 좌표 64프레임을 바로 맞히는 Transformer', '코드만 있음. 정식 데이터로 학습한 모델과 평가 숫자가 없다'],
          ['단어 GPT (우리 방식)', '토큰을 써 내려가고 자모표 디코더로 되돌린다', '3,000단어 학습 · 추론 서버에 연결'],
          ['문장 GPT', '글로스 열을 보고 단어 사이 연결 동작까지 토큰으로 써 내려간다', '11월 14일 학습 · 평가, 추론 서버와 앱에 연결. 새 조합 문장 915클립에서 단어 구간 0.179(기준선 0.220), 경계 튐 1.03(기준선 5.65)'],
          ['낱말 끼워 넣기 (11월 16일)', '문장은 문장 GPT가 통째로 만들고, 낱말 데이터에서 온 낱말 자리만 대표 동작으로 바꿔 끼운다. 앞뒤는 직선으로 잇는다', '문장 속 그 낱말이 읽히는 비율 1% → 93%, 문장 속 낱말 전체 26.5% → 61.4%. jjh-accuracy 브랜치, main 전'],
        ]),
        h('p', { class: 'hand', text: '문장 GPT는 문장 데이터 낱말(가다 · 병원)은 사람 동작만큼 읽히게 만든다(42% 대 45%). 낱말 데이터 낱말(친구 · 엄마 · 커피)은 1%만 읽혀, 그 자리에는 대표 동작을 끼운다. 네 조건을 한 표로 잰 최종 비교표와 사람 평가는 아직 없다.', style: { marginTop: '8px' } }),
      ]));
    },
  });

  /* ───────────── 읽는 모델 ───────────── */
  SJ.room('recog', {
    short: '읽는 모델', title: '읽는 모델: 동작을 보고 단어를 맞히는 채점관', kicker: 'ml/recog · ml/eval',
    lead: '사람 동작으로만 학습한 인식 모델이다. 만든 동작을 넣었을 때 원래 단어가 나오면 "읽히는 동작"이다. 사람이 영상을 하나하나 보지 않아도 채점할 수 있다.',
    owners: [P.seunghyun],
    build(body) {
      body.appendChild(h('div', { class: 'facts' }, [
        ['97.33%', '3,000단어 1등 정확도 (처음 보는 사람 2명, 5,907클립)', 1], ['99.53%', '5등 안에 드는 비율'], ['446만', '모델 파라미터'], ['162분', 'T4 한 대로 학습'],
      ].map((f) => h('div', { class: 'fact' + (f[2] ? ' core' : '') }, [h('b', { text: f[0] }), h('span', { text: f[1] })]))));

      const b1 = h('div', { class: 'block' }, [h('h2', { text: '구조: 자르고, 맞추고, 훑고, 고른다' })]);
      body.appendChild(b1);
      const F = SJ.fig(1320, 330, { minw: 1000, file: 'suji-recognizer', label: '읽는 모델 구조. 동작을 64프레임 330차원으로 만든 뒤 Conv, 양방향 GRU, 주의 풀링을 거쳐 3,000단어 확률을 낸다.', caption: '층 구성은 ml/recog/model.py, 입력 만들기는 ml/recog/features.py 그대로다.' });
      b1.appendChild(F.figure);
      const L = [
        ['동작', ['[T, 125, 3]'], 'old', 110], ['움직임 구간', ['앞뒤 4프레임 여유로', '자른다'], 'core', 150], ['64프레임으로', ['길이를 맞춘다'], 'core', 140],
        ['위치 + 속도', ['55점 × (3 + 3)', '= 330차원'], 'core', 150], ['Conv × 3', ['k5 · k5 · 풀링 · k3', '64 → 32칸'], 'core', 160], ['양방향 GRU', ['2층 · 256', '앞뒤 문맥'], 'core', 150],
        ['주의 풀링', ['중요한 순간에', '무게를 준다'], 'core', 150], ['단어 3,000', ['확률 → top5'], 'touch', 140],
      ];
      let x = 10;
      L.forEach((l, i) => {
        F.svg.appendChild(SJ.node({ x, y: 60, w: l[3], h: 110, title: l[0], sub: l[1], kind: l[2], static: true, size: 16, subSize: 12, delay: i * 0.07 }));
        if (i < L.length - 1) F.svg.appendChild(SJ.arrow({ from: [x + l[3] + 2, 115], to: [x + l[3] + 18, 115], core: true }));
        x += l[3] + 20;
      });
      F.svg.appendChild(text(10, 222, '학습할 때는 일부러 흔든다: 구간 ±5프레임, 좌우 ±15도 돌리기, 크기 ±10%, 작은 잡음', { size: 13.5, cls: 't-soft', anchor: 'start' }));
      F.svg.appendChild(text(10, 262, 'score(동작) → { top5: [(단어, 확률) × 5], probs }   이 함수 모양이 계약 ④', { size: 14, cls: 't-mono', anchor: 'start' }));
      F.svg.appendChild(text(10, 302, '생성 결과로는 학습하지 않는다. 채점관이 시험 문제를 미리 보면 안 되니까', { size: 21, cls: 't-hand t-core', anchor: 'start' }));

      // 채점 고리
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '지표 고르기' });
      const b2 = h('div', { class: 'block' }, [h('h2', { text: '채점 고리: 자모표를 거치면 얼마나 덜 읽히나' }), h('p', { text: '같은 평가 클립 5,907개를 그대로 읽힌 것과, 자모표로 토큰이 됐다가 되돌아온 것을 읽힌 것의 차이다. 이 차이가 자모표가 잃어버린 정보다.' }), h('div', { class: 'ctrl' }, seg)]);
      body.appendChild(b2);
      const F2 = SJ.fig(1240, 250, { minw: 900, file: 'suji-backtranslation', label: '실제 동작과 자모표로 복원한 동작의 인식 정확도 비교', caption: '옅은 막대 두 개는 손 가중과 뼈 방향을 더한 자모표 후보다. 평가만 했고 아직 배포하지 않았다(ml/recog/README.md).' });
      b2.appendChild(F2.figure); const holder = s('g'); F2.svg.appendChild(holder);
      function drawBT(key) {
        holder.textContent = '';
        SJ.chart.hbars(holder, { x: 10, y: 34, w: 820, labelW: 210, max: 100, dec: 2, unit: '%', gap: 46, barH: 20, rows: D.backtrans.map((r, i) => ({ label: r.name, value: r[key], color: i === 0 ? C.gray : C.ochre, dash: r.cand, pick: i === 1, note: r.note })) });
        const d = (D.backtrans[0][key] - D.backtrans[1][key]).toFixed(2);
        holder.appendChild(text(880, 92, '−' + d + '%p', { size: 44, cls: 't-hand t-core', anchor: 'start' }));
        holder.appendChild(text(880, 122, 'E5 자모표를 거치며 잃는 만큼', { size: 13, cls: 't-soft', anchor: 'start' }));
        holder.appendChild(text(880, 160, key === 'top1' ? '5,749개 → 4,606개가 1등으로 읽힘' : '5등 안: 5,879개 → 5,372개', { size: 13, cls: 't-soft', anchor: 'start' }));
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === key ? 'true' : 'false'));
      }
      [['top1', '1등 정확도'], ['top5', '5등 안']].forEach((o) => seg.appendChild(h('button', { type: 'button', 'data-k': o[0], text: o[1], onclick: () => drawBT(o[0]) })));
      drawBT('top1');

      body.appendChild(h('div', { class: 'block' }, [
        h('h2', { text: '단어 수를 늘려 가며 확인했다' }),
        table(['단어 수', '학습 / 검증 / 평가 클립', '1등 %', '5등 안 %'], D.recogRuns.map((r) => [r.cls.toLocaleString(), r.clips, r.top1.toFixed(2), r.top5.toFixed(2)]), 2),
        h('p', { class: 'hand', text: '100단어에서 라벨을 섞어 학습시키면 1%가 나왔다. 정답을 엿보는 길이 없다는 확인이다.', style: { marginTop: '8px' } }),
      ]));
    },
  });
})();
