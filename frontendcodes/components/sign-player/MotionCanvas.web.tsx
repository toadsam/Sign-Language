import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { RenderSample } from './performance';
import { EDGES } from './skeleton';
import { createCapsule, setCapsuleBetween } from './capsule';
import type { DecodedMotion } from './motion';
type MotionCanvasProps = {
  data: DecodedMotion; frame: number; yaw: number; pitch: number;
  showBody: boolean; showHands: boolean; showFace: boolean; height?: number;
  onRenderSample?: (sample:RenderSample) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onViewChange: (yaw: number, pitch: number) => void;
};
const ARM_EDGES = new Set(['2:3', '3:4', '5:6', '6:7']);
export default function MotionCanvas(props: MotionCanvasProps) {
  const { height = 420, yaw, pitch, onViewChange } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null), drawRef = useRef<(() => void) | null>(null);
  const current = useRef(props); current.current = props;
  const drag = useRef<{x: number; y: number; yaw: number; pitch: number} | null>(null);
  const [error, setError] = useState<string | null>(null), [contextVersion, setContextVersion] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); }
    catch { setError('이 브라우저에서 입체 재생을 시작할 수 없습니다. WebGL을 지원하는 브라우저에서 다시 열어주세요.'); return; }
    setError(null);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor('#181b22'); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), model = new THREE.Group(); scene.add(model);
    const camera = new THREE.OrthographicCamera(-2, 2, 1.8, -1.8, .01, 50);
    // Fixed framing across panes. Contract coordinates: x-right, y-down, z-away.
    camera.position.set(0, -.79, 8); camera.lookAt(0, -.79, 0);
    scene.add(new THREE.HemisphereLight('#e4efff', '#344258', 2.2));
    const key = new THREE.DirectionalLight('#ffffff', 2.6); key.position.set(-3, 5, 6); scene.add(key);
    const fill = new THREE.DirectionalLight('#98bbff', 1.1); fill.position.set(4, 1, -3); scene.add(fill);
    const materials = [
      new THREE.MeshStandardMaterial({ color: '#9ab8dc', roughness: .65 }),
      new THREE.MeshStandardMaterial({ color: '#6fd0ae', roughness: .55 }),
      new THREE.MeshStandardMaterial({ color: '#e08a55', roughness: .55 }),
      new THREE.MeshStandardMaterial({ color: '#a0acc2', roughness: .7 }),
      new THREE.MeshStandardMaterial({ color: '#b1c4df', transparent: true, opacity: .28, depthWrite: false, roughness: .8 }),
    ];
    const bones = EDGES.map(([a, b]) => {
      const part = b < 13 ? 0 : b < 34 ? 1 : b < 55 ? 2 : 3;
      const mesh = createCapsule(materials[part]); model.add(mesh);
      const radius = part === 3 ? .004 : part > 0 ? .012 : a === 1 && b === 8 ? .16 : ARM_EDGES.has(`${a}:${b}`) ? .055 : .026;
      return { a, b, mesh, part, radius };
    });
    const jointGeometry = new THREE.SphereGeometry(1, 8, 6);
    const joints = Array.from({ length: 55 }, (_, j) => {
      const mesh = new THREE.Mesh(jointGeometry, materials[j < 13 ? 0 : j < 34 ? 1 : 2]);
      mesh.scale.setScalar(j < 13 ? .03 : .015); model.add(mesh); return mesh;
    });
    const headGeometry = new THREE.SphereGeometry(.2, 16, 12);
    const head = new THREE.Mesh(headGeometry, materials[4]); model.add(head);
    const points = Array.from({ length: 125 }, () => new THREE.Vector3());
    const lost = (event: Event) => { event.preventDefault(); setError('3D 재생 연결이 중단됐습니다. 잠시 후 다시 시도하거나 새로고침해주세요.'); };
    const restored = () => setContextVersion(v => v + 1);
    canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored);
    const draw = () => {
      const { data, frame, yaw: y, pitch: p, showBody, showHands, showFace } = current.current;
      const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
      const cpuStart=performance.now();
      const scale = Math.min(w / 3.2, h / 3.6);
      camera.left = -w / scale / 2; camera.right = w / scale / 2;
      camera.top = h / scale / 2; camera.bottom = -h / scale / 2; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      const f = Math.min(data.response.frames - 1, Math.max(0, Math.floor(frame))), offset = f * 375;
      for (let j = 0; j < 125; j++) points[j].set(data.positions[offset + j * 3], -data.positions[offset + j * 3 + 1], -data.positions[offset + j * 3 + 2]);
      model.rotation.set(p, -y, 0, 'XYZ');
      for (const bone of bones) {
        setCapsuleBetween(bone.mesh, points[bone.a], points[bone.b], bone.radius);
        bone.mesh.visible = bone.mesh.visible && (bone.part === 0 ? showBody : bone.part === 3 ? showFace : showHands);
      }
      joints.forEach((joint, j) => { joint.position.copy(points[j]); joint.visible = j < 13 ? showBody : showHands; });
      head.position.copy(points[0]); head.visible = showBody;
      renderer.render(scene, camera);
      current.current.onRenderSample?.({time:performance.now(),frame:f,cpuMs:performance.now()-cpuStart});
    };
    drawRef.current = draw; draw(); current.current.onCanvasReady?.(canvas);
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => {
      observer.disconnect(); drawRef.current = null; current.current.onCanvasReady?.(null);
      canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
      bones.forEach(bone => bone.mesh.geometry.dispose()); jointGeometry.dispose(); headGeometry.dispose();
      materials.forEach(material => material.dispose()); renderer.dispose(); renderer.forceContextLoss();
    };
  }, [contextVersion]);
  useEffect(() => { drawRef.current?.(); }, [props.data, props.frame, yaw, pitch, props.showBody, props.showHands, props.showFace, height]);
  return <div>
    {error ? <p role="alert" style={{color:'#ffb3b3'}}>{error}</p> : null}
    <canvas ref={canvasRef} aria-label="three.js 입체 캡슐 동작 미리보기" style={{display:'block',width:'100%',height,marginTop:16,borderRadius:12,touchAction:'none',cursor:'grab'}}
      onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,yaw,pitch};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{const d=drag.current;if(!d)return;onViewChange(d.yaw+(e.clientX-d.x)*.01,Math.max(-1.5,Math.min(1.5,d.pitch-(e.clientY-d.y)*.01)));}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}/>
  </div>;
}
