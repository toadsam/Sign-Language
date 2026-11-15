/**
 * 처음 켰을 때 한 번만 보는 짧은 이야기 (3장면).
 * 1. 빈 종이에 꿀짓이가 날아와 펜으로 마을 밑그림을 한 획씩 그린다.
 * 2. 꿀짓이가 붓을 들고 집 하나에 물감을 번지게 칠한다.
 * 3. 두세 곳이 칠해진 마을에서 꿀짓이가 손을 흔든다.
 * 움직임 줄이기를 켜면 다 그린 그림이 바로 보인다.
 *
 * 한 번 봤는지는 hasSeenFirstStory / markFirstStorySeen 으로 기억한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';
import * as SecureStore from 'expo-secure-store';

import { Paint, Size } from '@/constants/paint';
import { Bee } from './bee';
import { Handwrite } from './handwrite';
import { PaintButton, PaperScreen, useBoil } from './paint-ui';
import { blob, jitterPath, pathLength } from './rough';

/* ── 한 번 봤는지 기억하기 ── */
const SEEN_KEY = 'firstStorySeen';

export async function hasSeenFirstStory(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(SEEN_KEY) === '1';
    return (await SecureStore.getItemAsync(SEEN_KEY)) === '1';
  } catch {
    // 읽지 못하면 안 본 것으로 (다시 보여 주는 쪽이 덜 나쁘다)
    return false;
  }
}

export async function markFirstStorySeen(): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(SEEN_KEY, '1');
    else await SecureStore.setItemAsync(SEEN_KEY, '1');
  } catch {
    // 저장 실패는 조용히 넘긴다 (다음에 한 번 더 볼 뿐)
  }
}

/* ── 그림 좌표 (viewBox 320 × 220) ── */
const VW = 320, VH = 220;
type Pt = [number, number];
type Stroke = { d: string; s: Pt; e: Pt; w?: number };

// 펜이 긋는 순서대로. s·e는 펜촉이 지나가는 시작·끝 자리 (꿀짓이가 따라간다)
const STROKES: Stroke[] = [
  { d: 'M14 182 Q160 176 306 182', s: [14, 182], e: [306, 182] }, // 땅
  { d: 'M48 182 V128 M112 182 V128', s: [48, 182], e: [112, 128] }, // 집1 벽
  { d: 'M38 132 L80 96 L122 132', s: [38, 132], e: [122, 132] }, // 집1 지붕
  { d: 'M72 182 V156 Q80 150 88 156 V182', s: [72, 182], e: [88, 182] }, // 집1 문
  { d: 'M94 140 H106 V152 H94 Z', s: [94, 140], e: [94, 152] }, // 집1 창
  { d: 'M160 182 V148', s: [160, 182], e: [160, 148] }, // 나무 줄기
  { d: blob(160, 128, 22, 24, 4, 0.14, 10), s: [182, 128], e: [182, 128] }, // 나무 잎
  { d: 'M208 182 V136 M282 182 V136', s: [208, 182], e: [282, 136] }, // 집2 벽
  { d: 'M200 136 H290 L276 112 H214 Z', s: [200, 136], e: [214, 112] }, // 집2 지붕
  { d: 'M236 182 V158 H254 V182', s: [236, 182], e: [254, 182] }, // 집2 문
  { d: 'M262 148 H274 V160 H262 Z', s: [262, 148], e: [262, 160] }, // 집2 창
  { d: 'M80 184 Q96 200 150 205 Q214 210 245 184', s: [80, 184], e: [245, 184], w: 1.8 }, // 오솔길
  { d: blob(272, 48, 14, 14, 9, 0.08, 9), s: [286, 48], e: [286, 48] }, // 해
];

// 물감 자리: 번지기 시작하는 가운데(c)와 모양
type Spot = { c: Pt; parts: { d: string; color: string; o?: number }[] };
const HOUSE1: Spot = {
  c: [80, 148],
  parts: [
    { d: blob(80, 156, 36, 28, 11, 0.08, 12), color: Paint.yellowSoft },
    { d: blob(80, 118, 36, 14, 12, 0.1, 10), color: Paint.coral, o: 0.85 },
    { d: blob(100, 146, 8, 8, 13, 0.1, 8), color: Paint.sky },
  ],
};
const SUN: Spot = { c: [272, 48], parts: [{ d: blob(272, 48, 15, 15, 41, 0.1, 10), color: Paint.yellow, o: 0.9 }] };
const TREE: Spot = { c: [160, 128], parts: [{ d: blob(160, 128, 24, 26, 21, 0.12, 11), color: Paint.leaf, o: 0.85 }] };
const HOUSE2: Spot = {
  c: [245, 150],
  parts: [
    { d: blob(245, 124, 40, 12, 31, 0.1, 10), color: Paint.yellow, o: 0.85 },
    { d: blob(245, 160, 36, 22, 32, 0.08, 12), color: Paint.sky, o: 0.75 },
  ],
};

/* ── 0 → 1 진행 시계 (장면마다 처음부터) ── */
function useProgress(ms: number, enabled: boolean, delay = 0) {
  const [k, setK] = useState(enabled ? 0 : 1);
  useEffect(() => {
    if (!enabled) {
      setK(1);
      return;
    }
    let raf = 0;
    const t0 = Date.now() + delay;
    const step = () => {
      const t = Math.max(0, Math.min(1, (Date.now() - t0) / ms));
      setK(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ms, enabled, delay]);
  return k;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);

/* ── 마을 밑그림: draw 0→1 이면 획 순서대로 그려진다 ── */
function Outline({ draw, boil }: { draw: number; boil: number }) {
  const paths = useMemo(() => STROKES.map((s, i) => jitterPath(s.d, 3 + i * 1.7 + boil * 0.37, 0.8)), [boil]);
  // 흔든 선은 길이가 조금 달라서 넉넉히 잡는다
  const lens = useMemo(() => STROKES.map((s) => pathLength(s.d) * 1.08 + 4), []);
  const n = STROKES.length;
  return (
    <G>
      {paths.map((d, i) => {
        const u = Math.max(0, Math.min(1, draw * n - i));
        if (u <= 0) return null;
        const L = lens[i];
        return (
          <Path
            key={i}
            d={d}
            fill="none"
            stroke={Paint.ink}
            strokeWidth={STROKES[i].w ?? 2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={u < 1 ? `${L} ${L}` : undefined}
            strokeDashoffset={u < 1 ? L * (1 - easeOut(u)) : undefined}
            opacity={i === n - 2 ? 0.7 : 1}
          />
        );
      })}
    </G>
  );
}

/* ── 물감 번짐: k 0→1 이면 가운데서부터 퍼진다 ── */
function Bloom({ spot, k }: { spot: Spot; k: number }) {
  if (k <= 0) return null;
  const s = easeOut(k);
  const [cx, cy] = spot.c;
  return (
    <G transform={k < 1 ? `translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})` : undefined}>
      {spot.parts.map((p, i) => (
        <Path key={i} d={p.d} fill={p.color} opacity={(p.o ?? 0.9) * Math.min(1, k * 1.6)} />
      ))}
    </G>
  );
}

/* 펜촉 (pen-loader와 같은 연필) */
function Pencil({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(-50)`}>
      <Path d="M0 0 L5 -5 L26 -5 L26 5 L5 5 Z" fill={Paint.coral} stroke={Paint.ink} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M0 0 L5 -5 L5 5 Z" fill={Paint.ink} />
    </G>
  );
}

/* 붓: 끝(x, y)에 물감이 묻어 있다 */
function Brush({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(-40)`}>
      <Path d="M10 -2 L40 -2 L40 2 L10 2 Z" fill={Paint.maple} stroke={Paint.ink} strokeWidth={1.6} strokeLinejoin="round" />
      <Path d="M6 -4 L12 -4 L12 4 L6 4 Z" fill={Paint.card} stroke={Paint.ink} strokeWidth={1.6} />
      <Path d="M6 -4 Q-2 -3 -2 0 Q-2 3 6 4 Z" fill={Paint.coral} stroke={Paint.ink} strokeWidth={1.6} strokeLinejoin="round" />
    </G>
  );
}

/* ── 장면 그림 ── */
const BEE = 58;

function SceneArt({ scene, width, reduce }: { scene: number; width: number; reduce: boolean }) {
  const boil = useBoil();
  const k = useProgress(scene === 0 ? 4200 : scene === 1 ? 1800 : 1500, !reduce, scene === 0 ? 0 : 250);
  const scale = width / VW;
  const height = VH * scale;

  let draw = 1;
  let bee: Pt = [160, 60];
  let tip: Pt | null = null;
  let brush: Pt | null = null;
  let wave = false;
  const blooms: { spot: Spot; k: number }[] = [];

  if (scene === 0) {
    // 앞 12%: 오른쪽 밖에서 날아온다 → 나머지: 획을 하나씩 긋는다
    const FLY = 0.12;
    const n = STROKES.length;
    if (k < FLY) {
      draw = 0;
      const f = easeOut(k / FLY);
      const s0 = STROKES[0].s;
      tip = [lerp(VW + 40, s0[0], f), lerp(30, s0[1], f)];
    } else {
      draw = (k - FLY) / (1 - FLY);
      const i = Math.min(n - 1, Math.floor(draw * n));
      const u = Math.min(1, draw * n - i);
      const st = STROKES[i];
      tip = k >= 1 ? null : [lerp(st.s[0], st.e[0], u), lerp(st.s[1], st.e[1], u)];
    }
    bee = tip ? [tip[0] + 14, tip[1] - 26] : [250, 76];
  } else if (scene === 1) {
    // 꿀짓이가 집 오른쪽 위에서 붓으로 칠한다
    bee = [128, 86];
    brush = [100, 140];
    blooms.push({ spot: HOUSE1, k });
  } else {
    // 세 곳이 차례로 칠해지고, 꿀짓이가 손을 흔든다
    bee = [196, 66];
    wave = true;
    blooms.push({ spot: HOUSE1, k: 1 });
    blooms.push({ spot: TREE, k: Math.max(0, Math.min(1, k * 2)) });
    blooms.push({ spot: HOUSE2, k: Math.max(0, Math.min(1, k * 2 - 0.6)) });
    blooms.push({ spot: SUN, k: Math.max(0, Math.min(1, k * 2 - 1)) });
  }

  const tilt = wave ? [-14, 0, 14, 0][boil] : 0;
  const size = BEE * Math.max(0.8, Math.min(1.2, scale));

  return (
    <View style={{ width, height }} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={width} height={height} viewBox={`0 0 ${VW} ${VH}`}>
        {blooms.map((b, i) => (
          <Bloom key={i} spot={b.spot} k={b.k} />
        ))}
        <Outline draw={draw} boil={boil} />
        {tip && !reduce && <Pencil x={tip[0]} y={tip[1]} />}
        {brush && <Brush x={brush[0]} y={brush[1]} />}
      </Svg>
      <View
        style={[
          styles.bee,
          { width: size, height: size, left: bee[0] * scale - size / 2, top: bee[1] * scale - size / 2, transform: [{ rotate: `${tilt}deg` }] },
        ]}
      >
        <Bee size={size} still={reduce} />
      </View>
    </View>
  );
}

/* ── 아래 쪽 표시: 잉크 동그라미 (지금 장면은 칠해져 있다) ── */
function PageDots({ index, count }: { index: number; count: number }) {
  const W = count * 18;
  return (
    <View style={{ width: W, height: 14 }} accessible accessibilityRole="text" accessibilityLabel={`${count}장 중 ${index + 1}장`}>
      <Svg width={W} height={14} viewBox={`0 0 ${W} 14`}>
        {Array.from({ length: count }, (_, i) =>
          i === index ? (
            <Path key={i} d={blob(9 + i * 18, 7, 5, 5, 40 + i, 0.12, 8)} fill={Paint.ink} />
          ) : (
            <Circle key={i} cx={9 + i * 18} cy={7} r={4.2} fill="none" stroke={Paint.ink} strokeWidth={1.6} opacity={0.6} />
          ),
        )}
      </Svg>
    </View>
  );
}

/* ── 본체 ── */
type Props = {
  visible: boolean;
  /** 건너뛰기 · 마지막 버튼을 누르면 (본 것으로 저장한 뒤) 부른다 */
  onDone: () => void;
  nickname?: string | null;
};

const SCENES = 3;

export function FirstStory({ visible, onDone, nickname }: Props) {
  const reduce = useReducedMotion();
  const [scene, setScene] = useState(0);
  const [artW, setArtW] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const busy = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // 다시 보일 때는 처음 장면부터
  useEffect(() => {
    if (visible) {
      setScene(0);
      fade.setValue(1);
      busy.current = false;
    }
  }, [visible, fade]);

  const finish = () => {
    void markFirstStorySeen();
    doneRef.current();
  };

  // 안드로이드 뒤로 가기 = 건너뛰기
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finish();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  const next = () => {
    if (scene >= SCENES - 1) {
      finish();
      return;
    }
    if (reduce) {
      setScene((s) => s + 1);
      return;
    }
    if (busy.current) return;
    busy.current = true;
    // 빠르게 흐려졌다가 다음 장면이 떠오른다
    Animated.timing(fade, { toValue: 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start(() => {
      setScene((s) => s + 1);
      Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start(() => {
        busy.current = false;
      });
    });
  };

  if (!visible) return null;

  const name = nickname?.trim();
  const texts = [
    '여기는 아직 색이 없는 마을이에요.',
    '수어 표현을 하나 배울 때마다 마을이 한 곳씩 칠해져요.',
    name ? `${name}님, 저랑 같이 마을을 칠해 볼까요?` : '저랑 같이 마을을 칠해 볼까요?',
  ];
  const last = scene === SCENES - 1;

  const onArtLayout = (e: LayoutChangeEvent) => {
    const w = Math.min(e.nativeEvent.layout.width, 380);
    if (Math.abs(w - artW) > 0.5) setArtW(w);
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]} accessibilityViewIsModal aria-modal>
      <PaperScreen edges={['top', 'bottom']}>
        <View style={styles.top}>
          <PaintButton variant="text" label="건너뛰기" onPress={finish} accessibilityLabel="이야기 건너뛰기" style={{ alignSelf: 'flex-end' }} />
        </View>

        <Animated.View style={[styles.body, { opacity: fade }]}>
          <View style={styles.artWrap} onLayout={onArtLayout}>
            {artW > 0 && <SceneArt key={scene} scene={scene} width={artW} reduce={reduce} />}
          </View>
          <Handwrite
            text={texts[scene]}
            runKey={scene}
            size={Size.title}
            align="center"
            delay={reduce ? 0 : scene === 0 ? 600 : 300}
            seed={scene + 2}
            style={styles.text}
            accessibilityLiveRegion="polite"
          />
        </Animated.View>

        <View style={styles.bottom}>
          <PageDots index={scene} count={SCENES} />
          <PaintButton label={last ? '같이 칠하러 가기' : '다음'} onPress={next} seed={11 + scene} style={styles.button} />
        </View>
      </PaperScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 100, elevation: 100, backgroundColor: Paint.paper },
  top: { paddingHorizontal: 12, paddingTop: 4, minHeight: 48 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 24 },
  artWrap: { width: '100%', maxWidth: 380, alignItems: 'center' },
  text: { maxWidth: 340, minHeight: Size.title * 1.38 * 2 + 8 },
  bottom: { alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingBottom: 20 },
  button: { alignSelf: 'stretch', maxWidth: 380, width: '100%', marginHorizontal: 'auto' },
  bee: { position: 'absolute' },
});
