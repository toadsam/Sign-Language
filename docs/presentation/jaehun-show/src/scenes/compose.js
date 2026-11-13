import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Actor } from '../skeleton.js';
import { CELL } from '../typecase.js';
import { span, smooth, easeOut, easeInOut, backOut, lerp, toWorld, toon, COLOR } from '../util.js';

/**
 * 장면 2 · 동작 → 스티커.
 * 「인력」이 천천히 재생되고, 0.13초마다 두 손 사이에서 스티커 하나가 퐁 튀어나와 아래 줄에 붙는다.
 * 줄이 다 차면 스티커판이 내려오고, 스티커들이 저마다의 칸으로 돌아가 반짝인다.
 */
export function composeScene(ctx) {
  const { stage, typecase, data, fx } = ctx;
  const clip = data.clips['WORD0773_REAL03'];
  const SPEED = .45;
  const [s0, s1] = clip.tokenFrames;
  const nTok = clip.tokens.length;
  const T_PLAY = (s1 - s0) / 30 / SPEED;
  const T_CASE = T_PLAY + 2.2;
  const T_FLY = T_CASE + 2.4;
  const DUR = T_FLY + 7;
  const SORT_SCALE = 1.5;
  const SLOT = CELL * SORT_SCALE + .05;

  let actor, sorts = [], spawn = [], slots = [], usedN = -1;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), ctrl = new THREE.Vector3();
  const tokenTime = k => (k * 4 + 2) / 30 / SPEED;
  const crossed = (a, t) => ctx.prevT < a && t >= a;

  return {
    id: 'compose', name: '동작이 스티커가 돼요',
    duration: DUR,
    camera: [
      { at: 0, pos: [0, -.2, 9.6], tgt: [0, -.7, .4] },
      { at: T_PLAY * .9, pos: [-1.6, -.5, 10.2], tgt: [0, -.95, .6], dur: T_PLAY * .9 },
      { at: T_CASE + 1.2, pos: [0, .5, 13.5], tgt: [0, -.3, -.6], dur: 2.4 },
      { at: T_FLY + 2.5, pos: [2.6, 1.3, 10.8], tgt: [0, .3, -1.6], dur: 3 },
    ],
    cues: [
      { at: 0, text: '실제 사람의 수어, 단어 <em>「인력」</em> 4.5초' },
      { at: 1.4, text: '<em>0.13초</em>마다 가장 비슷한 동작 스티커 하나를 골라요' },
      { at: T_PLAY + .3, text: `움직임이 스티커 <code>${nTok}</code>장이 됐어요` },
      { at: T_CASE + .4, text: '스티커는 딱 <em>512</em>종류. 수어 8만 클립을 이걸로 다 써요' },
      { at: T_FLY + .6, text: '같은 스티커는 판의 같은 칸으로 돌아가요' },
      { at: T_FLY + 3.6, text: '받아쓰기 모델은 좌표 375개 대신 <em>512개 중 하나</em>만 고르면 돼요' },
    ],
    enter() {
      actor = new Actor(clip.orig, { tone: 'orig' });
      stage.root.add(actor.group);
      typecase.reset();
      typecase.group.position.set(0, 7, -2.4);
      stage.root.add(typecase.group);
      const rail = new THREE.Mesh(new RoundedBoxGeometry(nTok * SLOT + .4, .05, .3, 3, .02), toon(COLOR.lilac));
      rail.position.set(0, -1.87, 1.9); rail.receiveShadow = true;
      stage.root.add(rail);
      sorts = []; spawn = []; slots = []; usedN = -1;
      for (let k = 0; k < nTok; k++) {
        const f = Math.min(clip.frames - 1, s0 + k * 4 + 2);
        const P = clip.orig[f];
        spawn.push(toWorld(P[34], new THREE.Vector3()).lerp(toWorld(P[13], new THREE.Vector3()), .5));
        slots.push(new THREE.Vector3((k - (nTok - 1) / 2) * SLOT, -1.84 + CELL * SORT_SCALE * .55, 1.9));
        const sort = typecase.makeSort(clip.tokens[k]);
        sort.visible = false; stage.root.add(sort); sorts.push(sort);
      }
    },
    update(t) {
      actor.setFrame(s0 + Math.min(s1 - s0 - 1, t * 30 * SPEED));
      actor.setOpacity(t > T_CASE + 1 ? 1 - .5 * smooth(span(t, T_CASE + 1, T_CASE + 2.4)) : 1);
      stage.disc.visible = t < T_CASE + 1.5;

      const down = backOut(span(t, T_CASE, T_CASE + 1.6));
      typecase.group.position.y = lerp(7, .65, down);
      typecase.group.visible = t > T_CASE - .1;

      const used = new Set();
      for (let k = 0; k < nTok; k++) {
        const sort = sorts[k], tk = tokenTime(k);
        if (t < tk) { sort.visible = false; continue; }
        sort.visible = true;
        const p1 = span(t, tk, tk + .8);
        const land2 = T_FLY + k * .06 + 1.1;
        const p2 = span(t, T_FLY + k * .06, land2);
        if (crossed(tk, t)) fx.burst(spawn[k], 6, { speed: 1.3 });
        if (p2 <= 0) {
          const e = easeOut(p1);
          ctrl.copy(spawn[k]).lerp(slots[k], .5); ctrl.y += 1.2; ctrl.z += .7;
          tmp.copy(spawn[k]).multiplyScalar((1 - e) * (1 - e)).addScaledVector(ctrl, 2 * (1 - e) * e).addScaledVector(slots[k], e * e);
          sort.position.copy(tmp);
          sort.scale.setScalar(SORT_SCALE * backOut(p1));
          sort.rotation.set(lerp(-1.2, 0, e), lerp(1.4, 0, e) * (k % 2 ? 1 : -1), lerp(.6, 0, e) * (k % 2 ? -1 : 1));
        } else {
          const e = easeInOut(p2), home = typecase.cells[clip.tokens[k]].userData.home;
          tmp2.copy(home).add(typecase.group.position); tmp2.z += .12;
          ctrl.copy(slots[k]).lerp(tmp2, .5); ctrl.y += 1.6; ctrl.z += 1.4;
          tmp.copy(slots[k]).multiplyScalar((1 - e) * (1 - e)).addScaledVector(ctrl, 2 * (1 - e) * e).addScaledVector(tmp2, e * e);
          sort.position.copy(tmp);
          sort.scale.setScalar(lerp(SORT_SCALE, 1.16, e));
          sort.rotation.set(0, e * Math.PI * 2, 0);
          if (crossed(land2, t)) fx.burst(tmp2, 7, { speed: 1.4 });
          if (p2 >= 1) { used.add(clip.tokens[k]); sort.visible = false; }
        }
      }
      if (!ctx.searchActive && used.size !== usedN) { usedN = used.size; typecase.highlight([...used]); }
      ctx.hud.search(t > T_FLY + 3.6);
      if (t > T_PLAY + .3 && t < T_CASE + .3) ctx.hud.figure(`${nTok}<small>장</small>`, '단어 「인력」 움직임 구간');
      else if (t >= T_CASE + .3 && t < T_FLY + 3.6) ctx.hud.figure('512<small>종</small>', '스티커판 · 32 × 16');
      else if (t >= T_FLY + 3.6) ctx.hud.figure(`${new Set(clip.tokens).size}<small>종</small>`, `스티커 ${nTok}장 중 서로 다른 것`);
      else ctx.hud.figure(null);
    },
    exit() { },
  };
}
