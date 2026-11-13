import * as THREE from 'three';
import { Actor } from '../skeleton.js';
import { span, smooth, backOut, lerp, COLOR, makeLabel, paint, inkify, blotTexture, roughPath, ellipsePts } from '../util.js';

/**
 * 장면 6 · 기준선과 다음. 지금 서비스 방식(단어 클립 이어붙이기)으로 단어 3개를 이으면
 * 단어 사이에서 손이 내려간다. 민트 물감 대기선 아래로 두 손목이 내려갈 때마다 산호색 물감 공이 하나씩 쌓인다.
 * 끝에 스티커판이 스케치로 내려와 붓이 지나가며 칠해지고 다음 단계. 단어 찾기를 다시 해 볼 수 있다.
 */
export function baselineScene(ctx) {
  const { stage, typecase, data, fx } = ctx;
  const key = Object.keys(data.clips).find(k => k.startsWith('B1_'));
  const clip = data.clips[key];
  const N = clip.concat.length;
  const T_END = N / 30;
  const T_CASE = T_END + 1.5, DUR = T_CASE + 13;
  let actor, restGroup, counter = 0, lastBelow = false, lastF = 0, marks = [], restY = 0;
  const wristY = (P, j) => -P[j][1];

  return {
    id: 'baseline', name: '이어붙이기로는 안 돼요',
    duration: DUR,
    camera: [
      { at: 0, pos: [2.8, .4, 9.6], tgt: [0, -.45, 0] },
      { at: T_END, pos: [-1.8, .2, 9], tgt: [0, -.5, 0], dur: T_END },
      { at: T_CASE + 2.5, pos: [0, .8, 12.5], tgt: [0, .2, -1.5], dur: 2.5 },
      { at: T_CASE + 10, pos: [-3, 1.2, 10.5], tgt: [0, .3, -1.5], dur: 6 },
    ],
    cues: [
      { at: 0, text: '기준선 B1 · 지금 서비스 방식이에요. 단어 클립 <em>세 개를 그대로 이어 붙여요</em>' },
      { at: 2.5, text: '단어가 끝날 때마다 손이 <em>대기 자세</em>로 쑥 내려가요. 진짜 문장은 안 그래요' },
      { at: T_END - 1, text: '400조합 평균: 그대로 잇기 12.2초, 잘라 잇기 8.6초, 스티커 잇기 7.9초. 어느 쪽이든 손은 <em>약 2번</em> 내려가요' },
      { at: T_CASE + .5, text: '단어 사이 전환은 이어붙이기로는 안 돼요. <em>문장 데이터로 받아쓰기가 배워야 해요</em>' },
      { at: T_CASE + 4, text: '다음 · 11월 7일 자모표 v1(E5)을 고정해요. 지헌이 스티커를 생성하면 승현의 읽는 모델로 채점해요' },
      { at: T_CASE + 8, text: 'B1 · B2 · 우리 방식을 같은 사람, 같은 55점, 같은 잣대로 비교해요. 단어를 찾아보세요!' },
    ],
    enter() {
      actor = new Actor(clip.concat, { tone: 'orig' });
      stage.root.add(actor.group);
      counter = 0; lastBelow = false; lastF = 0; marks = [];
      restY = -clip.concat[0][8][1] + .35;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: blotTexture(['#7CC6A4', '#A9E0C6'], { seed: 61, ring: true }), transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2; plane.position.y = restY;
      const ring = new THREE.Group();
      const lab = makeLabel('대기선 · 손이 여기로 내려오면 하나', { scale: .26, wash: '#7CC6A4' });
      lab.position.set(1.9, restY + .2, .4);
      restGroup = new THREE.Group(); restGroup.add(plane, ring, lab); stage.root.add(restGroup);
      typecase.reset(); typecase.group.position.set(0, 7, -3); typecase.group.visible = false;
      stage.root.add(typecase.group);
    },
    update(t) {
      const f = Math.min(N - 1, t * 30);
      actor.setFrame(f);
      if (f < lastF) { counter = 0; lastBelow = false; for (const m of marks) stage.root.remove(m); marks = []; }
      for (let i = Math.floor(lastF) + 1; i <= Math.floor(f); i++) {
        const P = clip.concat[i];
        const below = wristY(P, 4) < restY && wristY(P, 7) < restY;
        if (below && !lastBelow && i > 15 && i < N - 15) {
          counter++;
          const m = new THREE.Mesh(new THREE.SphereGeometry(.13, 20, 14), paint(COLOR.coral)); m.castShadow = true; inkify(m);
          m.position.set(-2.3 + counter * .36, -1.77, 1.2); m.userData.born = t; stage.root.add(m); marks.push(m);
          fx.burst(new THREE.Vector3((P[4][0] + P[7][0]) / 2, restY, -(P[4][2] + P[7][2]) / 2 + .2), 16, { colors: [COLOR.coral, COLOR.yellow] });
        }
        lastBelow = below;
      }
      lastF = f;
      for (const m of marks) { m.scale.setScalar(backOut(span(t, m.userData.born, m.userData.born + .5))); m.visible = t < T_CASE; }
      restGroup.visible = t < T_CASE;
      const down = backOut(span(t, T_CASE, T_CASE + 1.6));
      typecase.group.visible = t > T_CASE - .1;
      typecase.group.position.y = lerp(7, .9, down);
      typecase.paintSweep(span(t, T_CASE + 1, T_CASE + 4.2));
      actor.setOpacity(1 - .55 * smooth(span(t, T_CASE, T_CASE + 1.5)));
      stage.disc.visible = t < T_CASE + .5;
      ctx.hud.search(t > T_CASE + 8);
      if (t > 2 && t < T_CASE) ctx.hud.figure(`${counter}<small>번</small>`, '손이 내려간 횟수 · 이 조합');
      else if (t > T_CASE + 4) ctx.hud.figure('11/7', '자모표 v1 고정하는 날');
      else ctx.hud.figure(null);
    },
    exit() { },
  };
}
