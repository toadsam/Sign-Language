import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { G, blotTexture } from './util.js';

/**
 * 수채 종이 무대: 투명 캔버스(뒤에 종이 배경과 물감 얼룩), 따뜻한 빛, 옅은 갈색 그림자.
 * 캐릭터 밑 무대판 대신 바닥에 번진 물감 웅덩이(먹선 테두리 포함) 한 장.
 */
export class Stage {
  constructor(host) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, .05, 120);
    this.camera.position.set(0, .4, 7.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .08;
    this.controls.enablePan = false; this.controls.minDistance = 2; this.controls.maxDistance = 40;
    this.controls.target.set(0, -.2, 0);
    this.userHold = 0;
    this.controls.addEventListener('start', () => { this.userHold = 4; });

    this.scene.add(new THREE.HemisphereLight(0xFFFBF2, 0xEADFC8, 1.6));
    const key = new THREE.DirectionalLight(0xFFF4E2, 2.0);
    key.position.set(3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.camera.left = key.shadow.camera.bottom = -10;
    key.shadow.camera.right = key.shadow.camera.top = 10;
    key.shadow.radius = 10; key.shadow.bias = -0.0006;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xF4EEFF, .6); fill.position.set(-5, 2, 3); this.scene.add(fill);

    // 바닥: 그림자만 받는 투명판(옅은 갈색) + 캐릭터 밑 물감 웅덩이
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ color: 0x6B5D4F, opacity: .2, depthWrite: false }));
    sc.rotation.x = -Math.PI / 2; sc.position.y = -1.9; sc.receiveShadow = true; sc.renderOrder = 2;
    this.scene.add(sc);
    this.puddleMat = new THREE.MeshBasicMaterial({ map: blotTexture(['#FFE08A', '#FFC83D', '#93C47D'], { size: 1024, seed: 31, ring: true }), transparent: true, depthWrite: false });
    const puddle = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 6.2), this.puddleMat);
    puddle.rotation.x = -Math.PI / 2; puddle.position.y = -1.905; puddle.renderOrder = 1;
    this.disc = new THREE.Group(); this.disc.add(puddle); this.scene.add(this.disc);
    this.puddle = puddle;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of G.lineMats) m.resolution.set(w, h);
  }

  moveCamera(pos, tgt) { this.camera.position.fromArray(pos); this.controls.target.fromArray(tgt); }

  update(dt) {
    if (this.userHold > 0) this.userHold -= dt;
    // 웅덩이도 장면과 같이 번지며 나타난다
    const s = G.scene.value;
    this.puddleMat.opacity = .2 + .62 * s;
    this.puddle.scale.setScalar(.82 + .18 * s);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
