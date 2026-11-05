/**
 * 홈의 마을 거리: 학습 단원 하나가 건물 하나다.
 * 다 배운 단원은 수채 물감으로 칠해져 있고, 지금 배울 곳에는 '여기부터' 표시가 있다.
 * 새로 다 배운 곳은 돌아왔을 때 물감이 번지며 칠해진다 (paintIndex).
 * 꿀짓이가 거리 위를 날아다니고, 누른 곳으로 따라간다. 빈 곳을 누르면 물감 한 방울이 떨어진다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Font, Paint } from '@/constants/paint';
import { feel } from '@/lib/feel';
import { skyOf, type SkyPhase } from '@/lib/sky';
import { Bee } from './bee';
import { useBoil } from './paint-ui';
import { blob, jitterPath } from './rough';

const H = 310, TOP = 30, GAP = 190, X0 = 130;
export const placeX = (i: number) => X0 + i * GAP;

type Building = { name: string; orig: number; ink: string; paint: { d: string; c: string; o?: number }[] };
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0`;

/** 단원 순서(LEARNING_UNITS)와 같은 순서의 건물 */
const BUILDINGS: Building[] = [
  {
    name: '우리 집', orig: 120,
    ink: 'M58 196 L58 302 M182 196 L182 302 M46 200 L120 134 L194 200 M98 302 L98 248 Q110 240 122 248 L122 302 M134 226 H164 V254 H134 Z M149 226 v28 M134 240 h30 M152 160 L152 138 L166 138 L166 172',
    paint: [{ d: rect(58, 196, 124, 106), c: Paint.yellowSoft }, { d: 'M46 200 L120 134 L194 200Z', c: Paint.coral }, { d: rect(134, 226, 30, 28), c: Paint.sky }],
  },
  {
    name: '공원', orig: 300,
    ink: 'M262 302 L262 236 M336 302 L336 244 M226 206 q-4 -32 26 -40 q20 -20 40 2 q30 6 22 36 q2 28 -30 30 q-20 12 -38 -2 q-24 0 -20 -26z M308 216 q0 -26 26 -30 q28 2 28 28 q4 24 -24 28 q-30 2 -30 -26z M282 288 h44 M286 288 v14 M322 288 v14 M280 280 h48',
    paint: [{ d: circ(262, 200, 40), c: Paint.leaf }, { d: circ(336, 214, 32), c: Paint.leaf }, { d: 'M220 302 Q300 286 380 302Z', c: Paint.leaf, o: 0.6 }],
  },
  {
    name: '카페', orig: 490,
    ink: 'M412 204 L412 302 M568 204 L568 302 M404 176 L576 176 L576 204 L404 204 Z M404 204 q11 12 21.5 0 q11 12 21.5 0 q11 12 21.5 0 q11 12 21.5 0 q11 12 21.5 0 q11 12 21.5 0 q11 12 21.5 0 q11 12 21.5 0 M430 222 H500 V274 H430 Z M465 222 v52 M516 302 L516 226 L552 226 L552 302 M546 266 h-4 M462 140 L518 140 L518 166 L462 166 Z M470 176 L470 166 M510 176 L510 166',
    paint: [{ d: rect(412, 170, 156, 132), c: Paint.yellowSoft }, { d: rect(404, 176, 172, 28), c: Paint.coral }, { d: rect(430, 222, 70, 52), c: Paint.sky }],
  },
  {
    name: '꽃집', orig: 0,
    ink: 'M-70 302 V200 M70 302 V200 M-78 176 H78 V200 H-78 Z M-78 200 q9.75 12 19.5 0 q9.75 12 19.5 0 q9.75 12 19.5 0 q9.75 12 19.5 0 q9.75 12 19.5 0 q9.75 12 19.5 0 q9.75 12 19.5 0 q9.75 12 19.5 0 M-56 222 H4 V270 H-56 Z M24 302 V228 H54 V302 M-62 302 v-14 h18 v14 M-40 288 q-6 -16 4 -22 M-50 288 q-10 -12 -2 -20',
    paint: [{ d: rect(-70, 176, 140, 126), c: Paint.yellowSoft }, { d: rect(-78, 176, 156, 24), c: Paint.mint }, { d: circ(-38, 240, 10), c: Paint.coral }, { d: circ(-20, 252, 9), c: Paint.yellow }, { d: circ(-12, 236, 8), c: Paint.coral }],
  },
  {
    name: '편의점', orig: 680,
    ink: 'M604 194 L604 302 M756 194 L756 302 M600 172 L760 172 L760 194 L600 194 Z M620 210 H676 V274 H620 Z M692 302 V222 H740 V302 M716 222 V302',
    paint: [{ d: rect(604, 186, 152, 116), c: Paint.sky }, { d: rect(600, 172, 160, 22), c: Paint.yellow }],
  },
  {
    name: '정류장', orig: 0,
    ink: 'M-50 302 V176 M-66 160 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 M-14 200 H66 L74 190 H-8 Z M-10 200 V302 M62 200 V302 M-10 232 H62 M4 272 H50 M10 272 V288 M44 272 V288',
    paint: [{ d: circ(-50, 160, 16), c: Paint.sky }, { d: 'M-14 200 H66 L74 190 H-8 Z', c: Paint.coral }, { d: rect(-10, 200, 72, 32), c: Paint.sky, o: 0.5 }],
  },
  {
    name: '학교', orig: 870,
    ink: 'M784 176 L784 302 M956 176 L956 302 M778 176 L962 176 M836 176 L870 138 L904 176 M860 160 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M870 154 v6 l4 3 M870 138 V110 M800 200 h30 v30 h-30 z M910 200 h30 v30 h-30 z M800 246 h30 v30 h-30 z M910 246 h30 v30 h-30 z M852 302 V244 H888 V302 M870 244 V302',
    paint: [{ d: rect(784, 176, 172, 126), c: Paint.yellowSoft }, { d: 'M836 176 L870 138 L904 176Z', c: Paint.coral }],
  },
  {
    name: '병원', orig: 1060,
    ink: 'M984 160 L984 302 M1136 160 L1136 302 M978 160 L1142 160 M1060 180 v20 M1050 190 h20 M1046 176 h28 v28 h-28 z M1000 220 h28 v26 h-28 z M1092 220 h28 v26 h-28 z M1040 302 V256 H1080 V302 M1060 256 V302',
    paint: [{ d: rect(984, 160, 152, 142), c: '#FFFFFF' }, { d: rect(1046, 176, 28, 28), c: Paint.coral }],
  },
];
// 카페 앞에서 수어로 이야기하는 두 사람. ph가 바뀌면 팔이 움직이고, 말하는 사람 쪽에 물결 표시가 뜬다
const PAIR_STILL = 'M442 248 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M452 258 L446 296 M452 258 L458 296 M452 266 L466 258 L472 248 M452 266 L462 276 L470 270 M520 250 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M530 260 L524 296 M530 260 L536 296 M530 268 L520 278 L512 274 M530 268 L540 280 M478 240 q6 6 0 12 M484 236 q9 10 0 20';
function pairPath(ph: number) {
  const left = Math.floor(ph / 18) % 2 === 0; // 18틱마다 말하는 사람이 바뀐다
  const a = Math.sin(ph * 0.9), b = Math.cos(ph * 0.7);
  const l = left
    ? `M452 266 L466 ${258 + a * 3} L${472 + b * 4} ${246 + a * 5} M452 266 L464 ${268 - b * 4} L${474 + a * 3} ${262 - b * 4}`
    : 'M452 266 L466 258 L472 252 M452 266 L462 276 L470 270';
  const r = !left
    ? `M530 268 L516 ${260 + a * 3} L${510 - b * 4} ${248 + a * 5} M530 268 L518 ${270 - b * 3} L${508 + a * 3} ${264 - b * 4}`
    : 'M530 268 L520 278 L512 274 M530 268 L540 280';
  const wave = left ? 'M480 240 q6 6 0 12 M487 236 q9 10 0 20' : 'M502 240 q-6 6 0 12 M495 236 q-9 10 0 20';
  return `M442 248 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M452 258 L446 296 M452 258 L458 296 M520 250 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M530 260 L524 296 M530 260 L536 296 ${l} ${r} ${wave}`;
}

/** 칠해진 건물이 살아날 때 쓰는 자리 (건물 원래 좌표) */
const LIFE: { smoke?: [number, number]; windows?: [number, number, number, number][]; lamp?: [number, number] }[] = [
  { smoke: [159, 136], windows: [[134, 226, 30, 28]] },
  {},
  { windows: [[430, 222, 70, 52]] },
  { windows: [[-56, 222, 60, 48]] },
  { windows: [[620, 210, 56, 64]] },
  { lamp: [-50, 160] },
  { windows: [[800, 200, 30, 30], [910, 200, 30, 30], [800, 246, 30, 30], [910, 246, 30, 30]] },
  { windows: [[1000, 220, 28, 26], [1092, 220, 28, 26]] },
];

/* ── 하늘: 실제 시각에 따라 아침 · 낮 · 저녁 · 밤 ── */
// 시간대 계산은 앱 전체가 같이 쓰도록 lib/sky 에 있다
export { skyOf, type SkyPhase };
const SKY: Record<SkyPhase, { wash?: string; washO: number; band?: string; sun: string; sunY: number }> = {
  morning: { wash: Paint.sky, washO: 0.32, band: Paint.yellowSoft, sun: Paint.yellowSoft, sunY: 90 },
  day: { washO: 0, sun: Paint.yellow, sunY: 64 },
  evening: { wash: Paint.coral, washO: 0.3, band: Paint.yellowSoft, sun: '#F6A65A', sunY: 118 },
  night: { wash: '#5468B8', washO: 0.34, sun: Paint.yellowSoft, sunY: 64 },
};
const STARS: [number, number][] = [[210, 60], [330, 92], [460, 52], [610, 84], [760, 46], [900, 78], [1040, 58], [1180, 90], [1320, 50], [1460, 80], [260, 120], [700, 118], [1120, 122]];

/* ── 계절: 봄 꽃잎, 여름 반딧불(밤)·햇살, 가을 낙엽, 겨울 눈 ── */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export function seasonOf(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}
const FALL_N = 16;

/* ── 주민 ── */
const SHIRTS = [Paint.coral, Paint.sky, Paint.leaf, Paint.yellow, Paint.mint, Paint.blossom];
/** 수어 박수: 두 손을 머리 위로 들고 손목을 돌리며 흔든다. 마을 주민과 축하 카드가 같이 쓴다 */
function Cheerer({ x, k, tk, boil }: { x: number; k: number; tk: number; boil: number }) {
  const ph = (tk + k) % 4;
  const hop = ph === 1 ? -2.5 : 0;
  // 손목을 돌리면 손바닥이 보였다(넓게) 손날이 보였다(좁게) 한다. 두 손이 엇갈리게
  const wL = ph < 2 ? 3.4 : 1.6;
  const wR = ph < 2 ? 1.6 : 3.4;
  const sway = ph % 2 ? 1.5 : -1.5;
  const shirt = SHIRTS[k % SHIRTS.length];
  const hxL = x - 12 + sway, hxR = x + 12 + sway;
  const ink = jitterPath(
    `M${x - 3} 291 L${x - 4} 302 M${x + 3} 291 L${x + 4} 302 M${x - 5} 279 L${x - 10} 268 L${hxL} 259 M${x + 5} 279 L${x + 10} 268 L${hxR} 259`,
    90 + k * 3 + boil,
    0.4,
  );
  const shake = `M${hxL - 7} 252 q-2 4 0 8 M${hxR + 7} 252 q2 4 0 8`;
  return (
    <G transform={`translate(0 ${hop})`}>
      <Path d={jitterPath(`M${x - 6} 277 L${x + 6} 277 L${x + 7.5} 292 L${x - 7.5} 292 Z`, 60 + k + boil, 0.5)} fill={shirt} stroke={Paint.ink} strokeWidth={1.6} strokeLinejoin="round" />
      <Path d={ink} fill="none" stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={blob(x, 269, 5.6, 5.8, k + 2 + boil, 0.08, 8)} fill={Paint.skin} stroke={Paint.ink} strokeWidth={1.6} />
      {/* 웃는 얼굴 */}
      <Path d={`M${x - 2.5} 268 h0.1 M${x + 2.5} 268 h0.1`} stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" />
      <Path d={`M${x - 2.2} 271 q2.2 2 4.4 0`} fill="none" stroke={Paint.ink} strokeWidth={1.2} strokeLinecap="round" />
      <Path d={blob(hxL, 256, wL, 3.6, k, 0.1, 6)} fill={Paint.skin} stroke={Paint.ink} strokeWidth={1.3} />
      <Path d={blob(hxR, 256, wR, 3.6, k + 1, 0.1, 6)} fill={Paint.skin} stroke={Paint.ink} strokeWidth={1.3} />
      <Path d={shake} fill="none" stroke={Paint.inkSoft} strokeWidth={1.2} strokeLinecap="round" opacity={0.7} />
    </G>
  );
}

/** 축하 카드용: 주민 몇 명이 나란히 서서 수어 박수를 친다 */
export function CheerCrowd({ count = 5, width = 220 }: { count?: number; width?: number }) {
  const reduce = useReducedMotion();
  const boil = useBoil();
  const tk = useLifeTick(!reduce);
  const gap = 34;
  const vbW = gap * count + 10;
  const height = (width / vbW) * 64;
  return (
    <View style={{ width, height }} accessible accessibilityLabel="마을 사람들이 수어로 박수를 쳐요">
      <Svg width={width} height={height} viewBox={`0 244 ${vbW} 64`}>
        <Path d={jitterPath(`M4 303 Q${vbW / 2} 299 ${vbW - 4} 303`, 5 + boil, 0.6)} fill="none" stroke={Paint.inkSoft} strokeWidth={1.6} strokeLinecap="round" />
        {Array.from({ length: count }, (_, i) => (
          <Cheerer key={i} x={22 + i * gap} k={i} tk={reduce ? 0 : tk} boil={boil} />
        ))}
      </Svg>
    </View>
  );
}

function Resident({ k, tk, boil, cheer }: { k: number; tk: number; boil: number; cheer?: boolean }) {
  // 오늘 목표를 채운 직후에는 자기 건물 앞에 멈춰서 다 같이 수어 박수를 친다
  if (cheer) return <Cheerer x={placeX(k) + 34} k={k} tk={tk} boil={boil} />;
  // 자기 건물 앞을 오가다가, 돌아서는 순간(속도가 거의 0)에는 멈춰서 손을 흔든다
  const a = tk * 0.018 + k * 1.7;
  const x = placeX(k) + 34 + Math.sin(a) * 56;
  const v = Math.cos(a);
  const walking = Math.abs(v) > 0.25;
  const f = v >= 0 ? 1 : -1;
  const step = [3, 0, -3, 0][tk % 4];
  const s = walking ? step : 0;
  const wave = (tk >> 1) % 2 ? 3 : -2;
  const shirt = SHIRTS[k % SHIRTS.length];
  const arms = walking
    ? `M${x - 5} 279 L${x - 7 - s * 0.6} 288 M${x + 5} 279 L${x + 7 + s * 0.6} 288`
    : `M${x - 5 * f} 279 L${x - 9 * f} 287 M${x + 5 * f} 279 L${x + 11 * f} 272 L${x + (10 + wave) * f} 264`;
  const ink = jitterPath(`M${x - 3} 291 L${x - 3 - s} 302 M${x + 3} 291 L${x + 3 + s} 302 ${arms}`, 90 + k * 3 + boil, 0.4);
  return (
    <G>
      <Path d={jitterPath(`M${x - 6} 277 L${x + 6} 277 L${x + 7.5} 292 L${x - 7.5} 292 Z`, 60 + k + boil, 0.5)} fill={shirt} stroke={Paint.ink} strokeWidth={1.6} strokeLinejoin="round" />
      <Path d={ink} fill="none" stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={blob(x, 269, 5.6, 5.8, k + 2 + boil, 0.08, 8)} fill={Paint.skin} stroke={Paint.ink} strokeWidth={1.6} />
      <Path d={`M${x + 1.5 * f} 268.5 h0.1`} stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" />
      {!walking && <Path d={blob(x + (10 + wave) * f, 263, 2.4, 2.4, k, 0.1, 6)} fill={Paint.skin} stroke={Paint.ink} strokeWidth={1.3} />}
    </G>
  );
}

/** 살아 있는 장면용 시계: 0.11초마다 1씩 오른다. 펜 그림처럼 뚝뚝 끊겨 움직이는 게 오히려 어울린다 */
function useLifeTick(enabled: boolean) {
  const [tk, setTk] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTk((v) => v + 1), 110);
    return () => clearInterval(id);
  }, [enabled]);
  return tk;
}

type Props = {
  titles: string[];
  completed: number;
  /** 지금 막 다 배운 단원 번호 (돌아왔을 때 칠해지는 애니메이션) */
  paintIndex?: number | null;
  height?: number;
  /** 하늘 시각 (0~23). 비우면 지금 시각 */
  hour?: number;
  /** 계절을 정하는 달 (1~12). 비우면 이번 달 */
  month?: number;
  onPressPlace: (index: number, at: { x: number; y: number }) => void;
  /** 오늘 목표를 막 채웠을 때: 주민들이 제자리에서 수어 박수를 친다 */
  cheer?: boolean;
};

export function Village({ titles, completed, paintIndex = null, height = 290, hour, month, onPressPlace, cheer = false }: Props) {
  const reduce = useReducedMotion();
  const boil = useBoil();
  const tk = useLifeTick(!reduce);
  const phase = skyOf(hour ?? new Date().getHours());
  const sky = SKY[phase];
  const dark = phase === 'evening' || phase === 'night';
  const season = seasonOf(month ?? new Date().getMonth() + 1);
  const scale = height / H;
  const width = (X0 + (titles.length - 1) * GAP + 140) * scale;
  const current = Math.min(completed, titles.length - 1);
  const allDone = completed >= titles.length;
  const scrollRef = useRef<ScrollView>(null);
  const [viewW, setViewW] = useState(0);
  const [reveal, setReveal] = useState(1); // 새로 칠하는 곳의 물감 반지름 비율 (0~1)
  const [drops, setDrops] = useState<{ id: number; x: number; y: number; c: string; t0: number }[]>([]);
  const [, setNow] = useState(0);

  // 지금 배울 곳(또는 막 칠할 곳)이 화면 가운데 오게
  const focus = paintIndex ?? current;
  useEffect(() => {
    if (!viewW) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, placeX(focus) * scale - viewW / 2), animated: false });
  }, [viewW, focus, scale]);

  // 물감이 번지며 칠해진다
  useEffect(() => {
    if (paintIndex == null) return;
    if (reduce) { setReveal(1); return; }
    setReveal(0);
    let raf = 0;
    const t0 = Date.now() + 450;
    const step = () => {
      const t = Math.max(0, Math.min(1, (Date.now() - t0) / 1600));
      setReveal(t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      if (t < 1) raf = requestAnimationFrame(step);
      else feel.celebrate(); // 다 칠해지는 순간 톡-톡-쿵
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [paintIndex, reduce]);

  // 물감 방울은 1.8초 동안 번졌다 사라진다
  useEffect(() => {
    if (!drops.length) return;
    let raf = 0;
    const step = () => {
      const now = Date.now();
      setNow(now);
      setDrops((ds) => ds.filter((d) => now - d.t0 < 1800));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [drops.length]);

  // 꿀짓이: 누른 곳을 천천히 따라가고, 가만히 있을 땐 8자로 맴돈다
  const bx = useSharedValue(placeX(focus) + 90), by = useSharedValue(90);
  const tx = useSharedValue(placeX(focus) + 90), ty = useSharedValue(90);
  const clock = useSharedValue(0);
  useFrameCallback((f) => {
    if (reduce) return;
    clock.value += f.timeSincePreviousFrame ?? 16;
    const t = clock.value;
    const nx = bx.value + (tx.value + Math.sin(t * 0.0011) * 40 - bx.value) * 0.035;
    const ny = by.value + (ty.value + Math.sin(t * 0.0023) * 14 - by.value) * 0.035;
    bx.value = nx;
    by.value = ny;
  });
  const beeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: bx.value * scale - 28 }, { translateY: (by.value - TOP) * scale - 28 }],
  }));

  const ink = useMemo(
    () => BUILDINGS.slice(0, titles.length).map((b, i) => jitterPath(b.ink, i * 7 + boil, 1.1)),
    [titles.length, boil],
  );
  const vbW = X0 + (titles.length - 1) * GAP + 140;
  const alive = (i: number) => i < completed && (i !== paintIndex || reveal > 0.95);
  const cafeAlive = alive(2);
  const pair = useMemo(() => jitterPath(cafeAlive ? pairPath(tk) : PAIR_STILL, 40 + boil, 0.9), [boil, tk, cafeAlive]);
  const skyEdge = useMemo(
    () => `M0 ${TOP} H${vbW} V170 ` + Array.from({ length: 16 }, (_, k) => `Q${vbW - (k + 0.5) * (vbW / 16)} ${178 + (k % 2 ? 10 : -6)} ${vbW - (k + 1) * (vbW / 16)} 170`).join(' ') + ' Z',
    [vbW],
  );
  const ground = useMemo(() => jitterPath(`M0 302 L${X0 + titles.length * GAP} 302`, 50 + boil, 1), [titles.length, boil]);

  const press = (e: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = e.nativeEvent;
    const sx = locationX / scale, sy = locationY / scale + TOP;
    tx.value = sx;
    ty.value = Math.min(sy - 40, 200);
    // 가장 가까운 건물
    let best = -1, bd = 95;
    titles.forEach((_, i) => {
      const d = Math.abs(sx - placeX(i));
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && sy > 110 && sy < 312) {
      onPressPlace(best, { x: pageX, y: pageY });
      return;
    }
    if (reduce) return;
    const colors = [Paint.yellow, Paint.yellowSoft, Paint.coral, Paint.sky, Paint.leaf];
    setDrops((ds) => [...ds, { id: Date.now(), x: sx, y: sy, c: colors[Math.floor(Math.random() * colors.length)], t0: Date.now() }]);
  };

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => setViewW(e.nativeEvent.layout.width)}
      style={{ flexGrow: 0 }}
    >
      <Pressable onPress={press} accessibilityLabel={`마을 그림. ${titles.length}곳 중 ${Math.min(completed, titles.length)}곳을 칠했어요`}>
        <View style={{ width, height }}>
          <Svg width={width} height={height} viewBox={`0 ${TOP} ${width / scale} ${H}`}>
            <Defs>
              {titles.map((_, i) => {
                const cx = placeX(i);
                const r = i < completed ? (i === paintIndex ? 240 * reveal : 260) : 0;
                return (
                  <ClipPath id={`clip-${i}`} key={i}>
                    <Path d={r > 0.5 ? blob(cx, 240, r, r, 11 + i, 0.12) : 'M0 0'} />
                  </ClipPath>
                );
              })}
            </Defs>
            {/* 하늘 물감: 시각마다 색이 다르다 */}
            {sky.wash && <Path d={skyEdge} fill={sky.wash} opacity={sky.washO} />}
            {sky.band && <Path d={`M0 128 Q${vbW / 3} 112 ${vbW / 2} 132 T${vbW} 124 V170 H0 Z`} fill={sky.band} opacity={0.45} />}
            {phase === 'night' &&
              STARS.filter(([x]) => x < vbW).map(([x, y], k) => (
                <Path key={'s' + k} d={`M${x - 4} ${y} h8 M${x} ${y - 4} v8`} stroke={Paint.yellow} strokeWidth={2.2} strokeLinecap="round" opacity={(tk + k * 3) % 9 < 5 ? 1 : 0.35} />
              ))}

            {/* 해 (밤에는 초승달) */}
            {phase === 'night' ? (
              <Path d={jitterPath('M108 40 a27 27 0 1 0 0 48 a21 21 0 1 1 0 -48 Z', 3 + boil, 0.6)} fill={Paint.yellowSoft} stroke={Paint.ink} strokeWidth={2.2} strokeLinejoin="round" />
            ) : (
              <G>
                <Path d={blob(96, sky.sunY, 30, 30, 2)} fill={sky.sun} opacity={0.9} />
                <G transform={`rotate(${reduce ? 0 : (tk * 1.5) % 360} 96 ${sky.sunY})`}>
                  <Path d={jitterPath(`M70 ${sky.sunY} a26 26 0 1 0 52 0 a26 26 0 1 0 -52 0 M96 ${sky.sunY - 40} v-10 M96 ${sky.sunY + 40} v10 M56 ${sky.sunY} h-10 M136 ${sky.sunY} h10 M68 ${sky.sunY - 28} l-7 -7 M124 ${sky.sunY + 28} l7 7 M124 ${sky.sunY - 28} l7 -7 M68 ${sky.sunY + 28} l-7 7`, 3 + boil, 1)} fill="none" stroke={Paint.ink} strokeWidth={2.2} strokeLinecap="round" />
                </G>
              </G>
            )}

            {/* 흘러가는 구름 */}
            {[0, 1, 2].map((k) => {
              const span = vbW + 260;
              const cx = (((k * span) / 3 + (reduce ? 0 : tk * (0.35 + k * 0.12))) % span) - 130;
              const cy = 52 + k * 22;
              return (
                <Path
                  key={'c' + k}
                  d={jitterPath(`M${cx - 34} ${cy} q-2 -16 16 -16 q6 -16 24 -10 q16 -8 26 8 q16 0 14 18 Z`, 70 + k + boil, 0.8)}
                  fill={phase === 'night' ? '#E4E2EC' : Paint.card}
                  opacity={0.92}
                  stroke={Paint.ink}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              );
            })}
            <Path d={`M0 150 Q160 100 330 140 T700 128 T1100 140 T1600 132`} fill="none" stroke={Paint.ink} strokeWidth={2} opacity={0.4} />

            {/* 물감 (배운 곳만) */}
            {titles.map((_, i) => {
              const b = BUILDINGS[i];
              const dx = placeX(i) - b.orig;
              return (
                <G key={'p' + i} clipPath={`url(#clip-${i})`}>
                  <G transform={`translate(${dx} 0)`}>
                    {b.paint.map((p, k) => (
                      <Path key={k} d={p.d} fill={p.c} opacity={p.o ?? 0.92} stroke={p.c} strokeWidth={4} strokeOpacity={0.5} />
                    ))}
                  </G>
                </G>
              );
            })}
            {drops.map((d) => {
              const k = (Date.now() - d.t0) / 1800;
              return <Path key={d.id} d={blob(d.x, d.y, 8 + 26 * Math.min(k * 3, 1), 8 + 26 * Math.min(k * 3, 1), d.id % 97)} fill={d.c} opacity={k < 0.5 ? 0.85 : 0.85 * (1 - (k - 0.5) / 0.5)} />;
            })}

            {/* 저녁 · 밤: 칠한 건물만 창문에 불이 켜진다 */}
            {dark &&
              titles.map((_, i) => {
                if (!alive(i)) return null;
                const L = LIFE[i];
                const dx = placeX(i) - BUILDINGS[i].orig;
                const flick = (tk + i * 5) % 23 === 0 ? 0.6 : 1;
                return (
                  <G key={'w' + i} transform={`translate(${dx} 0)`} opacity={flick}>
                    {L.windows?.map(([x, y, w, h], k) => (
                      <G key={k}>
                        <Path d={blob(x + w / 2, y + h / 2, w * 0.95, h * 0.95, i + k, 0.1)} fill={Paint.yellowSoft} opacity={0.45} />
                        <Path d={`M${x} ${y} h${w} v${h} h${-w} Z`} fill={Paint.yellow} opacity={0.95} />
                      </G>
                    ))}
                    {L.lamp && <Path d={blob(L.lamp[0], L.lamp[1], 30, 30, 5, 0.1)} fill={Paint.yellowSoft} opacity={0.55} />}
                    {L.lamp && <Path d={blob(L.lamp[0], L.lamp[1], 15, 15, 6, 0.06)} fill={Paint.yellow} />}
                  </G>
                );
              })}

            {/* 펜 선 */}
            <G fill="none" stroke={Paint.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d={ground} />
              {titles.map((_, i) => (
                <G key={'i' + i} transform={`translate(${placeX(i) - BUILDINGS[i].orig} 0)`} opacity={i <= completed ? 1 : 0.55}>
                  <Path d={ink[i]} />
                  {i === 2 && <Path d={pair} />}
                </G>
              ))}
            </G>

            {/* 칠한 곳은 살아 움직인다: 굴뚝 연기, 새, 꽃잎, 깃발, 하트 */}
            {titles.map((_, i) => {
              const dx = placeX(i) - BUILDINGS[i].orig;
              const on = alive(i) && !reduce;
              const L = LIFE[i];
              return (
                <G key={'l' + i} transform={`translate(${dx} 0)`}>
                  {/* 학교 깃발: 칠하기 전엔 빈 깃발, 칠하면 펄럭인다 */}
                  {i === 6 && (() => {
                    const w = on ? Math.sin(tk * 0.45) * 4 : 0;
                    return <Path d={`M870 110 Q882 ${108 + w} 896 ${117 + w * 1.4} Q882 ${125 + w} 870 128 Z`} fill={i < completed ? Paint.coral : 'none'} stroke={Paint.ink} strokeWidth={2.2} strokeLinejoin="round" opacity={i <= completed ? 1 : 0.55} />;
                  })()}
                  {on && L.smoke && [0, 1, 2].map((k) => {
                    const f = (tk * 0.018 + k / 3) % 1;
                    const [sx, sy] = L.smoke!;
                    return <Path key={'sm' + k} d={blob(sx + Math.sin(f * 6 + k) * 6 + f * 14, sy - 8 - f * 56, 5 + f * 9, 4 + f * 8, k + 3, 0.15, 8)} fill={Paint.card} stroke={Paint.ink} strokeWidth={1.8} opacity={1 - f} />;
                  })}
                  {on && i === 1 && [0, 1].map((k) => {
                    const bx2 = 300 + Math.sin(tk * 0.03 + k * 2) * 60 + k * 24, by2 = 140 + Math.cos(tk * 0.05 + k) * 10 - k * 14;
                    const f = (tk + k * 2) % 4 < 2 ? -6 : 2;
                    return <Path key={'b' + k} d={`M${bx2 - 9} ${by2} q4.5 ${f} 9 0 q4.5 ${f} 9 0`} fill="none" stroke={Paint.ink} strokeWidth={2} strokeLinecap="round" />;
                  })}
                  {on && i === 3 && [0, 1, 2].map((k) => {
                    const f = (tk * 0.014 + k / 3) % 1;
                    const px = -30 + k * 12 + f * 30, py = 236 - f * 70;
                    return <Path key={'pt' + k} d={blob(px, py, 4, 3, k + 8, 0.2, 6)} fill={k % 2 ? Paint.coral : Paint.yellow} stroke={Paint.ink} strokeWidth={1.2} opacity={1 - f} />;
                  })}
                  {on && i === 7 && (() => {
                    const f = (tk * 0.012) % 1;
                    const hx = 1076 + Math.sin(f * 8) * 4, hy = 170 - f * 50;
                    return <Path d={`M${hx} ${hy + 5} l-6 -6 a3.5 3.5 0 0 1 6 -4 a3.5 3.5 0 0 1 6 4 z`} fill={Paint.coral} stroke={Paint.ink} strokeWidth={1.6} strokeLinejoin="round" opacity={1 - f} />;
                  })()}
                  {on && i === 4 && tk % 40 < 14 && <Path d="M716 210 v-8 M726 214 l6 -6 M706 214 l-6 -6" stroke={Paint.ink} strokeWidth={2} strokeLinecap="round" />}
                  {on && i === 5 && (() => {
                    // 정류장: 버스가 가끔 지나간다
                    const f = (tk % 120) / 120;
                    if (f > 0.4) return null;
                    const bx3 = -160 + f * 2.5 * 320;
                    return <Path d={jitterPath(`M${bx3} 296 v-34 q0 -6 6 -6 h56 q8 0 10 10 v30 Z M${bx3 + 8} 266 h14 v12 h-14 Z M${bx3 + 28} 266 h14 v12 h-14 Z M${bx3 + 12} 300 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M${bx3 + 46} 300 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0`, 90 + boil, 0.6)} fill={Paint.yellowSoft} stroke={Paint.ink} strokeWidth={2} strokeLinejoin="round" />;
                  })()}
                </G>
              );
            })}

            {/* 주민: 칠한 곳마다 한 명씩 이사 와서 길을 걷다가 멈춰 수어로 인사한다 */}
            {Array.from({ length: Math.min(completed, titles.length) }, (_, k) => k)
              .filter((k) => alive(k))
              .map((k) => <Resident key={'r' + k} k={k} tk={tk} boil={boil} cheer={cheer} />)}

            {/* 계절 */}
            {season === 'winter' && (
              <Path d={jitterPath(`M0 302 ` + Array.from({ length: 24 }, (_, k) => `Q${(k + 0.5) * (vbW / 24)} ${292 + (k % 2) * 4} ${(k + 1) * (vbW / 24)} 298`).join(' ') + ` V306 H0 Z`, 77 + boil, 0.6)} fill={Paint.snow} stroke={Paint.ink} strokeWidth={1.6} strokeLinejoin="round" />
            )}
            {!reduce &&
              Array.from({ length: season === 'summer' ? (phase === 'night' ? 10 : 0) : FALL_N }, (_, k) => {
                const speed = season === 'winter' ? 0.9 : season === 'summer' ? 0 : 1.3;
                const x0 = (k * 97.3) % vbW;
                const y0 = (k * 53.7) % H;
                const y = season === 'summer' ? TOP + 160 + Math.sin(tk * 0.07 + k) * 40 : TOP + ((y0 + tk * speed * (0.7 + (k % 3) * 0.2)) % H);
                const x = season === 'summer' ? x0 + Math.cos(tk * 0.05 + k * 2) * 20 : x0 + Math.sin(tk * 0.06 + k) * 14 + (season === 'winter' ? 0 : ((tk * 0.4) % vbW));
                const xx = ((x % vbW) + vbW) % vbW;
                const fade = y > 296 ? 0 : 1;
                if (season === 'winter')
                  return <Path key={'f' + k} d={`M${xx - 3.5} ${y} h7 M${xx} ${y - 3.5} v7 M${xx - 2.5} ${y - 2.5} l5 5 M${xx + 2.5} ${y - 2.5} l-5 5`} stroke={Paint.ink} strokeWidth={1.2} strokeLinecap="round" opacity={0.7 * fade} />;
                if (season === 'summer')
                  return <G key={'f' + k} opacity={(tk + k * 4) % 12 < 7 ? 1 : 0.2}><Path d={blob(xx, y, 6, 6, k, 0.1, 7)} fill={Paint.yellowSoft} opacity={0.6} /><Path d={blob(xx, y, 2.4, 2.4, k + 1, 0.1, 6)} fill={Paint.yellow} /></G>;
                const c = season === 'spring' ? Paint.blossom : k % 2 ? Paint.maple : Paint.coral;
                const r = season === 'spring' ? 4 : 5;
                return <Path key={'f' + k} d={blob(xx, y, r, r * 0.6, k + 3, 0.25, 6)} fill={c} stroke={Paint.ink} strokeWidth={1} opacity={0.95 * fade} transform={`rotate(${(tk * 6 + k * 40) % 360} ${xx} ${y})`} />;
              })}

            {/* 이름: 건물 위 간판, 땅 아래에 단원 이름 */}
            {titles.map((t, i) => (
              <G key={'t' + i}>
                <SvgText x={placeX(i)} y={330} fontSize={15} fontFamily={Font.story} fill={i <= completed ? Paint.ink : Paint.inkFaint} textAnchor="middle">
                  {BUILDINGS[i].name === t ? t : `${BUILDINGS[i].name} · ${t}`}
                </SvgText>
              </G>
            ))}

            {/* 지금 할 곳 표시 */}
            {!allDone && paintIndex == null && (
              <G>
                <Path d={jitterPath(`M${placeX(current)} 118 q-6 -14 4 -22 M${placeX(current) + 4} 118 l-6 -6 M${placeX(current) + 4} 118 l6 -6`, 60 + boil, 0.8)} fill="none" stroke={Paint.ink} strokeWidth={2} strokeLinecap="round" />
                <SvgText x={placeX(current)} y={86} fontSize={15} fontFamily={Font.story} fill={Paint.ink} textAnchor="middle">여기부터</SvgText>
              </G>
            )}
            <Rect x={0} y={TOP} width={width / scale} height={H} fill="transparent" />
          </Svg>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: 56, height: 56 }, beeStyle]}>
            <Bee size={56} phase={phase} />
          </Animated.View>
        </View>
      </Pressable>
    </ScrollView>
  );
}
