import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLOR, toon, makeLabel, drawGlyph } from './util.js';

/**
 * 스티커판: 토큰 512개가 한 칸씩 붙어 있는 판. 32열 × 16행.
 * 칸 하나 = 둥근 흰 타일 위의 글리프(디코더가 토큰 하나로 만든 0.13초 동작, 4프레임).
 * 글리프는 시트 텍스처 한 장에 4프레임을 세로로 쌓아 두고 map.offset 으로 넘긴다.
 * 타일 512개와 글리프 512개는 각각 InstancedMesh 하나. 칸 상태는 cells[t] 에 두고 writeMatrices() 로 쓴다.
 */
export const COLS = 32, ROWS = 16, CELL = 0.21, GAP = 0.04;
const PITCH = CELL + GAP;
const PX = 96;
const TILE = new THREE.Color(0xFFFFFF), TILE_REST = new THREE.Color(0xEFEBFF), TILE_HOT = new THREE.Color(0xFFE9A8), TILE_HOVER = new THREE.Color(0xFFD9E3);

export class TypeCase {
  constructor(atlas) {
    this.atlas = atlas;
    this.group = new THREE.Group();
    this.sheet = this._drawSheet(atlas);

    const W = COLS * PITCH + GAP + .12, H = ROWS * PITCH + GAP + .12;
    this.width = W; this.height = H;
    const board = new THREE.Mesh(new RoundedBoxGeometry(W + .16, H + .16, .1, 4, .1), toon(COLOR.purple));
    board.position.z = -.07; board.castShadow = true; board.receiveShadow = true;
    const inner = new THREE.Mesh(new RoundedBoxGeometry(W, H, .06, 4, .07), toon(COLOR.lilac));
    inner.position.z = -.03; inner.receiveShadow = true;
    this.group.add(board, inner);
    // 판 위 이름표
    const tag = makeLabel('동작 글자 512개', { font: '60px "Jua", sans-serif', color: '#FFFFFF', scale: .32, pill: '#7C6CF2' });
    tag.position.set(0, -H / 2 - .28, .05); this.group.add(tag); // 아래쪽에 달아 위쪽 자막과 겹치지 않게

    this.tileMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toon(0).gradientMap });
    this.tiles = new THREE.InstancedMesh(new RoundedBoxGeometry(CELL, CELL, .03, 2, .035), this.tileMat, atlas.n);
    this.tiles.castShadow = true; this.tiles.receiveShadow = true; this.tiles.frustumCulled = false;
    this.group.add(this.tiles);

    const plane = new THREE.PlaneGeometry(CELL * .94, CELL * .94);
    const cellUV = new Float32Array(atlas.n * 2);
    for (let t = 0; t < atlas.n; t++) { const col = t % COLS, row = Math.floor(t / COLS); cellUV[2 * t] = col / COLS; cellUV[2 * t + 1] = 1 - (row + 1) / ROWS / 4; }
    plane.setAttribute('cellUV', new THREE.InstancedBufferAttribute(cellUV, 2));
    this.glyphMat = new THREE.MeshBasicMaterial({ map: this.sheet, transparent: true, depthWrite: false });
    this.glyphMat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 cellUV;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n vMapUv = (mapTransform * vec3(uv * vec2(${1 / COLS}, ${1 / ROWS / 4}) + cellUV, 1.0)).xy;`);
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
    this.hovered = -1; this.recolor(); this.writeMatrices();
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
    const tile = new THREE.Mesh(new RoundedBoxGeometry(CELL, CELL, .03, 2, .035), toon(0xFFF4CC));
    tile.castShadow = true;
    const geo = new THREE.PlaneGeometry(CELL * .94, CELL * .94);
    const col = token % COLS, row = Math.floor(token / COLS);
    const u0 = col / COLS, u1 = (col + 1) / COLS, v0 = 1 - (row + 1) / ROWS / 4, v1 = 1 - row / ROWS / 4;
    const uv = geo.attributes.uv; uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    if (!this.sortMat) this.sortMat = new THREE.MeshBasicMaterial({ map: this.sheet, transparent: true, depthWrite: false });
    const glyph = new THREE.Mesh(geo, this.sortMat); glyph.position.z = .018;
    const num = makeLabel(String(token), { font: '64px "Fredoka", "Jua", sans-serif', color: '#FFFFFF', scale: .07, pill: '#7C6CF2', pad: 6 });
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
