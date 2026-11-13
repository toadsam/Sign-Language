/* 공통 엔진: 손그림 선, 물감 칠, 화면 바꾸기, 빨간 방으로 확대, 발표 · 보고서 모드, 그림 저장 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const f = (n) => Math.round(n * 10) / 10;

  function setAttrs(e, a) {
    if (!a) return e;
    for (const k in a) {
      const v = a[k];
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') { for (const sk in v) { if (sk.slice(0, 2) === '--') e.style.setProperty(sk, v[sk]); else e.style[sk] = v[sk]; } }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    return e;
  }
  function addKids(e, kids) {
    if (kids == null) return e;
    (Array.isArray(kids) ? kids : [kids]).forEach((k) => {
      if (k == null || k === false) return;
      if (Array.isArray(k)) addKids(e, k);
      else e.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    });
    return e;
  }
  const s = (tag, attrs, kids) => addKids(setAttrs(document.createElementNS(NS, tag), attrs), kids);
  const h = (tag, attrs, kids) => addKids(setAttrs(document.createElement(tag), attrs), kids);

  function rng(seed) {
    let t = (seed >>> 0) || 1;
    return () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let x = 2166136261;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    return x >>> 0;
  }

  /* ── 손그림 선 ── */
  function wline(x1, y1, x2, y2, r, j) {
    j = j == null ? 1.5 : j;
    const mx = (x1 + x2) / 2 + (r() - 0.5) * j * 2.4, my = (y1 + y2) / 2 + (r() - 0.5) * j * 2.4;
    return 'M' + f(x1 + (r() - 0.5) * j) + ' ' + f(y1 + (r() - 0.5) * j) + ' Q' + f(mx) + ' ' + f(my) + ' ' + f(x2 + (r() - 0.5) * j) + ' ' + f(y2 + (r() - 0.5) * j);
  }
  function roughRect(x, y, w, hh, seed, j) {
    const r = rng(seed), o = 2.2;
    return [
      wline(x - o * r(), y, x + w + o * r(), y, r, j),
      wline(x + w, y - o * r(), x + w, y + hh + o * r(), r, j),
      wline(x + w + o * r(), y + hh, x - o * r(), y + hh, r, j),
      wline(x, y + hh + o * r(), x, y - o * r(), r, j),
    ].join(' ');
  }
  function smoothClosed(P) {
    const n = P.length; let d = 'M' + f(P[0][0]) + ' ' + f(P[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      d += ' C' + f(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + f(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
        f(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + f(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + f(p2[0]) + ' ' + f(p2[1]);
    }
    return d + 'Z';
  }
  /* 물감 얼룩: 네모에 가까운 울퉁불퉁한 닫힌 모양 */
  function blob(x, y, w, hh, seed, amp) {
    const r = rng(seed); amp = amp == null ? 3.5 : amp;
    const c = Math.min(w, hh) * 0.22, P = [];
    const side = (ax, ay, bx, by) => {
      const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / 46));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        P.push([ax + (bx - ax) * t + (r() - 0.5) * amp * 2, ay + (by - ay) * t + (r() - 0.5) * amp * 2]);
      }
    };
    side(x + c, y, x + w - c, y); side(x + w, y + c, x + w, y + hh - c);
    side(x + w - c, y + hh, x + c, y + hh); side(x, y + hh - c, x, y + c);
    return smoothClosed(P);
  }
  function text(x, y, str, o) {
    o = o || {};
    return s('text', {
      x: f(x), y: f(y), 'text-anchor': o.anchor || 'middle', 'font-size': o.size || 13,
      class: o.cls || null, 'font-weight': o.weight || null, 'dominant-baseline': o.base || null, fill: o.fill || null,
      opacity: o.opacity || null,
    }, str);
  }
  function textLines(x, y, arr, o) {
    o = o || {}; const lh = o.lh || (o.size || 13) * 1.35;
    return arr.map((t, i) => text(x, y + i * lh, t, o));
  }

  /* 상자: kind = core(빨간 물감) | touch(노란 물감) | old(연필선) | ext(바깥, 점선) | plain */
  function node(o) {
    const seed = hash(o.id || o.title || 'n') + (o.seed || 0);
    const kind = o.kind || 'old';
    const g = s('g', { class: 'node ' + kind + (o.cls ? ' ' + o.cls : ''), 'data-id': o.id || null, tabindex: o.static ? null : 0, role: o.static ? null : 'button', 'aria-label': o.aria || o.title });
    const washColor = o.color || (kind === 'core' ? 'var(--core-wash)' : kind === 'touch' ? 'var(--yellow-soft)' : null);
    g.appendChild(s('rect', { class: 'paperfill', x: o.x, y: o.y, width: o.w, height: o.h, rx: 6 }));
    if (washColor) {
      const r = rng(seed + 7);
      g.appendChild(s('path', {
        class: 'wash', d: blob(o.x - 3 + (r() - 0.5) * 5, o.y - 2 + (r() - 0.5) * 4, o.w + 5, o.h + 4, seed, 3.2),
        fill: washColor, style: { '--d': (o.delay || 0) + 's' },
      }));
    }
    g.appendChild(s('path', { class: 'ink' + (kind === 'ext' ? ' dash soft' : kind === 'old' ? ' thin' : ''), d: roughRect(o.x, o.y, o.w, o.h, seed, o.j) }));
    const cx = o.x + o.w / 2;
    const lines = Array.isArray(o.title) ? o.title : [o.title];
    const subs = o.sub ? (Array.isArray(o.sub) ? o.sub : [o.sub]) : [];
    const ts = o.size || 14.5, ss = o.subSize || 11.5;
    const total = lines.length * ts * 1.25 + subs.length * ss * 1.35;
    let ty = o.y + (o.h - total) / 2 + ts * 0.95;
    if (o.top) ty = o.y + ts + 8;
    lines.forEach((t) => { g.appendChild(text(cx, ty, t, { size: ts, cls: 't-story' })); ty += ts * 1.25; });
    ty += ss * 0.15;
    subs.forEach((t) => { g.appendChild(text(cx, ty, t, { size: ss, cls: o.subCls || 't-soft' })); ty += ss * 1.35; });
    if (o.owner) g.appendChild(s('circle', { cx: o.x + o.w - 9, cy: o.y + 9, r: 5, fill: 'var(--p-' + o.owner + ')', stroke: 'var(--ink)', 'stroke-width': 1.2 }));
    if (o.tag) g.appendChild(text(o.x + 8, o.y - 5, o.tag, { size: 15, cls: 't-hand t-core', anchor: 'start' }));
    if (!o.static) {
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
    }
    g._box = { x: o.x, y: o.y, w: o.w, h: o.h };
    return g;
  }

  /* 화살표: from/to 좌표, bend 는 가운데를 옆으로 미는 정도 */
  function arrow(o) {
    const x1 = o.from[0], y1 = o.from[1], x2 = o.to[0], y2 = o.to[1];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const b = o.bend || 0, cx = (x1 + x2) / 2 - (dy / len) * b, cy = (y1 + y2) / 2 + (dx / len) * b;
    const g = s('g', { class: 'arrow' + (o.cls ? ' ' + o.cls : ''), 'data-from': o.a || null, 'data-to': o.b || null });
    const cls = 'edge' + (o.core ? ' core' : '') + (o.dash ? ' dash' : '') + (o.flow ? ' flowing' : '');
    g.appendChild(s('path', { class: cls, d: 'M' + f(x1) + ' ' + f(y1) + ' Q' + f(cx) + ' ' + f(cy) + ' ' + f(x2) + ' ' + f(y2) }));
    if (!o.nohead) {
      const tx = x2 - cx, ty = y2 - cy, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl, L = o.core ? 10 : 8;
      const a = 0.45, ca = Math.cos(a), sa = Math.sin(a);
      const p = (sx) => f(x2 - L * (ux * ca - sx * uy * sa)) + ' ' + f(y2 - L * (uy * ca + sx * ux * sa));
      g.appendChild(s('path', { class: 'edge' + (o.core ? ' core' : ''), d: 'M' + p(1) + ' L' + f(x2) + ' ' + f(y2) + ' L' + p(-1) }));
    }
    if (o.label) {
      const t = o.at == null ? 0.5 : o.at, u = 1 - t;
      const lx = u * u * x1 + 2 * u * t * cx + t * t * x2 + (o.ldx || 0), ly = u * u * y1 + 2 * u * t * cy + t * t * y2 + (o.ldy == null ? -5 : o.ldy);
      g.appendChild(text(lx, ly, o.label, { size: o.lsize || 11.5, cls: 'edge-label' + (o.core ? ' core' : ''), anchor: o.lanchor || 'middle' }));
    }
    return g;
  }

  /* 그림 틀: figure > (저장 버튼) + 스크롤 상자 > svg */
  function fig(w, hh, o) {
    o = o || {};
    const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + hh, role: 'img', 'aria-label': o.label || '' });
    const scroll = h('div', { class: 'fig-scroll', style: o.minw ? { '--minw': o.minw + 'px' } : null }, svg);
    const figure = h('figure', { class: 'fig' + (o.cls ? ' ' + o.cls : '') });
    const btn = h('button', { class: 'save-btn', type: 'button', text: '그림 저장' });
    btn.addEventListener('click', () => saveSvg(svg, (o.file || 'figure') + '.png', btn));
    figure.appendChild(btn); figure.appendChild(scroll);
    if (o.caption) figure.appendChild(h('figcaption', { text: o.caption }));
    saveButtons.push(btn); if (downloads) btn.classList.add('ready');
    return { figure, svg, scroll };
  }

  /* ── 말풍선 ── */
  let tipEl;
  function tip(el, content) {
    const show = (e) => {
      if (!tipEl) { tipEl = h('div', { class: 'tip', role: 'tooltip' }); document.body.appendChild(tipEl); }
      const c = typeof content === 'function' ? content(e) : content;
      if (!c) return;
      tipEl.innerHTML = c; tipEl.classList.add('on'); move(e);
    };
    const move = (e) => {
      if (!tipEl) return;
      let x = e.clientX, y = e.clientY;
      if (x == null) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
      x = Math.max(150, Math.min(window.innerWidth - 150, x));
      tipEl.style.left = x + 'px'; tipEl.style.top = Math.max(60, y) + 'px';
    };
    const hide = () => tipEl && tipEl.classList.remove('on');
    el.addEventListener('pointerenter', show); el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', hide); el.addEventListener('focus', show); el.addEventListener('blur', hide);
  }

  /* ── 움직임 고리: 보이는 화면에서만 돈다 ── */
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function makeScope() {
    const sc = { loops: [], active: false, raf: 0, onShow: [], onHide: [] };
    sc.loop = (fn) => { sc.loops.push(fn); };
    const tick = (now) => {
      if (!sc.active) return;
      const dt = Math.min(0.05, (now - sc.last) / 1000); sc.last = now;
      if (!document.body.classList.contains('report')) sc.loops.forEach((fn) => fn(dt, now / 1000));
      sc.raf = requestAnimationFrame(tick);
    };
    sc.start = () => { if (sc.active) return; sc.active = true; sc.last = performance.now(); sc.onShow.forEach((fn) => fn()); if (sc.loops.length) sc.raf = requestAnimationFrame(tick); };
    sc.stop = () => { sc.active = false; cancelAnimationFrame(sc.raf); sc.onHide.forEach((fn) => fn()); };
    return sc;
  }

  /* ── 화면과 방 ── */
  const views = {}, viewOrder = [], rooms = {}, roomOrder = [];
  let currentView = null, currentRoom = null, pendingZoomEl = null;
  const $ = (q) => document.querySelector(q);

  function view(id, def) { views[id] = Object.assign({ id, scope: makeScope() }, def); viewOrder.push(id); }
  function room(id, def) { rooms[id] = Object.assign({ id, scope: makeScope() }, def); roomOrder.push(id); }

  function showView(id) {
    if (!views[id]) id = 'map';
    const v = views[id];
    if (currentView && currentView !== v) { currentView.scope.stop(); currentView.el.hidden = true; }
    if (!v.el) {
      v.el = h('section', { class: 'view', id: 'view-' + id });
      $('#stage').appendChild(v.el);
      v.build(v.el, v.scope);
    }
    v.el.hidden = false; currentView = v;
    if (!currentRoom) v.scope.start();
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.view === id ? 'true' : 'false'));
    const tab = document.querySelector('.tab[data-view="' + id + '"]');
    if (tab && tab.scrollIntoView) { try { tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* 무시 */ } }
  }

  function buildRoom(r) {
    if (r.el) return;
    const idx = roomOrder.indexOf(r.id);
    const prev = rooms[roomOrder[(idx - 1 + roomOrder.length) % roomOrder.length]], next = rooms[roomOrder[(idx + 1) % roomOrder.length]];
    const body = h('div', { class: 'room-body' });
    r.el = h('div', { class: 'room-in' }, [
      h('div', { class: 'room-bar' }, [
        h('button', { class: 'btn', type: 'button', text: '← 지도로 돌아가기', onclick: () => go('map') }),
        h('span', { class: 'chip core', text: '이번 학기 핵심 ' + (idx + 1) + ' / ' + roomOrder.length }),
        r.owners ? h('span', { class: 'chips' }, r.owners.map((p) => h('span', { class: 'chip' }, [h('i', { style: { background: 'var(--p-' + p.key + ')' } }), p.name]))) : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', text: '‹ ' + prev.short, onclick: () => go('room-' + prev.id) }),
        h('button', { class: 'btn', type: 'button', text: next.short + ' ›', onclick: () => go('room-' + next.id) }),
      ]),
      h('div', { class: 'room-head' }, [
        h('div', { class: 'room-kicker', text: r.kicker || '' }),
        h('h1', { text: r.title }),
        r.lead ? h('p', { text: r.lead }) : null,
      ]),
      body,
    ]);
    r.build(body, r.scope);
  }

  function mountRoom(r) {
    const box = $('#room');
    if (currentRoom && currentRoom !== r) currentRoom.scope.stop();
    buildRoom(r);
    box.textContent = ''; box.appendChild(r.el); box.hidden = false; box.scrollTop = 0;
    currentRoom = r;
    if (currentView) currentView.scope.stop();
    void box.offsetWidth; setTimeout(() => { box.classList.add('show'); r.scope.start(); }, 16);
  }

  function openRoom(id) {
    const r = rooms[id]; if (!r) { go('map'); return; }
    const el = pendingZoomEl; pendingZoomEl = null;
    const wrap = $('#map-wrap');
    if (!el || !wrap || reduced || document.body.classList.contains('report') || currentRoom) { mountRoom(r); return; }
    const b = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const sc = Math.min(window.innerWidth / b.width, window.innerHeight / b.height) * 0.8;
    wrap.style.transformOrigin = (cx - w.left) + 'px ' + (cy - w.top) + 'px';
    wrap.style.transition = 'transform .68s cubic-bezier(.6,0,.25,1)';
    wrap.style.transform = 'translate(' + (window.innerWidth / 2 - cx) + 'px,' + (window.innerHeight / 2 - cy) + 'px) scale(' + sc + ')';
    const bloom = $('#bloom');
    bloom.style.left = cx + 'px'; bloom.style.top = cy + 'px'; bloom.style.transform = 'scale(0)';
    bloom.classList.remove('go'); void bloom.offsetWidth; bloom.classList.add('go');
    bloom.style.transform = 'scale(' + (Math.hypot(window.innerWidth, window.innerHeight) / 18) + ')';
    setTimeout(() => {
      mountRoom(r);
      setTimeout(() => {
        wrap.style.transition = 'none'; wrap.style.transform = '';
        bloom.classList.remove('go'); bloom.style.opacity = '0'; bloom.style.transform = 'scale(0)';
        setTimeout(() => { bloom.style.opacity = ''; }, 50);
      }, 360);
    }, 600);
  }

  function closeRoom() {
    if (!currentRoom) return;
    const box = $('#room'), r = currentRoom;
    r.scope.stop(); currentRoom = null;
    box.classList.remove('show');
    setTimeout(() => { if (!currentRoom) { box.hidden = true; box.textContent = ''; } }, 360);
    if (currentView) currentView.scope.start();
  }

  function go(name) { if (location.hash.slice(1) === name) route(); else location.hash = name; }
  function enterRoom(id, el) { pendingZoomEl = el || null; go('room-' + id); }

  function route() {
    const name = location.hash.slice(1) || 'map';
    if (name.indexOf('room-') === 0) {
      if (!currentView) showView('map');
      const id = name.slice(5);
      if (currentRoom && currentRoom.id === id) return;
      openRoom(id);
    } else {
      closeRoom(); showView(name);
      window.scrollTo(0, 0);
    }
    updatePager();
  }

  /* ── 발표 · 보고서 모드 ── */
  let sequence = [];
  function seqIndex() { const n = location.hash.slice(1) || 'map'; return Math.max(0, sequence.indexOf(n)); }
  function step(d) { if (!sequence.length) return; const i = (seqIndex() + d + sequence.length) % sequence.length; go(sequence[i]); }
  function updatePager() { const p = $('#pager-n'); if (p) p.textContent = (seqIndex() + 1) + ' / ' + sequence.length; }
  function setMode(name, on) {
    document.body.classList.toggle(name, on);
    const b = document.querySelector('.mode[data-mode="' + name + '"]'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (name === 'present' && on) { try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 전체 화면이 안 되는 곳 */ } }
    if (name === 'present' && !on && document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* 무시 */ } }
    document.dispatchEvent(new CustomEvent('sj-mode', { detail: { name, on } }));
  }

  /* ── 그림 저장 (보고서 모드) ── */
  let downloads = null; const saveButtons = [];
  const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'paint-order', 'letter-spacing', 'visibility'];
  function fallbackFont(ff) {
    if (/Batang/i.test(ff)) return "'Batang','AppleMyungjo','Noto Serif KR',serif";
    if (/Mono/i.test(ff)) return "Consolas,'Courier New',monospace";
    return "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
  }
  function svgToPngBlob(svg, scale) {
    const vb = svg.viewBox.baseVal, W = vb.width, H = vb.height;
    const clone = svg.cloneNode(true);
    const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
    for (let i = 0; i < src.length; i++) {
      const cs = getComputedStyle(src[i]), d = dst[i];
      if (cs.display === 'none') { d.setAttribute('display', 'none'); continue; }
      STYLE_PROPS.forEach((p) => { const v = cs.getPropertyValue(p); if (v) d.setAttribute(p, v); });
      if (d.tagName === 'text' || d.tagName === 'tspan') d.setAttribute('font-family', fallbackFont(cs.fontFamily));
      const fl = cs.filter; if (fl && fl.indexOf('#wc') >= 0) d.setAttribute('filter', 'url(#wc)');
      d.removeAttribute('class'); d.removeAttribute('style');
    }
    const defs = document.querySelector('#sj-defs defs');
    if (defs) clone.insertBefore(defs.cloneNode(true), clone.firstChild);
    clone.insertBefore(s('rect', { x: vb.x, y: vb.y, width: W, height: H, fill: '#ffffff' }), clone.firstChild);
    clone.setAttribute('xmlns', NS); clone.setAttribute('width', W); clone.setAttribute('height', H);
    const xml = new XMLSerializer().serializeToString(clone);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = Math.round(W * scale); c.height = Math.round(H * scale);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png');
      };
      img.onerror = () => reject(new Error('svg'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    });
  }
  function saveSvg(svg, filename, btn) {
    if (!downloads) return;
    const old = btn.textContent; btn.textContent = '만드는 중…'; btn.disabled = true;
    svgToPngBlob(svg, 2.5)
      .then((blob) => downloads.save({ filename, data: blob }))
      .then(() => { btn.textContent = '저장했어요'; })
      .catch((e) => { btn.textContent = e && e.code === 'declined' ? '취소했어요' : '저장하지 못했어요'; })
      .then(() => { btn.disabled = false; setTimeout(() => { btn.textContent = old; }, 1800); });
  }

  function boot(opts) {
    sequence = opts.sequence || [];
    const tabs = $('#tabs');
    opts.tabs.forEach((t) => {
      tabs.appendChild(h('button', { class: 'tab', type: 'button', role: 'tab', 'data-view': t.id, 'data-core': t.core ? '1' : null, 'aria-selected': 'false', text: t.label, onclick: () => go(t.id) }));
    });
    document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode, b.getAttribute('aria-pressed') !== 'true')));
    $('#pager-prev').addEventListener('click', () => step(-1));
    $('#pager-next').addEventListener('click', () => step(1));
    const topH = () => { const t = document.querySelector('.top'); if (t) document.documentElement.style.setProperty('--top-h', t.getBoundingClientRect().bottom + 'px'); };
    topH(); window.addEventListener('resize', topH); document.addEventListener('sj-mode', () => requestAnimationFrame(topH));
    window.addEventListener('hashchange', route);
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'Escape') { if (document.body.classList.contains('present')) setMode('present', false); else if (currentRoom) go('map'); }
      if (!document.body.classList.contains('present')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
    });
    route();
    if (window.claude && window.claude.use) {
      window.claude.use('downloads').then((d) => { downloads = d || null; if (downloads) saveButtons.forEach((b) => b.classList.add('ready')); document.dispatchEvent(new CustomEvent('sj-downloads', { detail: !!downloads })); }).catch(() => {});
    }
  }

  /* 미리보기 서버에서만 쓰는 확인용: 그림을 PNG 로 만들어 tools/shots 에 보낸다 */
  function devShot(svg, name, scale) { return svgToPngBlob(svg, scale || 1.2).then((b) => fetch('/__shot/' + name, { method: 'POST', body: b })).then((r) => r.status); }

  window.SJ = { devShot,
    s, h, f, rng, hash, wline, roughRect, blob, smoothClosed, text, textLines, node, arrow, fig, tip,
    view, room, go, enterRoom, boot, rooms, roomOrder, views, reduced,
    isReport: () => document.body.classList.contains('report'),
  };
})();
