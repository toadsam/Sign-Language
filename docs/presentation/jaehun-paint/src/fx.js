import * as THREE from 'three';
import { dropTexture, blotTexture, COLOR } from './util.js';

/**
 * 물감 방울 튀기기(반짝이 대신)와 물감 번짐.
 * burst(위치, 개수, 색들) → 방울이 톡 튀어 올라 커지며 옅어진다.
 * bloom(위치, 색, 크기) → 그 자리에 물감이 둥글게 번졌다가 마른다(시안의 bloom 전환과 같은 느낌).
 */
export class Sparkles {
  constructor(scene, max = 400) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.kind = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('kind', new THREE.BufferAttribute(this.kind, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dropTexture() }, scale: { value: 420 } },
      vertexShader: `attribute float life; attribute float kind; attribute vec3 color; varying vec3 vC; varying float vL; varying float vK; uniform float scale;
        void main(){ vC=color; vL=life; vK=kind; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
        gl_PointSize = scale * (0.035 + 0.08*(1.0-life)) / -mv.z; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vL; varying float vK;
        void main(){ if(vL<=0.0) discard; vec2 uv = vec2((gl_PointCoord.x + vK) / 4.0, 1.0 - gl_PointCoord.y); vec4 t=texture2D(map, uv);
          gl_FragColor=vec4(vC * mix(.82, 1.0, t.a), t.a * min(1.0, vL*1.6) * .9);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.i = 0;
    this.palette = [COLOR.yellow, COLOR.coral, COLOR.mint, COLOR.sky, COLOR.leaf].map(c => new THREE.Color(c));

    // 번짐: 스프라이트 몇 장을 돌려 쓴다
    this.blooms = [];
    const tex = blotTexture(['#FFFFFF', '#FFFFFF'], { size: 512, seed: 47 });
    for (let k = 0; k < 8; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; s.renderOrder = 3; scene.add(s);
      this.blooms.push({ s, life: 0, size: 1 });
    }
    this.bi = 0;
  }
  burst(p, n = 14, { speed = 2.2, colors = null } = {}) {
    const pal = colors ? colors.map(c => new THREE.Color(c)) : this.palette;
    for (let k = 0; k < n; k++) {
      const i = this.i = (this.i + 1) % this.max;
      this.pos.set([p.x, p.y, p.z], i * 3);
      const a = Math.random() * Math.PI * 2, u = Math.random() * .8 + .2, sp = speed * .75;
      this.vel.set([Math.cos(a) * sp * u, (Math.random() * 1.1 + .5) * sp, Math.sin(a) * sp * u * .6], i * 3);
      const c = pal[k % pal.length]; this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = 1; this.kind[i] = Math.floor(Math.random() * 4);
    }
  }
  bloom(p, color = COLOR.yellow, size = 1.6) {
    const b = this.blooms[this.bi = (this.bi + 1) % this.blooms.length];
    b.s.position.copy(p); b.s.material.color.set(color); b.life = 1; b.size = size; b.s.visible = true;
    b.s.material.rotation = Math.random() * Math.PI * 2;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * .95;
      this.vel[i * 3 + 1] -= 3.2 * dt;
      for (let d = 0; d < 3; d++) { this.vel[i * 3 + d] *= 1 - dt * 1.2; this.pos[i * 3 + d] += this.vel[i * 3 + d] * dt; }
    }
    const g = this.points.geometry;
    for (const k of ['position', 'life', 'color', 'kind']) g.attributes[k].needsUpdate = true;
    for (const b of this.blooms) {
      if (b.life <= 0) { b.s.visible = false; continue; }
      b.life -= dt / 1.7;
      const age = 1 - b.life, grow = 1 - Math.pow(1 - Math.min(1, age * 2.2), 3);
      b.s.scale.setScalar(b.size * (.15 + .85 * grow));
      b.s.material.opacity = .7 * (age < .45 ? 1 : 1 - (age - .45) / .55);
    }
  }
  clear() { this.life.fill(0); for (const b of this.blooms) { b.life = 0; b.s.visible = false; } }
}
