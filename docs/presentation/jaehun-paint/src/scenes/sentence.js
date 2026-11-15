import * as THREE from 'three';
import { Actor, FatLines } from '../skeleton.js';
import { BarChart } from '../bars.js';
import { span, easeInOut, lerp, COLOR, makeLabel } from '../util.js';

/**
 * 장면 5 · 핵심 발견. 같은 문장 「여의도 곳 방법」을 세 캐릭터가 동시에 한다.
 * 왼쪽 회색 옷(덜 칠해짐): 단어로만 배운 자모표(E4b) 복원, 가운데 하늘색: 실제 사람, 오른쪽 노란 옷: 단어+문장(E5) 복원.
 * 1.93초에서 멈추고 셋이 모여 왼팔을 비교한다. 그다음 다섯 구간의 손 오차가 쌍으로 솟는다.
 */
export function sentenceScene(ctx) {
  const { stage, data, fx } = ctx;
  const clip = data.clips['SEN1384_REAL03'];
  const N = clip.frames, SPEED = .5;
  const F_HOLD = 58;
  const T_HOLD = F_HOLD / 30 / SPEED;
  const HOLD = 4.5;
  const T_END = T_HOLD + HOLD + (N - F_HOLD) / 30 / SPEED;
  const T_BARS = T_END + 1.5, DUR = T_BARS + 15;
  const X = 2.4;
  let actors = [], labels = [], mmLabels = [], chart, wiresL, wiresR;
  const posL = new Float32Array(8 * 6), posR = new Float32Array(8 * 6);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const LEFT_ARM = [5, 6, 7, 13, 17, 21, 25, 29];
  const crossed = (x, t) => ctx.prevT < x && t >= x;
  const SEG = [
    { label: '단어 클립', e4b: 27.1, e5: 28.4 },
    { label: '단어 구간', e4b: 37.0, e5: 38.2 },
    { label: '문장 클립', e4b: 37.3, e5: 28.1 },
    { label: '문장 속 단어', e4b: 50.6, e5: 33.7 },
    { label: '단어 사이', e4b: 52.7, e5: 34.3 },
  ];
  const frameAt = t => t < T_HOLD ? t * 30 * SPEED : t < T_HOLD + HOLD ? F_HOLD : Math.min(N - 1, F_HOLD + (t - T_HOLD - HOLD) * 30 * SPEED);

  return {
    id: 'sentence', name: '문장도 배워야 해요',
    duration: DUR,
    camera: [
      { at: 0, pos: [0, .3, 10.5], tgt: [0, -.4, 0] },
      { at: T_HOLD + 1.6, pos: [-.6, .3, 7.8], tgt: [.4, -.2, 0], dur: 1.6 },
      { at: T_HOLD + HOLD + 1.5, pos: [0, .3, 10.5], tgt: [0, -.4, 0], dur: 1.5 },
      { at: T_BARS + 2, pos: [1.6, 1.6, 11.5], tgt: [1.6, .6, -1.5], dur: 2.5 },
      { at: T_BARS + 10, pos: [4.2, 2, 10.5], tgt: [1.8, .6, -1.5], dur: 6 },
    ],
    cues: [
      { at: 0, text: '문장 <em>「여의도 곳 방법」</em>, 평가 사람 REAL03. 가운데가 실제 사람이에요' },
      { at: 2, text: '왼쪽은 <em>단어로만</em> 배운 자모표, 오른쪽은 <em>단어 + 문장</em>으로 배운 자모표의 복원' },
      { at: T_HOLD, text: '<em>1.93초</em>에서 멈춰 봐요. 단어로만 배운 쪽은 왼팔 모양이 달라요' },
      { at: T_HOLD + HOLD, text: '문장에서는 손이 빠르고 앞뒤 단어와 이어져요. 단어 클립에선 못 본 자세예요' },
      { at: T_BARS, text: '실험 2 · 손 오차 mm. 회색이 단어로만, <em>노란색이 단어 + 문장</em>' },
      { at: T_BARS + 4.5, text: '단어는 1.3mm만 나빠지고, 문장 속 단어 <em>50.6 → 33.7</em>, 단어 사이 <em>52.7 → 34.3</em>' },
      { at: T_BARS + 9, text: '그래서 v1 후보는 <em>E5</em>. 자모표도 문장을 보고 배워야 해요' },
    ],
    enter() {
      const e4b = new Actor(clip.recon_e4b, { tone: 'e4b' });
      const orig = new Actor(clip.orig, { tone: 'orig' });
      const e5 = new Actor(clip.recon_e5, { tone: 'e5' });
      e4b.group.position.x = -X; e5.group.position.x = X;
      actors = [e4b, orig, e5];
      for (const ac of actors) stage.root.add(ac.group);
      stage.disc.scale.set(1.75, 1, 1.1);
      e4b.setPaint(.72);   // 단어로만 배운 쪽은 덜 칠해진 그림
      labels = [['단어로만 · E4b', -X, '#CFC6B6'], ['실제 사람', 0, '#A9CFEA'], ['단어 + 문장 · E5', X, '#FFC83D']].map(([s, x, wash]) => {
        const l = makeLabel(s, { scale: .34, wash }); l.position.set(x, -2.3, .7); stage.root.add(l); return l;
      });
      mmLabels = [[clip.handMm_e4b, '#CFC6B6'], [clip.handMm_e5, '#FFC83D']].map(([v, wash]) => {
        const l = makeLabel(`손 ${v.toFixed(1)} mm`, { scale: .26, wash, line: true }); l.visible = false; stage.root.add(l); return l;
      });
      const mk = () => { const w = new FatLines(8, { color: COLOR.coral, width: 2.4 }); stage.root.add(w.obj); return w; };
      wiresL = mk(); wiresR = mk();
      chart = new BarChart({
        groups: SEG.map(s => ({ label: s.label, bars: [{ label: '', value: s.e4b, color: COLOR.e4b }, { label: '', value: s.e5, color: COLOR.yellow }] })),
        unit: .062, barW: .4, gap: .16, groupGap: .7, valueScale: .24,
      });
      chart.group.position.set(-1, -1.88, -1.5); chart.group.visible = false; // 오른쪽 숫자 카드와 겹치지 않게 왼쪽으로
      stage.root.add(chart.group);
    },
    update(t) {
      const f = frameAt(t);
      for (const ac of actors) ac.setFrame(f);
      const hold = t >= T_HOLD && t < T_HOLD + HOLD;
      for (let i = 0; i < LEFT_ARM.length; i++) {
        const j = LEFT_ARM[i];
        actors[1].jointWorld(j, a); actors[0].jointWorld(j, b); posL.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
        actors[1].jointWorld(j, a); actors[2].jointWorld(j, b); posR.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      }
      wiresL.update(posL); wiresR.update(posR);
      wiresL.obj.visible = wiresR.obj.visible = hold && t > T_HOLD + .8;
      const k = easeInOut(span(t, T_HOLD + .3, T_HOLD + 1.6)) * (1 - easeInOut(span(t, T_HOLD + HOLD, T_HOLD + HOLD + 1.2)));
      actors[0].group.position.x = -lerp(X, .9, k); actors[2].group.position.x = lerp(X, .9, k);
      labels[0].position.x = actors[0].group.position.x; labels[2].position.x = actors[2].group.position.x;
      for (const l of labels) l.visible = t < T_BARS - .5 && k < .2;
      mmLabels[0].visible = mmLabels[1].visible = hold && t > T_HOLD + 1.2;
      mmLabels[0].position.set(actors[0].group.position.x - .7, -1.2, .9); mmLabels[1].position.set(actors[2].group.position.x + .7, -1.2, .9);
      if (crossed(T_HOLD + .1, t)) { fx.burst(actors[1].jointWorld(7), 14, { colors: [COLOR.coral, COLOR.yellow] }); fx.bloom(actors[1].jointWorld(7), COLOR.coral, .9); }

      const side = easeInOut(span(t, T_BARS - 1, T_BARS + .8));
      for (const ac of actors) { ac.group.position.z = -lerp(0, 2.5, side); ac.group.position.y = lerp(0, 1.4, side); ac.setOpacity(1 - side); ac.group.visible = side < .98; }
      stage.disc.visible = side < .5;
      chart.group.visible = t > T_BARS - .3;
      chart.grow(span(t, T_BARS + .3, T_BARS + 4));
      if (t > T_BARS + 4.5) ctx.hud.figure('52.7 <small>→</small> 34.3<small>mm</small>', '단어 사이 전환 · 처음 보는 사람');
      else ctx.hud.figure(null);
    },
    exit() { wiresL.dispose(); wiresR.dispose(); },
  };
}
