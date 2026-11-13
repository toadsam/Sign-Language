/**
 * 펜 선 아바타: AI가 만든 3D 동작(125점)을 색칠 마을 그림풍 사람으로 그린다.
 * 좌표는 정면에서 눌러 그리고, 가까운 손은 굵게, 얼굴 앞에 온 손은 얼굴 위에 그린다.
 * 손가락은 하나씩 테두리를 가지고 카메라에서 먼 손가락부터 그린다 (겹쳐도 경계가 보이게).
 * 점 번호는 ml/common/skeleton.py 와 같다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { Paint } from '@/constants/paint';
import type { Motion } from '@/lib/api/generate';
import { smoothClosed, smoothOpen } from './rough';

const S = 200; // 어깨너비 1 = 200
const NECK = 1, R_SH = 2, R_EL = 3, L_SH = 5, L_EL = 6, R_EAR = 11, L_EAR = 12;
const LH = 13, RH = 34, FACE = 55;
const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const PALM = [0, 1, 5, 9, 13, 17];
const SKINS = ['#F6CDA8', '#F3C59E', '#F6CDA8', '#F3C59E', '#F6CDA8'];
const INK = Paint.ink;

type P3 = [number, number, number];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const f1 = (v: number) => v.toFixed(1);
const line = (pts: P3[]) => 'M' + pts.map((q) => `${f1(q[0])} ${f1(q[1])}`).join(' L');
const mean = (pts: P3[]) => [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
const xy = (pts: P3[]) => pts.map((q) => [q[0], q[1]] as [number, number]);

/** 앞뒤 2프레임씩 섞어 떨림을 줄인다 (모델 출력은 조금 떨린다) */
function smoothen(data: Float32Array, frames: number) {
  const D = 375, W = [1, 2, 3, 2, 1], out = new Float32Array(data.length);
  for (let t = 0; t < frames; t++) {
    let ws = 0;
    for (let d = -2; d <= 2; d++) {
      const s = clamp(t + d, 0, frames - 1), w = W[d + 2];
      ws += w;
      for (let i = 0; i < D; i++) out[t * D + i] += data[s * D + i] * w;
    }
    for (let i = 0; i < D; i++) out[t * D + i] /= ws;
  }
  return out;
}

function points(data: Float32Array, frames: number, t: number, handScale: number, yawDeg: number): P3[] {
  const a = Math.floor(t), b = Math.min(frames - 1, a + 1), k = t - a;
  const p: P3[] = new Array(125);
  for (let j = 0; j < 125; j++) {
    const i = j * 3, A = a * 375 + i, B = b * 375 + i;
    p[j] = [(data[A] + (data[B] - data[A]) * k) * S, (data[A + 1] + (data[B + 1] - data[A + 1]) * k) * S, data[A + 2] + (data[B + 2] - data[A + 2]) * k];
  }
  if (yawDeg) {
    const y = (yawDeg * Math.PI) / 180, c = Math.cos(y), s = Math.sin(y), nx = p[NECK][0], nz = p[NECK][2];
    for (const q of p) {
      const X = (q[0] - nx) / S, Z = q[2] - nz;
      q[0] = nx + (X * c + Z * s) * S;
      q[2] = nz + (-X * s + Z * c);
    }
  }
  for (const r of [LH, RH]) {
    const w = p[r];
    for (let c = 1; c < 21; c++) {
      const q = p[r + c];
      p[r + c] = [w[0] + (q[0] - w[0]) * handScale, w[1] + (q[1] - w[1]) * handScale, q[2]];
    }
  }
  return p;
}

type ArmShape = {
  arm: string; armW: number; palm: string; fw: number; palmLine: string;
  fingers: { d: string; crease: string; color: string; z: number }[]; layer: 'back' | 'mid' | 'front';
};

function build(p: P3[], headScale: number) {
  const n = p[NECK], rs = p[R_SH], ls = p[L_SH];
  const out = Math.sign(ls[0] - rs[0]) || 1;
  const torso = `M${f1(rs[0] - out * 20)} ${f1(rs[1] + 36)} Q${f1(rs[0] - out * 16)} ${f1(rs[1] - 18)} ${f1(n[0])} ${f1(n[1] - 8)} Q${f1(ls[0] + out * 16)} ${f1(ls[1] - 18)} ${f1(ls[0] + out * 20)} ${f1(ls[1] + 36)} L${f1(ls[0] + out * 22)} 430 L${f1(rs[0] - out * 22)} 430 Z`;

  const fp = (j: number) => p[FACE + j];
  const jaw = Array.from({ length: 17 }, (_, i) => fp(i));
  const browA = Array.from({ length: 5 }, (_, i) => fp(17 + i)), browB = Array.from({ length: 5 }, (_, i) => fp(22 + i));
  const browY = mean([...browA, ...browB])[1], chin = fp(8);
  const H = chin[1] - browY;
  const fw0 = Math.hypot(jaw[16][0] - jaw[0][0], jaw[16][1] - jaw[0][1]);
  const cx = mean(jaw)[0];
  const top = browY - H, bot = chin[1] + H * 0.08;
  const cy = (top + bot) / 2, ry = (bot - top) / 2, rx = Math.max(fw0 * 0.64, ry * 0.92);
  const headT = `translate(${f1(chin[0])} ${f1(chin[1])}) scale(${headScale}) translate(${f1(-chin[0])} ${f1(-chin[1])})`;
  const ears = [p[R_EAR], p[L_EAR]].map((q) => cx + clamp(q[0] - cx, -rx * 1.1, rx * 1.1));
  const neck = `M${f1(n[0] - rx * 0.4)} ${f1(n[1] + 4)} L${f1(cx - rx * 0.36)} ${f1(chin[1] - 12)} L${f1(cx + rx * 0.36)} ${f1(chin[1] - 12)} L${f1(n[0] + rx * 0.4)} ${f1(n[1] + 4)} Z`;
  const collar = `M${f1(n[0] - rx * 0.62)} ${f1(n[1] - 6)} Q${f1(n[0])} ${f1(n[1] + 30)} ${f1(n[0] + rx * 0.62)} ${f1(n[1] - 6)} Q${f1(n[0])} ${f1(n[1] + 12)} ${f1(n[0] - rx * 0.62)} ${f1(n[1] - 6)} Z`;
  const hair = `M${f1(cx - rx * 1.05)} ${f1(cy + ry * 0.08)} A${f1(rx * 1.05)} ${f1(ry * 1.06)} 0 0 1 ${f1(cx + rx * 1.05)} ${f1(cy + ry * 0.08)} Q${f1(cx + rx * 0.82)} ${f1(cy - ry * 0.3)} ${f1(cx + rx * 0.5)} ${f1(cy - ry * 0.32)} Q${f1(cx + rx * 0.28)} ${f1(cy - ry * 0.52)} ${f1(cx)} ${f1(cy - ry * 0.36)} Q${f1(cx - rx * 0.3)} ${f1(cy - ry * 0.56)} ${f1(cx - rx * 0.55)} ${f1(cy - ry * 0.34)} Q${f1(cx - rx * 0.85)} ${f1(cy - ry * 0.32)} ${f1(cx - rx * 1.05)} ${f1(cy + ry * 0.08)} Z`;

  const eye = (a: number) => {
    const pts = Array.from({ length: 6 }, (_, i) => fp(a + i)), c = mean(pts);
    const w = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]) || 1;
    const h = (Math.abs(pts[1][1] - pts[5][1]) + Math.abs(pts[2][1] - pts[4][1])) / 2;
    const r = clamp(w * 0.34, 5, 11);
    return { c, r, open: h / w > 0.12 };
  };
  const eyes = [eye(36), eye(42)];
  const inner = Array.from({ length: 8 }, (_, i) => fp(60 + i));
  const face = {
    cx, cy, rx, ry, headT, ears, hair,
    browA: smoothOpen(xy(browA)), browB: smoothOpen(xy(browB)),
    eyes, H,
    mouth: smoothClosed(xy(Array.from({ length: 12 }, (_, i) => fp(48 + i)))),
    mouthIn: Math.abs(inner[6][1] - inner[2][1]) > 3 ? smoothClosed(xy(inner)) : '',
  };

  const noseZ = p[0][2];
  const arms: ArmShape[] = ([[R_SH, R_EL, RH], [L_SH, L_EL, LH]] as const).map(([sh, elb, root]) => {
    const w = p[root];
    const dz = clamp(1 - (w[2] - noseZ) * 0.9, 0.85, 1.4);
    const armW = 36 * clamp(1 - (p[elb][2] - noseZ) * 0.6, 0.85, 1.3);
    const hp = (c: number) => p[root + c];
    const fw = 13 * dz * 1.2;
    const b5 = hp(5), b17 = hp(17), w0 = hp(0), mx = (b5[0] + b17[0]) / 2, my = (b5[1] + b17[1]) / 2;
    const fingers = FINGERS.map((ch, i) => {
      const pts = ch.map(hp);
      const A = pts[1], B = pts[2], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
      const nx = (-dy / L) * fw * 0.32, ny = (dx / L) * fw * 0.32;
      return { d: line(pts), crease: `M${f1(A[0] + nx)} ${f1(A[1] + ny)} L${f1(A[0] - nx)} ${f1(A[1] - ny)}`, color: SKINS[i], z: pts.reduce((s, q) => s + q[2], 0) / pts.length };
    }).sort((x, y) => y.z - x.z);
    const layer = p[sh][2] > n[2] + 0.12 && w[2] > n[2] - 0.05 ? 'back' : w[2] < noseZ + 0.08 ? 'front' : 'mid';
    return {
      arm: line([p[sh], p[elb], w]), armW, fw, fingers, layer,
      palm: smoothClosed(xy(PALM.map(hp))),
      palmLine: `M${f1(b5[0] + (w0[0] - b5[0]) * 0.35)} ${f1(b5[1] + (w0[1] - b5[1]) * 0.35)} Q${f1(mx + (w0[0] - mx) * 0.2)} ${f1(my + (w0[1] - my) * 0.2)} ${f1(b17[0] + (w0[0] - b17[0]) * 0.35)} ${f1(b17[1] + (w0[1] - b17[1]) * 0.35)}`,
    } as ArmShape;
  });
  return { torso, neck, collar, face, arms };
}

function Arm({ a }: { a: ArmShape }) {
  const lw = 3.8;
  return (
    <G>
      <Path d={a.arm} stroke={INK} strokeWidth={a.armW + 9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={a.arm} stroke={Paint.sky} strokeWidth={a.armW} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={a.palm} stroke={INK} strokeWidth={a.fw + lw * 2} fill={INK} strokeLinejoin="round" />
      <Path d={a.palm} stroke={Paint.skin} strokeWidth={a.fw} fill={Paint.skin} strokeLinejoin="round" />
      <Path d={a.palmLine} stroke={INK} strokeWidth={2.4} opacity={0.4} fill="none" strokeLinecap="round" />
      {a.fingers.map((f, i) => (
        <G key={i}>
          <Path d={f.d} stroke={INK} strokeWidth={a.fw + lw * 2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={f.d} stroke={f.color} strokeWidth={a.fw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={f.crease} stroke={INK} strokeWidth={2.2} opacity={0.5} strokeLinecap="round" />
        </G>
      ))}
    </G>
  );
}

type Props = {
  motion: Motion;
  playing?: boolean;
  speed?: number;
  loop?: boolean;
  /** 귀여운 비율 (턱 기준으로 머리를 키운다). 1이면 원래 비율 */
  headScale?: number;
  yaw?: number;
  style?: StyleProp<ViewStyle>;
  onFrame?: (frame: number) => void;
  onEnd?: () => void;
};

export function PenAvatar({ motion, playing = true, speed = 1, loop = true, headScale = 1.25, yaw = 0, style, onFrame, onEnd }: Props) {
  const reduce = useReducedMotion();
  const data = useMemo(() => smoothen(motion.data, motion.frames), [motion]);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  useEffect(() => {
    tRef.current = 0;
    setT(0);
  }, [motion]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = Date.now();
    const step = () => {
      const now = Date.now(), dt = Math.min(64, now - last);
      last = now;
      let nt = tRef.current + (dt / 1000) * motion.fps * speed * (reduce ? 0.6 : 1);
      if (nt >= motion.frames - 1) {
        if (loop) nt = 0;
        else {
          nt = motion.frames - 1;
          tRef.current = nt;
          setT(nt);
          onEnd?.();
          return;
        }
      }
      tRef.current = nt;
      setT(nt);
      onFrame?.(Math.floor(nt));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, loop, motion, reduce, onEnd, onFrame]);

  const g = useMemo(() => build(points(data, motion.frames, clamp(t, 0, motion.frames - 1), 1.2, yaw), headScale), [data, motion.frames, t, yaw, headScale]);
  const f = g.face;
  const layer = (k: ArmShape['layer']) => g.arms.filter((a) => a.layer === k).map((a, i) => <Arm key={k + i} a={a} />);

  return (
    <Svg viewBox="-340 -335 680 740" style={style} accessibilityLabel="수어 아바타">
      {layer('back')}
      <Path d={g.torso} fill={Paint.sky} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
      <Path d={g.neck} fill={Paint.skin} stroke={INK} strokeWidth={3.6} strokeLinejoin="round" />
      <Path d={g.collar} fill={Paint.yellow} stroke={INK} strokeWidth={3.6} strokeLinejoin="round" />
      {layer('mid')}
      <G transform={f.headT}>
        {f.ears.map((ex, i) => (
          <Ellipse key={i} cx={ex} cy={f.cy + f.ry * 0.1} rx={f.rx * 0.18} ry={f.ry * 0.2} fill={Paint.skin} stroke={INK} strokeWidth={3.6} />
        ))}
        <Ellipse cx={f.cx} cy={f.cy} rx={f.rx} ry={f.ry} fill={Paint.skin} stroke={INK} strokeWidth={4.5} />
        {f.eyes.map((e, i) => (
          <Ellipse key={'b' + i} cx={e.c[0] + (i ? 1 : -1) * f.rx * 0.1} cy={e.c[1] + f.H * 0.45} rx={f.rx * 0.2} ry={f.rx * 0.12} fill={Paint.coral} opacity={0.5} />
        ))}
        <Path d={f.hair} fill={Paint.hair} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
        <G transform={`translate(${f1(f.cx + f.rx * 0.66)} ${f1(f.cy - f.ry * 0.5)}) rotate(18)`}>
          <Ellipse cx={0} cy={0} rx={13} ry={9} fill={Paint.yellow} stroke={INK} strokeWidth={3} />
          <Path d="M-3 -8 q-2 8 0 16 M4 -8 q2 8 0 16" fill="none" stroke={INK} strokeWidth={2.6} />
          <Ellipse cx={-2} cy={-12} rx={5} ry={7} fill="#fff" stroke={INK} strokeWidth={2.2} transform="rotate(-20 -2 -12)" />
        </G>
        <Path d={f.browA} fill="none" stroke={INK} strokeWidth={4.6} strokeLinecap="round" />
        <Path d={f.browB} fill="none" stroke={INK} strokeWidth={4.6} strokeLinecap="round" />
        {f.eyes.map((e, i) =>
          e.open ? (
            <G key={'e' + i}>
              <Ellipse cx={e.c[0]} cy={e.c[1]} rx={e.r} ry={e.r * 1.2} fill={INK} />
              <Circle cx={e.c[0] + e.r * 0.35} cy={e.c[1] - e.r * 0.4} r={e.r * 0.36} fill="#fff" />
            </G>
          ) : (
            <Path key={'e' + i} d={`M${f1(e.c[0] - e.r * 1.2)} ${f1(e.c[1])} Q${f1(e.c[0])} ${f1(e.c[1] + e.r * 0.9)} ${f1(e.c[0] + e.r * 1.2)} ${f1(e.c[1])}`} fill="none" stroke={INK} strokeWidth={3.6} strokeLinecap="round" />
          ),
        )}
        <Path d={f.mouth} fill="#E48C7E" stroke={INK} strokeWidth={3.4} strokeLinejoin="round" />
        {f.mouthIn ? <Path d={f.mouthIn} fill="#8A4038" /> : null}
      </G>
      {layer('front')}
    </Svg>
  );
}
