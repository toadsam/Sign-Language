/**
 * 앱을 켤 때 보이는 첫 화면 (색칠 마을).
 * 1. 펜이 작은 마을과 두 손을 그린다
 * 2. 두 손이 손짓을 주고받고, 그 사이에서 노란 물감이 번진다
 * 3. 마을 창문에 색이 하나씩 켜지고, 로고와 한 줄 소개가 떠오른다
 * 4. 꿀짓이가 날아 들어온 뒤, 물감이 화면을 덮었다가 걷히며 앱이 나온다
 * 화면을 누르면 바로 넘어간다. 움직임 줄이기를 켠 사람에게는 완성된 그림만 잠깐 보여 준다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

import { Font, Paint } from '@/constants/paint';
import { LOGO_LETTERS, LOGO_NAME } from './paint/logo';
import { blob, jitterPath, pathLength } from './paint/rough';
import { useBoil } from './paint/paint-ui';

export const SPLASH_LINE = '손으로 건네는 말, 색으로 배우는 마을';

const TOWN = [
  'M24 562 H336',
  'M58 562 V528 L78 510 L98 528 V562 M72 562 V544 H84 V562',
  'M112 562 V512 H150 V562 M108 512 H154 M122 528 H140 V540 H122 Z',
  'M212 562 V522 L232 504 L252 522 V562 M226 536 H238 V548 H226 Z',
  'M266 562 V520 H302 V562 M262 520 H306 M276 534 h16 M276 546 h16',
];
const HAND = 'M46 92 V34 q0 -8 7 -8 q7 0 7 8 V74 M60 74 V22 q0 -8 7 -8 q7 0 7 8 V74 M74 74 V28 q0 -8 7 -8 q7 0 7 8 V78 M88 78 V44 q0 -7 7 -7 q7 0 7 7 V100 q0 30 -30 34 q-24 2 -34 -16 L26 92 q-5 -8 2 -12 q7 -4 13 3 L46 98';
const WINDOWS: [number, number, string][] = [[78, 530, Paint.sky], [130, 526, Paint.coral], [232, 530, Paint.leaf], [284, 534, Paint.yellow]];
const ROUTE = (t: number) => {
  // 꿀짓이가 날아오는 길 (왼쪽 위 → 오른손 위)
  const u = 1 - t;
  const p0 = [-40, 120], p1 = [60, 40], p2 = [140, 220], p3 = [300, 176];
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function SplashOverlay({ onDone, ready = true }: { onDone: () => void; ready?: boolean }) {
  const reduce = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [t, setT] = useState(0); // 0~1: 장면 진행, 1~1.25: 덮고 걷히기
  const done = useRef(false);
  const boil = useBoil();
  const townLens = useMemo(() => TOWN.map(pathLength), []);
  const handLen = useMemo(() => pathLength(HAND), []);
  const TOTAL = 5200; // 장면 길이(ms)

  function finish() {
    if (done.current) return;
    done.current = true;
    onDone();
  }

  useEffect(() => {
    if (!ready) return;
    if (reduce) {
      setT(1);
      const id = setTimeout(finish, 1400);
      return () => clearTimeout(id);
    }
    let raf = 0;
    const t0 = Date.now();
    const step = () => {
      const k = (Date.now() - t0) / TOTAL;
      setT(k);
      if (k < 1.3) raf = requestAnimationFrame(step);
      else finish();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reduce]);

  // 장면별 진행도 (전체 시간에서 각 장면이 차지하는 구간)
  const seg = (a: number, b: number) => ease(clamp01((t - a) / (b - a)));
  const town = TOWN.map((_, i) => seg(0.05 + i * 0.025, 0.2 + i * 0.025));
  const hands = [seg(0.12, 0.32), seg(0.16, 0.36)];
  const sign = t > 0.34 && t < 0.62 ? Math.sin((t - 0.34) * 60) * 7 : 0;
  const blobR = seg(0.36, 0.56);
  const wins = WINDOWS.map((_, i) => seg(0.44 + i * 0.03, 0.54 + i * 0.03));
  const tag = seg(0.62, 0.72);
  const fly = seg(0.66, 0.92);
  const [bx, by] = ROUTE(fly);
  // 마지막: 노란 물감이 번져 덮었다가 전체가 옅어진다
  const cover = clamp01((t - 1) / 0.12), fade = clamp01((t - 1.12) / 0.15);

  const boilD = (d: string, s: number) => (boil ? jitterPath(d, s + boil, 0.7) : d);

  return (
    <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: Paint.paper, opacity: 1 - fade }]} onPress={finish} accessibilityRole="button" accessibilityLabel={`${LOGO_NAME} 시작 화면. 누르면 건너뜁니다`}>
      <Svg width={width} height={height} viewBox="0 0 360 700" preserveAspectRatio="xMidYMid meet">
        {/* 손 사이에서 번지는 노란 물감 */}
        <Path d={blob(180, 262, 120 * blobR + 0.1, 120 * blobR + 0.1, 3, 0.12)} fill={Paint.yellowSoft} />
        <Path d={blob(180, 262, 70 * seg(0.42, 0.6) + 0.1, 70 * seg(0.42, 0.6) + 0.1, 8, 0.14)} fill={Paint.yellow} opacity={0.85} />
        {WINDOWS.map(([x, y, c], i) => (
          <Path key={i} d={blob(x, y, 20 * wins[i] + 0.1, 20 * wins[i] + 0.1, 20 + i, 0.15, 8)} fill={c} opacity={0.9} />
        ))}
        <G fill="none" stroke={Paint.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          {TOWN.map((d, i) => (
            <Path key={i} d={boilD(d, i)} strokeDasharray={`${townLens[i]} ${townLens[i]}`} strokeDashoffset={townLens[i] * (1 - town[i])} />
          ))}
          <G transform={`translate(76 186) rotate(${sign} 64 136)`}>
            <Path d={boilD(HAND, 7)} strokeDasharray={`${handLen} ${handLen}`} strokeDashoffset={handLen * (1 - hands[0])} />
          </G>
          <G transform={`translate(284 186) scale(-1 1) rotate(${-sign} 64 136)`}>
            <Path d={boilD(HAND, 9)} strokeDasharray={`${handLen} ${handLen}`} strokeDashoffset={handLen * (1 - hands[1])} />
          </G>
          <Path d="M164 198 q16 -14 32 0 M156 186 q24 -22 48 0" opacity={seg(0.36, 0.42) * 0.8} />
        </G>
        {/* 글씨 로고: 글자마다 메뉴 물감 한 방울이 톡 번지고 그 위에 글자가 앉는다 (logo.tsx 와 같은 글자·색) */}
        {LOGO_LETTERS.map((l, i) => {
          const p = seg(0.54 + i * 0.03, 0.62 + i * 0.03);
          const x = 117 + i * 42, y = 396 + l.dy;
          const r = 24 * p + 0.1;
          return (
            <G key={l.ch} opacity={Math.min(1, p * 1.6)} transform={`rotate(${l.tilt} ${x} ${y})`}>
              <Path d={blob(x, y, r, r, 30 + i * 5, 0.12, 10)} fill={l.color} opacity={0.85} />
              <Path d={blob(x + 2, y + 1, r * 0.7, r * 0.7, 40 + i * 5, 0.14, 9)} fill={l.color} opacity={0.4} />
              <SvgText x={x} y={y + 11 - 6 * (1 - p)} fontSize={31} fontFamily={Font.story} fill={Paint.ink} textAnchor="middle">{l.ch}</SvgText>
            </G>
          );
        })}
        <SvgText x={180} y={462} fontSize={15} fontFamily={Font.body} fill={Paint.inkSoft} textAnchor="middle" opacity={tag}>{SPLASH_LINE}</SvgText>
        {/* 꿀짓이 */}
        {fly > 0 && (
          <G transform={`translate(${bx} ${by})`}>
            <Path d="M-3 -14 a7 10 0 1 0 0.1 0 M6 -13 a6 9 0 1 0 0.1 0" fill="#FFFFFFCC" stroke={Paint.ink} strokeWidth={2} transform={`rotate(${Math.sin(t * 400) * 18} 0 -4)`} />
            <Path d="M-16 0 a16 12 0 1 0 32 0 a16 12 0 1 0 -32 0" fill={Paint.yellow} stroke={Paint.ink} strokeWidth={2.2} />
            <Path d="M-5 -11 q-3 11 0 22 M3 -11 q3 11 0 22" fill="none" stroke={Paint.ink} strokeWidth={2} />
          </G>
        )}
        <SvgText x={180} y={660} fontSize={12} fontFamily={Font.body} fill={Paint.inkSoft} textAnchor="middle">화면을 누르면 건너뛰어요</SvgText>
      </Svg>
      {cover > 0 && (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Path d={blob(width / 2, height * 0.38, Math.hypot(width, height) * cover + 1, Math.hypot(width, height) * cover + 1, 4, 0.1)} fill={Paint.yellow} />
        </Svg>
      )}
    </Pressable>
  );
}
