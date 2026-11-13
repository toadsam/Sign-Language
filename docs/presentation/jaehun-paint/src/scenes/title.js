import { Actor } from '../skeleton.js';
import { span, backOut } from '../util.js';

/** 표지: 실제 사람의 수어 「인력」을 하는 캐릭터와 뒤의 스티커판. 판은 연필 스케치로 놓였다가 붓이 지나가며 칠해진다. 단어로 찾기를 바로 해 볼 수 있다. */
export function titleScene(ctx) {
  const { stage, typecase, data } = ctx;
  const clip = data.clips['WORD0773_REAL03'];
  let actor;
  return {
    id: 'title', name: '손짓의 알파벳',
    duration: 16,
    camera: [
      { at: 0, pos: [-2.4, .5, 8.6], tgt: [1.6, -.35, -.8] },
      { at: 15, pos: [-.6, .3, 7.8], tgt: [1.5, -.4, -.8], dur: 15 },
    ],
    cues: [{ at: 3, text: '뒤의 스티커를 눌러 보세요. 토큰 하나가 <em>0.13초</em>짜리 동작이에요' }],
    enter() {
      actor = new Actor(clip.orig, { tone: 'orig' });
      actor.group.position.set(1.7, 0, .5);
      stage.root.add(actor.group);
      stage.disc.position.x = 1.7; stage.disc.position.z = .5; stage.disc.scale.setScalar(.6);
      typecase.reset();
      typecase.group.position.set(2.6, .85, -4.4); typecase.group.rotation.set(0, -.3, 0);
      stage.root.add(typecase.group);
      ctx.hud.title('손짓의<br><span class="accent">알파벳</span>',
        `수어 동작을 <span class="num">0.13</span>초마다 <span class="num">512</span>개 ‘동작 글자’ 중 하나로 바꿔요.<br>한글이 자모 몇십 개로 모든 글자를 쓰듯이요.`);
    },
    update(t) {
      const [s, e] = clip.tokenFrames; const len = e - s;
      actor.setFrame(Math.min(e - 1, s + ((t * 30) % (len + 24))));
      const k = backOut(span(t, .1, 1.3));
      typecase.group.scale.setScalar(.8 + .2 * k);
      typecase.paintSweep(span(t, 1.2, 4.6));
      ctx.hud.search(t > 4);
    },
    exit() { ctx.hud.title(null); typecase.group.scale.setScalar(1); },
  };
}
