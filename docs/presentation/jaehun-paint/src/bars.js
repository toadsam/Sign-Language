import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeLabel, paint, inkify, backOut, span, FONT } from './util.js';
const WHITE = new THREE.Color(0xffffff);

/**
 * 바닥 위에 솟는 수채 막대그래프.
 * groups: [{ label, bars: [{ label, value, color }] }], unit: 값 1당 높이
 * grow(p): 0→1. 막대마다 조금씩 늦게, 먼저 연필 윤곽이 솟고 그 뒤를 붓이 아래에서 위로 칠한다.
 */
export class BarChart {
  constructor({ groups, unit = .07, barW = .42, gap = .1, groupGap = .5, valueFmt = v => v.toFixed(1), valueScale = .3 }) {
    this.group = new THREE.Group();
    this.bars = [];
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, .1);
    const totalW = groups.reduce((s, g) => s + g.bars.length * (barW + gap) - gap, 0) + (groups.length - 1) * groupGap;
    let x = -totalW / 2;
    for (const g of groups) {
      const gx0 = x;
      for (const b of g.bars) {
        const mat = paint(b.color, { axis: true, paint: { value: 0 } });
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true;
        inkify(mesh);
        mesh.position.set(x + barW / 2, 0, 0); mesh.scale.set(barW, .001, barW * .8);
        const val = makeLabel(valueFmt(b.value), { font: `700 64px ${FONT.story}`, color: '#2E2620', scale: valueScale });
        this.group.add(mesh, val);
        if (b.label) {
          const lab = makeLabel(b.label, { font: `48px ${FONT.body}`, color: '#6B5D4F', scale: .24 });
          lab.position.set(x + barW / 2, -.22, barW * .5); this.group.add(lab);
        }
        const bar = { mesh, mat, val, h: b.value * unit, x: x + barW / 2, w: barW, hk: 0, hoverTo: 0, base: val.scale.clone(), color: mat.color.clone() };
        mesh.userData.hover = on => { bar.hoverTo = on ? 1 : 0; };   // 마우스를 올리면 살짝 커지고 숫자가 커진다
        this.bars.push(bar);
        x += barW + gap;
      }
      x -= gap;
      if (g.label) {
        const gl = makeLabel(g.label, { font: `700 52px ${FONT.story}`, color: '#2E2620', scale: .3 });
        gl.position.set((gx0 + x) / 2, g.bars.some(b => b.label) ? -.5 : -.25, barW * .5); this.group.add(gl);
      }
      x += groupGap;
    }
    this.grow(0);
  }
  grow(p) {
    this.bars.forEach((b, i) => {
      const k = backOut(span(p, i * .07, i * .07 + .5));
      const fill = span(p, i * .07 + .18, i * .07 + .8);       // 윤곽이 솟은 뒤 붓이 따라 칠한다
      b.mat.userData.paint.value = fill;
      b.hk += (b.hoverTo - b.hk) * .2;
      const h = Math.max(.001, b.h * k), hv = 1 + .12 * b.hk;
      b.mesh.scale.set(b.w * hv, h, b.w * .8 * hv); b.mesh.position.y = h / 2;
      b.mat.color.copy(b.color).lerp(WHITE, .18 * b.hk);
      b.val.scale.copy(b.base).multiplyScalar(1 + .5 * b.hk);
      b.val.position.set(b.x, h + .2 + .12 * b.hk, .1 * b.hk); b.val.material.opacity = Math.min(1, fill * 1.6);
      b.val.visible = fill > .02;
    });
  }
}
