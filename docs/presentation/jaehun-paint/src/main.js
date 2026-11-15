import * as THREE from 'three';
import { Stage } from './stage.js';
import { TypeCase } from './typecase.js';
import { Sparkles } from './fx.js';
import { loadData } from './data.js';
import { clamp, lerp, smooth, easeOut, easeInOut, span, drawGlyph, COLOR, G, washBlob } from './util.js';
import { titleScene } from './scenes/title.js';
import { composeScene } from './scenes/compose.js';
import { earsScene } from './scenes/ears.js';
import { measureScene } from './scenes/measure.js';
import { sentenceScene } from './scenes/sentence.js';
import { baselineScene } from './scenes/baseline.js';
import { outroScene } from './scenes/outro.js';

/**
 * 장면 하나 = { id, name, duration, camera:[{at,pos,tgt,dur}], cues:[{at,text}], enter(ctx), update(t,dt,ctx), exit(ctx) }
 * update 는 t 로만 상태를 계산한다 (앞뒤로 긁어도 같은 그림). ctx.prevT 로 '방금 지나간 순간'을 알 수 있다(반짝이 등).
 */
const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 글자마다 span 으로 감싸 차례로 튀어나오게 한다 (태그는 그대로) */
function wrapChars(el, step = .018, base = 0) {
  let i = 0;
  const walk = node => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const c of ch.textContent) {
          if (c === ' ') { frag.append(' '); continue; }
          const s = document.createElement('span'); s.className = 'ch'; s.textContent = c; s.style.animationDelay = (base + i++ * step) + 's'; frag.append(s);
        }
        ch.replaceWith(frag);
      } else if (ch.nodeType === 1 && ch.tagName !== 'BR') walk(ch);
    }
  };
  walk(el);
}

/** 종이 가장자리에 옅게 번진 물감 얼룩 (반 해상도로 그려 늘린다: 어차피 번진 그림이라) */
function paintBackground() {
  const c = $('bg'), W = Math.ceil(innerWidth / 2), H = Math.ceil(innerHeight / 2);
  if (!W || !H) return;
  c.width = W; c.height = H; const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  const S = Math.min(W, H);
  const blots = [
    [-.02, .02, .34, .26, '#FFE08A', 3], [.08, .12, .16, .12, '#FFC83D', 4],
    [1.0, 1.0, .36, .3, '#A9CFEA', 5], [.9, .94, .18, .14, '#7CC6A4', 6],
    [1.02, .04, .2, .16, '#F2937A', 7], [-.02, .98, .22, .18, '#93C47D', 8],
  ];
  for (const [x, y, rx, ry, col, seed] of blots) washBlob(g, x * W, y * H, rx * S * 1.4, ry * S * 1.4, col, { seed, alpha: .02, layers: 26, vari: .24 });
}

/** 여백 낙서: 흔드는 손 두 개와 작은 별. 선은 rough 필터로 떨린다 */
function buildDoodles() {
  const host = $('doodles');
  const hand = (style, flip, cls) => `<svg viewBox="0 0 130 150" width="74" height="86" style="${style}" fill="none" stroke="#2E2620" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#rough)" opacity=".55">
    <g transform="${flip ? 'translate(130 0) scale(-1 1)' : ''}"><g class="wig ${cls}"><use href="#handShape"/></g></g></svg>`;
  host.innerHTML = hand('left:22px;top:44%', false, '') + hand('right:26px;bottom:96px', true, 'b') +
    `<svg viewBox="0 0 40 40" width="34" height="34" style="left:44px;top:96px" fill="none" stroke="#2E2620" stroke-width="2.2" stroke-linecap="round" filter="url(#rough)" opacity=".5"><path d="M20 4 L23 16 L35 20 L23 24 L20 36 L17 24 L5 20 L17 16 Z"/></svg>` +
    `<svg viewBox="0 0 40 40" width="26" height="26" style="right:180px;top:64px" fill="none" stroke="#2E2620" stroke-width="2.2" stroke-linecap="round" filter="url(#rough)" opacity=".45"><path d="M8 28 q6 -18 14 -10 q8 8 12 -10"/></svg>`;
}
const SCENE_COLOR = ['#FFC83D', '#93C47D', '#F2937A', '#A9CFEA', '#7CC6A4', '#FFC83D', '#F2937A'];

async function boot() {
  paintBackground(); buildDoodles();
  let bgT; addEventListener('resize', () => { clearTimeout(bgT); bgT = setTimeout(paintBackground, 250); });
  try { await Promise.race([Promise.all(['700 64px "Gowun Batang"', '64px "Gowun Batang"', '20px "Gowun Dodum"'].map(f => document.fonts.load(f, '가나다123'))), new Promise(r => setTimeout(r, 3000))]); } catch { }
  const data = await loadData();
  const stage = new Stage($('stage'));
  const typecase = new TypeCase(data.atlas);
  const fx = new Sparkles(stage.scene);
  const el = { title: $('title'), h: $('titleH'), p: $('titleP'), cap: $('caption'), fig: $('figure'), figBig: $('figBig'), figLab: $('figLab'),
    fill: $('barFill'), knob: $('barKnob'), play: $('play'), bar: $('bar'), action: $('action'), search: $('search'), q: $('q'), qOut: $('qOut'), card: $('card'), dots: $('dots'),
    wipeSvg: $('wipeSvg'), wipeLabel: $('wipeLabel'), rough: $('roughNoise') };

  // ---------- HUD ----------
  const fig = { tpl: null, nums: [], from: [], p: 1, lab: '' };
  let actionFn = null;
  const hud = {
    title(h, p) {
      if (!h) { el.title.classList.add('hidden'); return; }
      el.title.classList.remove('hidden'); el.h.innerHTML = h; el.p.innerHTML = p || ''; wrapChars(el.h, .06, .25);
      el.p.style.animation = 'none'; void el.p.offsetWidth; el.p.style.animation = '';
    },
    caption(text) {
      text = text || '';
      if (el.cap.dataset.t !== text) { el.cap.dataset.t = text; el.cap.innerHTML = text; if (text) wrapChars(el.cap); }
      el.cap.classList.toggle('hide', !text);
    },
    figure(big, lab) {
      if (!big) { el.fig.classList.remove('show'); fig.tpl = null; fig.nums = []; fig.src = null; return; }
      if (big !== fig.src) {
        const nums = [...big.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m => m[0]);
        fig.from = fig.nums.length === nums.length ? fig.nums.map(n => parseFloat(n.replace(/,/g, ''))) : nums.map(() => 0);
        fig.nums = nums; fig.tpl = big.replace(/\d[\d,]*(?:\.\d+)?/g, '\u0000'); fig.src = big; fig.p = 0;
        if (big.includes('/')) { fig.p = 1; el.figBig.innerHTML = big; } // 날짜는 세지 않는다
        el.figLab.textContent = lab || '';
        el.fig.classList.remove('bump'); void el.fig.offsetWidth; el.fig.classList.add('bump');
      }
      el.fig.classList.add('show');
    },
    action(label, fn) {
      if (!label) { el.action.classList.remove('show'); actionFn = null; return; }
      if (el.action.textContent !== label) el.action.textContent = label;
      actionFn = fn; el.action.classList.add('show');
    },
    search(on) { el.search.classList.toggle('show', !!on); if (!on && document.activeElement === el.q) el.q.blur(); },
    cards(list) {
      const box = $('cards');
      if (!list) { box.hidden = true; box.innerHTML = ''; return; }
      box.innerHTML = list.map((c, i) => `<button class="fc" type="button" style="--c:${c.c};animation-delay:${.35 + i * .15}s" aria-label="${c.l}, 눌러서 뒤집기">
        <div class="in"><div class="f"><div class="n${c.n.replace(/<[^>]+>/g, '').length > 9 ? ' long' : ''}">${c.n}</div><div class="l">${c.l}</div><div class="hint">눌러서 뒤집기</div></div><div class="b">${c.back}</div></div></button>`).join('');
      box.hidden = false;
      box.querySelectorAll('.fc').forEach(b => b.onclick = () => {
        b.classList.toggle('flip');
        const r = b.getBoundingClientRect(); fx.burst(screenToWorld(r.left + r.width / 2, r.top + r.height), 10);
      });
    },
  };
  // 화면 좌표 → 카메라 앞 6m 지점 (HTML 위에서 반짝이를 터뜨릴 때)
  const screenToWorld = (x, y) => new THREE.Vector3((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, .5).unproject(stage.camera).sub(stage.camera.position).normalize().multiplyScalar(6).add(stage.camera.position);
  let toastTimer;
  const toast = msg => { const e = $('toast'); e.textContent = msg; e.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('show'), 1600); };
  let auto = false;
  el.action.onclick = () => actionFn && actionFn();
  function tickFigure(dt) {
    if (!fig.tpl || fig.p >= 1) return;
    fig.p = Math.min(1, fig.p + dt / (reduced ? .01 : .8));
    const k = 1 - Math.pow(1 - fig.p, 3); let i = 0;
    el.figBig.innerHTML = fig.tpl.replace(/\u0000/g, () => {
      const s = fig.nums[i], to = parseFloat(s.replace(/,/g, '')), from = fig.from[i++] ?? 0, dec = (s.split('.')[1] || '').length;
      const v = from + (to - from) * k; let out = v.toFixed(dec);
      if (s.includes(',')) out = Number(out).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      return out;
    });
  }

  // ---------- 장면 ----------
  const ctx = { THREE, stage, typecase, data, hud, fx, prevT: 0, searchActive: false, seek: v => { t = clamp(v, 0, cur.duration); stage.userHold = 0; } };
  window.__app = ctx;
  const scenes = [titleScene(ctx), composeScene(ctx), earsScene(ctx), measureScene(ctx), sentenceScene(ctx), baselineScene(ctx), outroScene(ctx)];
  scenes.forEach((s, i) => { const b = document.createElement('button'); b.setAttribute('aria-label', `${i + 1}. ${s.name}`); b.title = s.name; b.onclick = () => go(i); el.dots.append(b); });

  let si = 0, t = 0, playing = true, cur = null, since = 0;
  function enter(i, at = 0) {
    if (cur) cur.exit?.(ctx);
    si = clamp(i, 0, scenes.length - 1); cur = scenes[si]; t = at; ctx.prevT = at; since = 0;
    stage.root.clear(); fx.clear(); closeCard();
    hud.caption(''); hud.figure(null); hud.title(null); hud.action(null); hud.search(false);
    el.q.value = ''; el.qOut.textContent = ''; ctx.searchActive = false;
    stage.disc.position.set(0, 0, 0); stage.disc.scale.set(1, 1, 1); stage.disc.visible = true;
    typecase.group.position.set(0, 0, 0); typecase.group.rotation.set(0, 0, 0); typecase.group.visible = true;
    cur.enter(ctx);
    stage.userHold = 0;
    [...el.dots.children].forEach((b, k) => { b.classList.toggle('on', k === si); b.classList.toggle('done', k < si); });
    for (const s of el.bar.querySelectorAll('s')) s.remove();
    for (const c of cur.cues) { const s = document.createElement('s'); s.style.left = (100 * c.at / cur.duration) + '%'; el.bar.append(s); }
    applyStatic(); cur.update(t, 0, ctx);
  }

  // 붓질 전환 (시안의 brush): 큰 붓이 세 번 지나가며 화면을 덮고, 계속 지나가며 다음 장면을 드러낸다.
  // 새 장면은 연필 스케치로 시작해서 붓이 지나간 뒤 물감이 번지며 칠해진다(G.scene).
  let tr = null;
  function go(i) {
    if (tr || i < 0 || i >= scenes.length || i === si) return;
    if (reduced) { enter(i); return; }
    const W = innerWidth, H = innerHeight, sw = H * .48, ys = [H * .17, H * .5, H * .83];
    const cols = ['#FFE08A', SCENE_COLOR[i], '#FFE08A'];
    el.wipeSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    // 붓 한 번 = 물감 띠 + 그 안의 붓털 자국(옅은 줄 4개)
    el.wipeSvg.innerHTML = `<g filter="url(#brushEdge)">${ys.map((y, k) => {
      const a = k % 2 ? W + sw : -sw, b = k % 2 ? -sw : W + sw, d = k % 2 ? -1 : 1;
      const path = `M${a} ${y + 24 * d} C ${W * .3} ${y - 50}, ${W * .7} ${y + 50}, ${b} ${y - 24 * d}`;
      const attr = 'pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" fill="none" stroke-linecap="round"';
      const streaks = [-.3, -.12, .1, .27].map((o, j) => `<path transform="translate(0 ${o * sw})" d="${path}" ${attr} stroke="${j % 2 ? '#FFFDF6' : '#2E2620'}" stroke-opacity="${j % 2 ? .28 : .05}" stroke-width="${sw * [.035, .02, .05, .025][j]}"/>`).join('');
      return `<g data-k="${k}"><path d="${path}" ${attr} stroke="${cols[k]}" stroke-width="${sw}"/>${streaks}</g>`;
    }).join('')}</g>`;
    tr = { p: 0, to: i, swapped: false, els: [...el.wipeSvg.querySelectorAll('g[data-k]')] };
    el.wipeLabel.innerHTML = `<small>${i + 1} / ${scenes.length}</small>${scenes[i].name}`;
  }
  function tickWipe(dt) {
    if (!tr) return;
    tr.p = Math.min(1, tr.p + dt / 1.6);
    const p = tr.p;
    tr.els.forEach((g, k) => {
      const o = p < .5 ? 1 - easeInOut(span(p, k * .07, .34 + k * .07)) : -easeInOut(span(p, .56 + k * .07, .86 + k * .07));
      for (const e of g.children) e.setAttribute('stroke-dashoffset', o.toFixed(4));
    });
    const lp = span(p, .3, .44) * (1 - span(p, .58, .7));
    el.wipeLabel.style.opacity = lp; el.wipeLabel.style.transform = `translate(-50%,-50%) rotate(${-1.5 + 1.5 * lp}deg) translateY(${(1 - easeOut(span(p, .3, .48))) * 14}px)`;
    if (p >= .5 && !tr.swapped) { tr.swapped = true; enter(tr.to); }
    if (p >= 1) { tr = null; el.wipeSvg.innerHTML = ''; }
  }

  function applyStatic() {
    const cam = cur.camera; let a = cam[0];
    for (const k of cam) if (k.at <= t) a = k;
    const b = cam[Math.min(cam.length - 1, cam.indexOf(a) + 1)];
    if (stage.userHold <= 0) {
      const dur = b.dur ?? 2.5, k = b === a ? 1 : easeInOut(clamp((t - b.at + dur) / dur));
      const tgt = a.tgt.map((v, i) => lerp(v, b.tgt[i], k));
      // 장면에 들어오면 카메라가 조금 먼 곳에서 스르륵 다가간다
      const dolly = reduced ? 1 : 1 + .32 * (1 - (1 - Math.pow(1 - clamp(since / 1.6), 3)));
      stage.camera.position.fromArray(a.pos.map((v, i) => tgt[i] + (lerp(v, b.pos[i], k) - tgt[i]) * dolly));
      stage.controls.target.fromArray(tgt);
    }
    let text = ''; for (const c of cur.cues) if (c.at <= t) text = c.text;
    hud.caption(text);
    el.fill.style.width = el.knob.style.left = (100 * clamp(t / cur.duration)) + '%';
  }

  // ---------- 조작 ----------
  const togglePlay = () => { playing = !playing; el.play.textContent = playing ? '일시정지' : '재생'; };
  addEventListener('keydown', e => {
    if (e.target === el.q) { if (e.key === 'Escape') el.q.blur(); return; }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(si + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (t > 1.5) enter(si, 0); else go(si - 1); }
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Escape') closeCard();
    else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
    else if (e.key === 'h' || e.key === 'H') { document.body.classList.toggle('nohud'); }
    else if (e.key === 'a' || e.key === 'A') { auto = !auto; toast(auto ? '자동 넘김 켜짐 · 장면이 끝나면 다음으로' : '자동 넘김 꺼짐'); }
    else { const n = Number(e.key); if (n >= 1 && n <= scenes.length) go(n - 1); }
    if (e.key === 'Enter' && e.target.classList?.contains('fc')) return;
  });
  el.play.onclick = togglePlay; $('prev').onclick = () => go(si - 1); $('next').onclick = () => go(si + 1);
  const seekBar = e => { const r = el.bar.getBoundingClientRect(); ctx.seek(clamp((e.clientX - r.left) / r.width) * cur.duration); };
  el.bar.addEventListener('pointerdown', e => { seekBar(e); const mv = ev => seekBar(ev); addEventListener('pointermove', mv); addEventListener('pointerup', () => removeEventListener('pointermove', mv), { once: true }); });

  // 단어 찾기
  el.q.addEventListener('input', () => {
    const q = el.q.value.trim();
    if (!q) { ctx.searchActive = false; el.qOut.textContent = ''; typecase.highlight([]); return; }
    const toks = typecase.search(q); ctx.searchActive = true;
    typecase.highlight(toks); el.qOut.textContent = toks.length ? `토큰 ${toks.length}개` : '없어요';
    if (toks.length) for (const tk of toks.slice(0, 8)) fx.burst(typecase.group.localToWorld(typecase.cells[tk].position.clone()), 5, { speed: 1.2 });
  });

  // 스티커·캐릭터 누르기
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const canvas = stage.renderer.domElement;
  function pick(e) {
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    const out = {};
    if (typecase.group.parent && typecase.group.visible) { const h = ray.intersectObject(typecase.tiles)[0]; if (h && typecase.cells[h.instanceId].userData.visible) out.tile = { id: h.instanceId, d: h.distance }; }
    const actors = []; stage.root.traverse(o => { const a = o.userData.actor; if (a && o.visible && a.mats.shirt.opacity > .6) actors.push(o); }); // 흐려진 캐릭터는 누를 수 없다
    const ha = ray.intersectObjects(actors, true)[0];
    if (ha) { let o = ha.object; while (o && !o.userData.actor) o = o.parent; if (o) out.actor = { a: o.userData.actor, d: ha.distance }; }
    if (out.tile && out.actor) { if (out.tile.d < out.actor.d) delete out.actor; else delete out.tile; }
    const hov = []; stage.root.traverse(o => { if (o.userData.hover && o.visible) hov.push(o); });
    const hh = hov.length ? ray.intersectObjects(hov, false)[0] : null; if (hh) out.hover = hh.object;
    return out;
  }
  let down = null, hovered = null;
  canvas.addEventListener('pointermove', e => {
    const h = pick(e); typecase.hover(h.tile ? h.tile.id : -1);
    if (h.hover !== hovered) { hovered?.userData.hover?.(false); hovered = h.hover || null; hovered?.userData.hover?.(true); }
    canvas.classList.toggle('point', !!(h.tile || h.actor || h.hover));
  });
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
    down = null; const h = pick(e);
    if (h.tile) openCard(h.tile.id, e.clientX, e.clientY);
    else if (h.actor) { const a = h.actor.a; a.hop(); fx.burst(a.body.localToWorld(a.headCenter.clone().add(new THREE.Vector3(0, .5, 0))), 16, { colors: [COLOR.coral, COLOR.yellow, COLOR.mint] }); }
    else closeCard();
  });

  // 토큰 카드
  let cardTimer = null;
  function closeCard() { el.card.hidden = true; clearInterval(cardTimer); }
  function openCard(tk, x, y) {
    const A = data.atlas, words = (A.words[tk] || []).slice(0, 4);
    el.card.innerHTML = `<div class="top"><span class="no">#${tk}</span><button class="x" type="button" aria-label="닫기">✕</button></div>
      <canvas width="520" height="520" aria-label="토큰 ${tk}의 0.13초 동작"></canvas>
      <div class="use">단어 클립 <b>${(A.useWord?.[tk] ?? 0).toLocaleString()}</b> · 문장 클립 <b>${(A.useSen?.[tk] ?? 0).toLocaleString()}</b></div>
      ${A.rest[tk] ? '<div class="rest">손을 내린 대기 · 공통 자세 조각이에요</div>' : !words.length ? '<div class="rest">특정 단어에 몰리지 않고 여러 단어에 조금씩 나와요</div>' : words.map(([w, s]) => `<div class="w"><b>${w}</b><span><i style="width:${Math.round(s * 100)}%"></i></span><em>${Math.round(s * 100)}%</em></div>`).join('')}`;
    el.card.hidden = false;
    const W = 300, H = 470; el.card.style.left = clamp(x - W / 2, 16, innerWidth - W - 16) + 'px'; el.card.style.top = clamp(y - H - 20, 70, innerHeight - H - 16) + 'px';
    el.card.querySelector('.x').onclick = closeCard;
    const c = el.card.querySelector('canvas'), g = c.getContext('2d'); let f = 0;
    const draw = () => { g.clearRect(0, 0, 520, 520); drawGlyph(g, A.x[tk][f], 0, 0, 520, A.lim); f = (f + 1) % 4; };
    draw(); clearInterval(cardTimer); cardTimer = setInterval(draw, 133);
    typecase.hover(tk);
    fx.burst(typecase.group.localToWorld(typecase.cells[tk].position.clone()), 12);
  }

  // 주소의 #장면@초 로 바로 시작 (예: #3@7.5)
  const m = /#(\d+)(?:@([\d.]+))?/.exec(location.hash);
  enter(m ? Number(m[1]) - 1 : 0, m && m[2] ? Number(m[2]) : 0);
  addEventListener('hashchange', () => { const h = /#(\d+)(?:@([\d.]+))?/.exec(location.hash); if (h) enter(Number(h[1]) - 1, h[2] ? Number(h[2]) : 0); });
  $('loading').classList.add('done');

  const clock = new THREE.Clock(); let boilAcc = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), window.__maxDt || .05);   // __maxDt: 숨은 창에서 확인할 때 실제 시간으로
    ctx.prevT = t;
    if (playing && !tr) t = Math.min(cur.duration, t + dt);
    if (auto && playing && !tr && t >= cur.duration && si < scenes.length - 1) go(si + 1);
    since += dt;
    // 새 장면: 연필 스케치로 놓였다가 물감이 번지며 칠해진다. 살짝 다가오기만 한다.
    G.scene.value = reduced ? 1 : smooth(span(since, .35, 1.9));
    stage.root.scale.setScalar(reduced ? 1 : .96 + .04 * easeOut(clamp(since / 1.2)));
    // 선 떨림: 0.16초마다 시드를 바꾼다 (3D 먹선 + SVG 낙서)
    if (!reduced && (boilAcc += dt) > .16) { boilAcc = 0; G.boil.value = G.boil.value % 4 + 1; el.rough.setAttribute('seed', G.boil.value); }
    typecase.update(dt); fx.update(dt);
    stage.root.traverse(o => o.userData.actor?.tick(dt));
    cur.update(t, dt, ctx);
    applyStatic(); tickFigure(dt); tickWipe(dt);
    stage.update(dt);
  }
  frame();
}

boot().catch(err => { console.error(err); $('loading').textContent = '불러오기 실패: ' + err.message; });
