import * as THREE from 'three';
import { Actor } from '../skeleton.js';
import { span, smooth, easeInOut, makeLabel, COLOR } from '../util.js';

/**
 * 장면 3 · 데이터의 문제. 왼쪽 귀가 코에서 3.6m 떨어진 채 처음부터 끝까지 있었다.
 * 가까이서는 멀쩡한 캐릭터, 카메라를 빼면 귀 하나가 멀리 떠 있다(분홍 점선). 버튼을 누르면 얼굴 중심면에 대칭으로 돌아온다.
 */
export function earsScene(ctx) {
  const { stage, data, fx } = ctx;
  const clip = data.clips['WORD2891_REAL03'];
  const T_PULL = 3.2, T_FAR = 6.4, T_MIRROR = 10.5, T_FIX = 12.6, T_BACK = 15.5, DUR = 21;
  let actor, mirror, farLabel, countLabel, pose;
  const earM = (clip.leftEarNoseCmMean / 100).toFixed(1);
  const crossed = (a, t) => ctx.prevT < a && t >= a;

  return {
    id: 'ears', name: '귀가 3.6m 밖에 있었어요',
    duration: DUR,
    camera: [
      { at: 0, pos: [1.8, .5, 5.6], tgt: [0, 0, 0] },
      { at: T_FAR, pos: [21, 7.5, 11], tgt: [.6, 1.6, -6], dur: T_FAR - T_PULL },
      { at: T_MIRROR + 1.5, pos: [3, 1, 6.4], tgt: [0, -.05, 0], dur: 2.2 },
      { at: T_BACK + 1.5, pos: [1.8, .5, 5.6], tgt: [0, 0, 0], dur: 2 },
    ],
    cues: [
      { at: 0, text: `평가 사람 REAL03, 단어 <em>「${clip.gloss?.[0] ?? ''}」</em>. 가까이서는 멀쩡해 보여요` },
      { at: T_PULL, text: '카메라를 쭉 빼 보면…' },
      { at: T_FAR + .4, text: `왼쪽 귀가 코에서 <em>${earM}m</em> 떨어져 있어요. 처음부터 끝까지요` },
      { at: T_FAR + 2.4, text: '튀는 게 아니라 <em>계속</em> 틀려 있어서 이상치 검사에도 안 걸렸어요. 48,000클립 중 <em>16,464개</em>' },
      { at: T_MIRROR, text: '버리지 않아요. 반대쪽 귀를 <em>얼굴 중심면</em>에 비춰서 다시 계산해요' },
      { at: T_FIX + 1.2, text: '다른 121점은 그대로. 고친 클립 16,771개, 검증 오차 눈 <code>0.7cm</code> · 귀 <code>4.6cm</code>' },
      { at: T_BACK + 1.8, text: '처음엔 ‘튄 프레임만 보간’하려 했어요. 해 보니 틀린 자리로 고쳐질 뿐이라 방법을 바꿨어요' },
    ],
    enter() {
      actor = new Actor(clip.before, { tone: 'orig' });
      stage.root.add(actor.group);
      pose = clip.before[0].map(p => p.slice());
      mirror = new THREE.Mesh(new THREE.CircleGeometry(.75, 48), new THREE.MeshBasicMaterial({ color: COLOR.e5, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      mirror.rotation.y = Math.PI / 2;
      stage.root.add(mirror);
      farLabel = makeLabel(`왼쪽 귀 · 코에서 ${earM}m`, { font: '60px "Jua", sans-serif', color: '#FFFFFF', scale: 1.1, pill: '#FF7A9A' });
      farLabel.visible = false; stage.root.add(farLabel);
      countLabel = makeLabel('16,464 클립', { font: '600 64px "Fredoka", "Jua", sans-serif', color: '#2B2350', scale: 1.2, pill: '#FFFFFF' });
      countLabel.visible = false; stage.root.add(countLabel);
    },
    update(t) {
      const T = clip.frames;
      const f = (t * 30 * .6) % (T - 1);
      const i = Math.floor(f), k = f - i, A = clip.before[i], B = clip.before[i + 1], A2 = clip.after[i], B2 = clip.after[i + 1];
      const w = easeInOut(span(t, T_FIX, T_FIX + 1.4));
      for (let j = 0; j < 55; j++) {
        const m = (j >= 9 && j <= 12) ? w : 0;
        for (let d = 0; d < 3; d++) {
          const a = A[j][d] + (B[j][d] - A[j][d]) * k, b = A2[j][d] + (B2[j][d] - A2[j][d]) * k;
          pose[j][d] = a + (b - a) * m;
        }
      }
      actor.setPose(pose);

      const ear = actor.jointWorld(12);
      farLabel.visible = t > T_FAR - .6 && t < T_FIX + .4;
      farLabel.position.copy(ear).add(new THREE.Vector3(0, .9, 0));
      farLabel.material.opacity = smooth(span(t, T_FAR - .6, T_FAR + .4)) * (1 - smooth(span(t, T_FIX - .2, T_FIX + .4)));
      countLabel.visible = t > T_FAR + 2.4 && t < T_MIRROR + .6;
      countLabel.position.copy(ear).add(new THREE.Vector3(0, -.9, 0));
      countLabel.material.opacity = smooth(span(t, T_FAR + 2.4, T_FAR + 3.2)) * (1 - smooth(span(t, T_MIRROR, T_MIRROR + .6)));

      const nose = actor.jointWorld(0), neck = actor.jointWorld(1);
      mirror.position.set((nose.x + neck.x) / 2, nose.y + .05, (nose.z + neck.z) / 2 - .1);
      mirror.material.opacity = .45 * smooth(span(t, T_MIRROR + .3, T_MIRROR + 1.2)) * (1 - smooth(span(t, T_BACK, T_BACK + 1)));

      // 누르면 바로 고치기
      if (t > T_FAR + 2.4 && t < T_MIRROR) ctx.hud.action('귀 제자리로 돌려놓기 ✨', () => ctx.seek(T_MIRROR));
      else ctx.hud.action(null);
      if (crossed(T_FIX + 1.4, t)) { fx.burst(actor.jointWorld(12), 24); fx.burst(actor.jointWorld(11), 12); }

      if (t > T_FAR + 2.4 && t < T_MIRROR) ctx.hud.figure('34<small>%</small>', '왼쪽 귀가 틀린 클립 비율');
      else if (t > T_FIX + 1.2) ctx.hud.figure('16,771<small>개</small>', '귀·눈 대칭으로 고친 클립');
      else ctx.hud.figure(null);
    },
    exit() { ctx.hud.action(null); },
  };
}
