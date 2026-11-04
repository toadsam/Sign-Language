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
    ink: 'M784 176 L784 302 M956 176 L956 302 M778 176 L962 176 M836 176 L870 138 L904 176 M860 160 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M870 154 v6 l4 3 M870 138 V112 L894 120 L870 128 M800 200 h30 v30 h-30 z M910 200 h30 v30 h-30 z M800 246 h30 v30 h-30 z M910 246 h30 v30 h-30 z M852 302 V244 H888 V302 M870 244 V302',
    paint: [{ d: rect(784, 176, 172, 126), c: Paint.yellowSoft }, { d: 'M836 176 L870 138 L904 176Z', c: Paint.coral }],
  },
  {
    name: '병원', orig: 1060,
    ink: 'M984 160 L984 302 M1136 160 L1136 302 M978 160 L1142 160 M1060 180 v20 M1050 190 h20 M1046 176 h28 v28 h-28 z M1000 220 h28 v26 h-28 z M1092 220 h28 v26 h-28 z M1040 302 V256 H1080 V302 M1060 256 V302',
    paint: [{ d: rect(984, 160, 152, 142), c: '#FFFFFF' }, { d: rect(1046, 176, 28, 28), c: Paint.coral }],
  },
];
// 카페 앞에서 수어로 이야기하는 두 사람
const PAIR = 'M442 248 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M452 258 L446 296 M452 258 L458 296 M452 266 L466 258 L472 248 M452 266 L462 276 L470 270 M520 250 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M530 260 L524 296 M530 260 L536 296 M530 268 L520 278 L512 274 M530 268 L540 280 M478 240 q6 6 0 12 M484 236 q9 10 0 20';

type Props = {
  titles: string[];
  completed: number;
  /** 지금 막 다 배운 단원 번호 (돌아왔을 때 칠해지는 애니메이션) */
  paintIndex?: number | null;
  height?: number;
  onPressPlace: (index: number, at: { x: number; y: number }) => void;
};

export function Village({ titles, completed, paintIndex = null, height = 290, onPressPlace }: Props) {
  const reduce = useReducedMotion();
  const boil = useBoil();
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
  const pair = useMemo(() => jitterPath(PAIR, 40 + boil, 0.9), [boil]);
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
            {/* 해와 언덕 */}
            <Path d={blob(96, 64, 30, 30, 2)} fill={Paint.yellow} opacity={0.9} />
            <Path d={jitterPath('M70 64 a26 26 0 1 0 52 0 a26 26 0 1 0 -52 0 M96 24 v-10 M96 104 v10 M56 64 h-10 M136 64 h10 M68 36 l-7 -7 M124 92 l7 7 M124 36 l7 -7 M68 92 l-7 7', 3 + boil, 1)} fill="none" stroke={Paint.ink} strokeWidth={2.2} strokeLinecap="round" />
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
            <Bee size={56} />
          </Animated.View>
        </View>
      </Pressable>
    </ScrollView>
  );
}
