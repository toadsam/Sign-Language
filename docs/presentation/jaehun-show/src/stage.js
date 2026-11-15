import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLOR, easeInOut } from './util.js';

/** 파스텔 무대: 투명 캔버스(뒤에 CSS 배경과 떠다니는 장식), 부드러운 그림자, 둥근 무대판 */
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

    this.scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xE4DCFF, 1.5));
    const key = new THREE.DirectionalLight(0xFFF8F0, 2.1);
    key.position.set(3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.camera.left = key.shadow.camera.bottom = -10;
    key.shadow.camera.right = key.shadow.camera.top = 10;
    key.shadow.radius = 8; key.shadow.bias = -0.0006;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xE8E2FF, .7); fill.position.set(-5, 2, 3); this.scene.add(fill);

    // 바닥: 그림자만 받는 투명판 + 캐릭터 밑 둥근 무대판
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ color: 0x5B4FC8, opacity: .16 }));
    sc.rotation.x = -Math.PI / 2; sc.position.y = -1.9; sc.receiveShadow = true;
    this.scene.add(sc);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.75, .12, 64), new THREE.MeshToonMaterial({ color: 0xFFFFFF }));
    disc.position.y = -1.96; disc.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.68, .05, 10, 80), new THREE.MeshToonMaterial({ color: COLOR.lilac }));
    rim.rotation.x = Math.PI / 2; rim.position.y = -1.9;
    this.disc = new THREE.Group(); this.disc.add(disc, rim); this.scene.add(this.disc);

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
  }

  moveCamera(pos, tgt) { this.camera.position.fromArray(pos); this.controls.target.fromArray(tgt); }

  update(dt) {
    if (this.userHold > 0) this.userHold -= dt;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
