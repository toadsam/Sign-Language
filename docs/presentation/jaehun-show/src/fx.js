import * as THREE from 'three';
import { starTexture, COLOR } from './util.js';

/** 반짝이 터뜨리기. burst(위치, 개수, 색들) → 별이 퐁 튀어 올랐다 떨어지며 사라진다 */
export class Sparkles {
  constructor(scene, max = 400) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: starTexture() }, scale: { value: 420 } },
      vertexShader: `attribute float life; attribute vec3 color; varying vec3 vC; varying float vL; uniform float scale;
        void main(){ vC=color; vL=life; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
        gl_PointSize = scale * (0.05 + 0.07*sin(min(life,1.0)*3.1416)) / -mv.z; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vL;
        void main(){ if(vL<=0.0) discard; vec4 t=texture2D(map, gl_PointCoord); gl_FragColor=vec4(vC, t.a*min(1.0,vL*2.0)); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.i = 0;
    this.palette = [COLOR.butter, COLOR.pink, COLOR.left, COLOR.e5, COLOR.right].map(c => new THREE.Color(c));
  }
  burst(p, n = 14, { speed = 2.2, colors = null } = {}) {
    const pal = colors ? colors.map(c => new THREE.Color(c)) : this.palette;
    for (let k = 0; k < n; k++) {
      const i = this.i = (this.i + 1) % this.max;
      this.pos.set([p.x, p.y, p.z], i * 3);
      const a = Math.random() * Math.PI * 2, u = Math.random() * .8 + .2;
      this.vel.set([Math.cos(a) * speed * u, (Math.random() * 1.2 + .6) * speed, Math.sin(a) * speed * u * .6], i * 3);
      const c = pal[k % pal.length]; this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = 1;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 1.1;
      this.vel[i * 3 + 1] -= 5 * dt;
      for (let d = 0; d < 3; d++) this.pos[i * 3 + d] += this.vel[i * 3 + d] * dt;
    }
    const g = this.points.geometry; g.attributes.position.needsUpdate = true; g.attributes.life.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
  clear() { this.life.fill(0); }
}
