import * as THREE from 'three';
import { Actor, Tracing, FatLines } from '../skeleton.js';
import { BarChart } from '../bars.js';
import { span, easeInOut, lerp, COLOR } from '../util.js';

/**
 * 장면 4 · 어떻게 쟀나, 그리고 실험 1.
 * 수채로 칠한 실제 사람 위에, 자모표로 되돌린 동작을 연필 선으로 따라 그린다. 손 관절 42개 사이를 산호색 실로 잇는다.
 * 그 평균이 복원 오차 mm. 이어서 단어 자모표 네 실험의 손 오차 막대가 퐁퐁 솟는다.
 */
export function measureScene(ctx) {
  const { stage, data } = ctx;
  const clip = data.clips['WORD0773_REAL03'];
  const [s0] = clip.tokenFrames; const N = clip.recon_e5.length;
  const T_BARS = 9.5, DUR = 24, SPEED = .55;
  let orig, recon, wires, chart;
  const pos = new Float32Array(42 * 2 * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const EXPS = [
    { label: 'E1 · 기본', value: 28.1, color: COLOR.sky },
    { label: 'E2 · 얼굴 포함', value: 31.7, color: COLOR.e4b },
    { label: 'E4a · 1024개', value: 29.9, color: COLOR.e4b },
    { label: 'E4b · 20만 회', value: 27.0, color: COLOR.yellow },
  ];

  return {
    id: 'measure', name: '얼마나 닮았는지 재요',
    duration: DUR,
    camera: [
      { at: 0, pos: [2.6, .3, 8.6], tgt: [0, -.35, .3] },
      { at: 6, pos: [-2.2, .1, 7.6], tgt: [0, -.35, .4], dur: 6 },
      { at: T_BARS + 1.5, pos: [-.4, .9, 10.4], tgt: [-.6, -.15, -1], dur: 2.5 },
      { at: T_BARS + 9, pos: [2.2, 1.3, 9.6], tgt: [-.3, -.1, -1], dur: 5 },
    ],
    cues: [
      { at: 0, text: '물감으로 칠한 쪽이 실제 사람, <em>연필 선</em>이 스티커로 바꿨다 되돌린 동작이에요' },
      { at: 2.5, text: '손 관절 42개가 서로 몇 mm 어긋나는지 재요. 그 평균이 <em>복원 오차</em>' },
      { at: 6, text: '학습에 없던 사람으로만 재요. 생성 품질이 아니라 이 방식이 낼 수 있는 <em>최선</em>이에요' },
      { at: T_BARS, text: '실험 1 · 단어 48,000클립으로 자모표 네 가지. 처음 보는 사람의 손 오차 mm' },
      { at: T_BARS + 4, text: '얼굴 70점까지 넣으면 손이 <em>3.6mm 나빠져요</em>. 얼굴은 빼요' },
      { at: T_BARS + 7.5, text: '1024개로 늘려도 안 좋아져요. <em>512개</em>로 가요' },
      { at: T_BARS + 11, text: '학습을 20만 번으로 늘린 E4b가 가장 좋았어요. 512개 전부 골고루 쓰여요' },
    ],
    enter() {
      orig = new Actor(clip.orig.slice(s0, s0 + N), { tone: 'orig' });
      recon = new Tracing(clip.recon_e5, { color: COLOR.ink, width: 2.4 });
      stage.root.add(orig.group, recon.group);
      wires = new FatLines(42, { color: COLOR.coral, width: 2.2 });
      stage.root.add(wires.obj);
      chart = new BarChart({ groups: [{ label: '', bars: EXPS }], unit: .085, barW: .6, gap: .24 });
      chart.group.position.set(0, -1.88, -1.2); chart.group.visible = false;
      stage.root.add(chart.group);
    },
    update(t) {
      const f = (t * 30 * SPEED) % N;
      orig.setFrame(f); recon.setFrame(f);
      let sum = 0;
      for (let j = 0; j < 42; j++) {
        orig.jointWorld(13 + j, a); recon.jointWorld(13 + j, b);
        pos.set([a.x, a.y, a.z, b.x, b.y, b.z], j * 6);
        sum += a.distanceTo(b);
      }
      wires.update(pos);
      const mm = sum / 42 * clip.scale * 1000;
      const show = t > 2 && t < T_BARS - .5;
      wires.obj.visible = show;
      const side = easeInOut(span(t, T_BARS - .8, T_BARS + 1.2));
      for (const ac of [orig, recon]) { ac.group.position.x = -lerp(0, 3.8, side); ac.group.position.z = -lerp(0, 1.5, side); }
      stage.disc.position.x = -lerp(0, 3.8, side); stage.disc.position.z = -lerp(0, 1.5, side); stage.disc.scale.setScalar(lerp(1, .55, side));
      orig.setOpacity(1 - .5 * side); recon.setOpacity(1 - .65 * side);
      chart.group.visible = t > T_BARS - .3;
      chart.grow(span(t, T_BARS + .3, T_BARS + 3.2));
      if (show) ctx.hud.figure(`${mm.toFixed(1)}<small>mm</small>`, '지금 이 순간의 손 오차 · E5');
      else if (t >= T_BARS + 3) ctx.hud.figure('27.0<small>mm</small>', 'E4b · 처음 보는 사람 손 오차');
      else ctx.hud.figure(null);
    },
    exit() { recon.dispose(); wires.dispose(); },
  };
}
