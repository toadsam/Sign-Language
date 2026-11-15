import * as THREE from 'three';
import { Actor } from '../skeleton.js';
import { COLOR } from '../util.js';

/**
 * 장면 7 · 한눈에 정리. 숫자 카드 세 장(눌러서 뒤집으면 설명)과,
 * 아래에서 같은 문장을 함께 하는 실제 사람(하늘색)과 E5 복원(보라색). 번갈아 콩 뛰고, 끝에 반짝이 인사.
 */
export function outroScene(ctx) {
  const { stage, data, fx } = ctx;
  const clip = data.clips['SEN1384_REAL03'];
  const N = clip.frames, DUR = 30;
  let a, b;
  const crossed = (x, t) => ctx.prevT < x && t >= x;
  const CARDS = [
    { c: '#8ECBEA', n: '80,000<small>클립</small>', l: '같은 기준으로 정리한 데이터',
      back: '단어 48,000 + 문장 32,000. 틀린 왼쪽 귀 16,624클립을 대칭으로 고치고, 10fps·이상치 2,008개를 뺐어요. 평가는 학습에 없던 두 사람으로만.' },
    { c: '#7C6CF2', n: '512<small>개</small>', l: '동작 글자 스티커',
      back: '0.13초마다 하나씩. 얼굴은 빼고(손 3.6mm 손해), 1024보다 512, 학습은 20만 번. 512개 전부 골고루 쓰여요.' },
    { c: '#FFAB7A', n: '52.7→34.3<small>mm</small>', l: '단어 사이 손 오차',
      back: '단어로만 배우면 문장 속에서 50mm 넘게 어긋나요. 문장도 배운 E5가 v1 후보, 11월 7일 고정. 다음은 받아쓰기 생성과 B1 · B2 비교.' },
  ];

  return {
    id: 'outro', name: '한눈에 정리',
    duration: DUR,
    camera: [
      { at: 0, pos: [0, .9, 12.5], tgt: [0, 1.65, 0] },
      { at: 20, pos: [1.6, 1.1, 12], tgt: [0, 1.65, 0], dur: 20 },
    ],
    cues: [
      { at: 0, text: '한눈에 정리해요. <em>카드를 눌러</em> 뒤집어 보세요' },
      { at: 12, text: '들어 주셔서 고마워요! <em>질문</em> 받을게요' },
    ],
    enter() {
      a = new Actor(clip.orig, { tone: 'orig' });
      b = new Actor(clip.recon_e5, { tone: 'e5' });
      a.group.position.x = -1.25; b.group.position.x = 1.25;
      stage.root.add(a.group, b.group);
      stage.disc.scale.set(1.35, 1, 1);
      ctx.hud.cards(CARDS);
    },
    update(t) {
      const f = (t * 30 * .7) % (N - 1);
      a.setFrame(f); b.setFrame(f);
      for (let k = 0; k < 8; k++) {
        const at = 3 + k * 3.2;
        if (crossed(at, t)) (k % 2 ? b : a).hop();
      }
      if (t > 12) for (let k = 0; k < 9; k++) {
        const at = 12 + k * 1.8;
        if (crossed(at, t)) fx.burst(new THREE.Vector3((Math.random() - .5) * 6, 1.6 + Math.random(), (Math.random() - .5) * 2), 22, { speed: 2.6 });
      }
    },
    exit() { ctx.hud.cards(null); },
  };
}
