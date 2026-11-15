import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLOR, paint, inkify, inkMaterial, makeLabel, drawGlyph, G, FONT } from './util.js';

/**
 * 스티커판: 토큰 512개가 한 칸씩 붙어 있는 판. 32열 × 16행.
 * 칸 하나 = 둥근 흰 타일 위의 글리프(디코더가 토큰 하나로 만든 0.13초 동작, 4프레임).
 * 글리프는 시트 텍스처 한 장에 4프레임을 세로로 쌓아 두고 map.offset 으로 넘긴다.
 * 타일 512개와 글리프 512개는 각각 InstancedMesh 하나. 칸 상태는 cells[t] 에 두고 writeMatrices() 로 쓴다.
 * 색칠: 칸마다 paint 0~1 (aPaint). 0 이면 연필 선만, 1 이면 물감. 찾은 칸·마우스 올린 칸은 늘 칠해 보인다.
 */
export const COLS = 32, ROWS = 16, CELL = 0.21, GAP = 0.04;
const PITCH = CELL + GAP;
const PX = 96;
const TILE = new THREE.Color(0xFFFDF6), TILE_REST = new THREE.Color(0xEDE3CC), TILE_HOT = new THREE.Color(0xFFD866), TILE_HOVER = new THREE.Color(0xF7B39E);

export class TypeCase {
  constructor(atlas) {
    this.atlas = atlas;
    this.group = new THREE.Group();
    this.sheet = this._drawSheet(atlas);

    const W = COLS * PITCH + GAP + .12, H = ROWS * PITCH + GAP + .12;
    this.width = W; this.height = H;
    this.boardPaint = { value: 1 };
    const board = new THREE.Mesh(new RoundedBoxGeometry(W + .16, H + .16, .1, 4, .1), paint(COLOR.yellow, { paint: this.boardPaint }));
    board.position.z = -.07; board.castShadow = true; board.receiveShadow = true;
    const inner = new THREE.Mesh(new RoundedBoxGeometry(W, H, .06, 4, .07), paint(0xF7EDD6, { paint: this.boardPaint }));
    inner.position.z = -.03; inner.receiveShadow = true;
    this.group.add(board, inner);
    inkify(board); inkify(inner, inkMaterial({ px: .7 }));
    // 판 아래 이름표
    const tag = makeLabel('동작 글자 512개', { font: `700 60px ${FONT.story}`, color: '#2E2620', scale: .34, wash: '#FFC83D' });
    tag.position.set(0, -H / 2 - .28, .05); this.group.add(tag); // 아래쪽에 달아 위쪽 자막과 겹치지 않게

    this.paint = new Float32Array(atlas.n).fill(1);
    this.aPaint = new THREE.InstancedBufferAttribute(new Float32Array(atlas.n).fill(1), 1);
    this.tileMat = paint(0xffffff, { inst: true });
    const tileGeo = new RoundedBoxGeometry(CELL, CELL, .03, 2, .035);
    tileGeo.setAttribute('aPaint', this.aPaint);
    this.tiles = new THREE.InstancedMesh(tileGeo, this.tileMat, atlas.n);
    this.tiles.castShadow = true; this.tiles.receiveShadow = true; this.tiles.frustumCulled = false;
    this.group.add(this.tiles);
    // 칸 테두리 먹선 (타일과 같은 행렬을 쓴다. 판 그룹에 따로 둬서 클릭 판정에 안 걸리게)
    const tileInk = new THREE.InstancedMesh(tileGeo, inkMaterial({ px: .55 }), atlas.n);
    tileInk.instanceMatrix = this.tiles.instanceMatrix; tileInk.frustumCulled = false; tileInk.raycast = () => { };
    this.group.add(tileInk);

    const plane = new THREE.PlaneGeometry(CELL * .94, CELL * .94);
    const cellUV = new Float32Array(atlas.n * 2);
    for (let t = 0; t < atlas.n; t++) { const col = t % COLS, row = Math.floor(t / COLS); cellUV[2 * t] = col / COLS; cellUV[2 * t + 1] = 1 - (row + 1) / ROWS / 4; }
    plane.setAttribute('cellUV', new THREE.InstancedBufferAttribute(cellUV, 2));
    plane.setAttribute('aPaint', this.aPaint);
    this.glyphMat = new THREE.MeshBasicMaterial({ map: this.sheet, transparent: true, depthWrite: false });
    // 안 칠한 칸: 진한 선(먹)만 남기고 밝은 물감은 지운다. 칠하면 얼룩지게 번지며 물감이 나타난다.
    this.glyphMat.onBeforeCompile = sh => {
      sh.uniforms.uScene = G.scene; sh.uniforms.uInk = G.ink;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 cellUV; attribute float aPaint; varying float vP; varying vec2 vCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n vMapUv = (mapTransform * vec3(uv * vec2(${1 / COLS}, ${1 / ROWS / 4}) + cellUV, 1.0)).xy; vP = aPaint; vCell = uv + cellUV * 37.0;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uScene; uniform vec3 uInk; varying float vP; varying vec2 vCell;
          float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float gNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(gHash(i), gHash(i+vec2(1,0)), f.x), mix(gHash(i+vec2(0,1)), gHash(i+vec2(1,1)), f.x), f.y); }`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          {
            float lum = dot(gl_FragColor.rgb, vec3(.299, .587, .114));
            float line = smoothstep(.16, .03, lum);
            float p = min(vP, uScene);
            float n = gNoise(vCell * 5.0) * .6 + gNoise(vCell * 13.0) * .4;
            float m = smoothstep(n - .06, n + .06, p * 1.25 - .12);
            vec3 col = mix(uInk * 1.4, gl_FragColor.rgb, m);
            gl_FragColor = vec4(col, gl_FragColor.a * mix(line * .85, 1.0, m));
          }`);
    };
    this.glyphs = new THREE.InstancedMesh(plane, this.glyphMat, atlas.n);
    this.glyphs.frustumCulled = false;
    this.group.add(this.glyphs);

    this.cells = [];
    for (let t = 0; t < atlas.n; t++) {
      const col = t % COLS, row = Math.floor(t / COLS);
      const home = new THREE.Vector3((col - (COLS - 1) / 2) * PITCH, ((ROWS - 1) / 2 - row) * PITCH, 0);
      const o = new THREE.Object3D(); o.position.copy(home);
      o.userData = { token: t, home, rest: !!atlas.rest[t], hot: false, visible: true, lift: 0, liftTo: 0 };
      this.cells.push(o);
    }
    this.hovered = -1;
    this._m = new THREE.Matrix4(); this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.frame = 0; this._acc = 0;
    this.recolor(); this.writeMatrices();
  }

  /** 칸마다 색칠 정도. fn(token) → 0~1, 또는 숫자 하나 */
  setPaint(fn) {
    for (let t = 0; t < this.paint.length; t++) this.paint[t] = typeof fn === 'function' ? fn(t) : fn;
    this.commitPaint();
  }
  commitPaint() {
    const a = this.aPaint.array;
    for (const o of this.cells) { const t = o.userData.token; a[t] = (o.userData.hot || t === this.hovered) ? 1 : this.paint[t]; }
    this.aPaint.needsUpdate = true;
  }
  /** 왼쪽 위에서 오른쪽 아래로 붓이 지나가며 칠한다 (p 0→1) */
  paintSweep(p) {
    this.setPaint(t => { const c = t % COLS, r = Math.floor(t / COLS); const d = (c / COLS) * .75 + (r / ROWS) * .25; return clamp01((p * 1.35 - d) / .3); });
  }

  _drawSheet(atlas) {
    const W = PX;
    const c = document.createElement('canvas'); c.width = COLS * W; c.height = ROWS * W * 4;
    const ctx = c.getContext('2d');
    for (let f = 0; f < 4; f++) for (let t = 0; t < atlas.n; t++) {
      const col = t % COLS, row = Math.floor(t / COLS);
      drawGlyph(ctx, atlas.x[t][f], col * W, f * ROWS * W + row * W, W, atlas.lim);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  recolor() {
    for (const o of this.cells) {
      const t = o.userData.token;
      this.tiles.setColorAt(t, t === this.hovered ? TILE_HOVER : o.userData.hot ? TILE_HOT : o.userData.rest ? TILE_REST : TILE);
    }
    this.tiles.instanceColor.needsUpdate = true;
    this.commitPaint();
  }

  writeMatrices() {
    for (let t = 0; t < this.cells.length; t++) {
      const o = this.cells[t];
      if (!o.userData.visible) { this.tiles.setMatrixAt(t, this._zero); this.glyphs.setMatrixAt(t, this._zero); continue; }
      const L = o.userData.lift;
      o.position.z = o.userData.home.z + (o.userData.hot ? .06 : 0) + L * .12;
      const s = (o.userData.hot ? 1.16 : 1) * (1 + L * .35);
      o.scale.setScalar(s);
      o.updateMatrix();
      this.tiles.setMatrixAt(t, o.matrix);
      this._m.copy(o.matrix); this._m.elements[14] += .018 * s;
      this.glyphs.setMatrixAt(t, this._m);
    }
    this.tiles.instanceMatrix.needsUpdate = true; this.glyphs.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (const o of this.cells) { o.position.copy(o.userData.home); o.userData.visible = true; o.userData.hot = false; o.userData.lift = o.userData.liftTo = 0; }
    this.hovered = -1; this.paint.fill(1); this.boardPaint.value = 1; this.recolor(); this.writeMatrices();
  }

  /** 글리프 프레임 넘기기 + 마우스 올린 칸 들어올리기 */
  update(dt) {
    this._acc += dt;
    if (this._acc > 4 / 30) { this._acc = 0; this.frame = (this.frame + 1) % 4; this.sheet.offset.y = -this.frame / 4; }
    let moved = false;
    for (const o of this.cells) {
      const u = o.userData; if (u.lift === u.liftTo) continue;
      u.lift += (u.liftTo - u.lift) * Math.min(1, dt * 14); if (Math.abs(u.lift - u.liftTo) < .002) u.lift = u.liftTo; moved = true;
    }
    if (moved) this.writeMatrices();
  }

  hover(t) {
    if (t === this.hovered) return;
    if (this.hovered >= 0) this.cells[this.hovered].userData.liftTo = 0;
    this.hovered = t;
    if (t >= 0) this.cells[t].userData.liftTo = 1;
    this.recolor();
  }

  /** 칸 하나를 복제한 '스티커' (손에서 튀어나와 날아가는 용도) */
  makeSort(token) {
    const g = new THREE.Group();
    const tile = new THREE.Mesh(new RoundedBoxGeometry(CELL, CELL, .03, 2, .035), paint(0xFFF3CF));
    tile.castShadow = true;
    inkify(tile, this.sortInk || (this.sortInk = inkMaterial({ px: .7 })));
    const geo = new THREE.PlaneGeometry(CELL * .94, CELL * .94);
    const col = token % COLS, row = Math.floor(token / COLS);
    const u0 = col / COLS, u1 = (col + 1) / COLS, v0 = 1 - (row + 1) / ROWS / 4, v1 = 1 - row / ROWS / 4;
    const uv = geo.attributes.uv; uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    if (!this.sortMat) this.sortMat = new THREE.MeshBasicMaterial({ map: this.sheet, transparent: true, depthWrite: false });
    const glyph = new THREE.Mesh(geo, this.sortMat); glyph.position.z = .018;
    const num = makeLabel(String(token), { font: `700 64px ${FONT.story}`, color: '#2E2620', scale: .08, wash: '#FFC83D', pad: 6 });
    num.position.set(0, -CELL * .68, .03);
    g.add(tile, glyph, num);
    g.userData = { token };
    return g;
  }

  highlight(tokens) {
    const set = new Set(tokens);
    for (const o of this.cells) o.userData.hot = set.has(o.userData.token);
    this.recolor(); this.writeMatrices();
  }

  /** 단어로 찾기: 그 단어의 클립에 자주 나오는 토큰들 */
  search(word) {
    word = (word || '').trim(); if (!word) return [];
    const out = [];
    this.atlas.words.forEach((ws, t) => { if (ws && ws.some(([w]) => w === word || (word.length >= 2 && w.includes(word)))) out.push(t); });
    return out;
  }
}

const clamp01 = x => Math.min(1, Math.max(0, x));
