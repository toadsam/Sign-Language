/**
 * 스케치북 부품.
 * - SketchbookPage: 위쪽에 용수철 고리가 달린 스케치북 한 장. pageKey가 바뀌면 옛 장이 들려서 넘어가고 새 장이 내려앉는다
 * - FlipCard: 누르면 뒤집히는 카드. 앞면과 뒷면을 따로 그려 두고 90도에서 바꿔 끼운다 (웹에서도 뒷면이 비치지 않게)
 * 움직임 줄이기를 켠 사람에게는 넘기기 대신 살짝 나타나기만 하고, 카드는 바로 뒤집힌다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';

import { Paint } from '@/constants/paint';
import { RoughBox } from './paint-ui';
import { jitterPath } from './rough';

/* ── 용수철 고리: 종이에 뚫린 구멍 + 위로 넘어가는 펜 고리 ── */
const RING_GAP = 26;
const RING_H = 30;
function SpiralRings({ width, seed }: { width: number; seed: number }) {
  const rings = useMemo(() => {
    const n = Math.max(3, Math.floor((width - 36) / RING_GAP));
    const start = (width - (n - 1) * RING_GAP) / 2;
    return Array.from({ length: n }, (_, i) => {
      const x = start + i * RING_GAP;
      return {
        key: i,
        // 구멍 (종이 안쪽)
        hole: jitterPath(`M${x - 3.4} 21 Q${x} 17.6 ${x + 3.4} 21 Q${x} 24.4 ${x - 3.4} 21`, seed + i, 0.35),
        // 고리: 구멍에서 나와 종이 위로 둥글게 넘어간다
        coil: jitterPath(`M${x - 2} 21 C${x - 7} 4 ${x + 6} 0 ${x + 3} 19`, seed + i * 3, 0.6),
      };
    });
  }, [width, seed]);
  if (!width) return null;
  return (
    <Svg width={width} height={RING_H} style={styles.rings} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <G strokeLinecap="round" strokeLinejoin="round">
        {rings.map((r) => (
          <G key={r.key}>
            <Path d={r.hole} fill={Paint.paperDeep} stroke={Paint.ink} strokeWidth={1.4} />
            <Path d={r.coil} fill="none" stroke={Paint.ink} strokeWidth={2.2} />
          </G>
        ))}
      </G>
    </Svg>
  );
}

const OUT_MS = 240;

/**
 * 스케치북 한 장.
 * pageKey가 바뀌면 지금 보이는 내용을 붙잡아 둔 채 장을 넘기고, 다 넘어간 뒤에 새 내용으로 바꿔 내려앉힌다.
 */
export function SketchbookPage({ pageKey, children, seed = 90, style }: { pageKey: string; children: ReactNode; seed?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [shownKey, setShownKey] = useState(pageKey);
  // 넘어가는 동안 옛 장의 내용을 그대로 보여 주려고 붙잡아 둔다
  const frozen = useRef<ReactNode>(children);
  if (shownKey === pageKey) frozen.current = children;
  const latestKey = useRef(pageKey);
  latestKey.current = pageKey;
  const first = useRef(true);

  // -1: 오른쪽에서 들어오는 중 · 0: 제자리 · 1: 왼쪽으로 넘어감
  const turn = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (pageKey === shownKey) return;
    if (reduce) {
      // 움직임 줄이기: 넘기지 않고 바로 바꾼 뒤 살짝 나타난다
      fade.value = 0;
      fade.value = withTiming(1, { duration: 180 });
      setShownKey(pageKey);
      return;
    }
    turn.value = withTiming(1, { duration: OUT_MS, easing: Easing.in(Easing.quad) });
    const id = setTimeout(() => setShownKey(latestKey.current), OUT_MS);
    return () => clearTimeout(id);
  }, [pageKey, shownKey, reduce, turn, fade]);

  // 새 내용으로 바뀐 뒤: 오른쪽에서 비스듬히 들어와 살짝 지나쳤다가 자리 잡는다
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce) return;
    turn.value = -0.55;
    turn.value = withSpring(0, { damping: 9, stiffness: 160, mass: 0.8 });
  }, [shownKey, reduce, turn]);

  const pageStyle = useAnimatedStyle(() => {
    const t = turn.value;
    const a = Math.abs(t);
    return {
      opacity: fade.value * (t > 0 ? 1 - t * t * 0.85 : 1 - a * 0.7),
      transform: [
        { perspective: 1000 },
        { translateX: -t * 38 },
        { rotateY: `${-t * 78}deg` },
        { skewY: `${t * 3}deg` },
        { scale: 1 - a * 0.04 },
      ],
    };
  });
  // 들린 종이는 그늘이 져서 조금 어두워진다
  const shadeStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.abs(turn.value)) * 0.16 }));
  // 넘어가는 쪽 가장자리: 진한 종이 띠
  const edgeStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.abs(turn.value) * 2) }));

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - width) > 0.5) setWidth(w);
  };

  return (
    <View style={[styles.wrap, style]} onLayout={onLayout}>
      {/* 밑에 깔린 장 (스케치북 두께) */}
      <RoughBox seed={seed + 1} fill={Paint.paperDeep} strokeWidth={1.6} style={styles.under} />
      <Animated.View style={[styles.page, pageStyle]}>
        <RoughBox seed={seed} fill={Paint.card} style={styles.pagePad}>
          {shownKey === pageKey ? children : frozen.current}
        </RoughBox>
        <Animated.View style={[styles.shade, shadeStyle]} pointerEvents="none" />
        <Animated.View style={[styles.edge, edgeStyle]} pointerEvents="none" />
      </Animated.View>
      <SpiralRings width={width} seed={seed + 7} />
    </View>
  );
}

/**
 * 누르면 뒤집히는 카드.
 * 앞면은 자리를 차지하고, 뒷면은 앞면 크기에 맞춰 겹쳐 둔다. 90도를 지나는 순간 보이는 면을 바꾼다.
 */
export function FlipCard({ flipped, front, back, style }: { flipped: boolean; front: ReactNode; back: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const r = useSharedValue(flipped ? 180 : 0);
  useEffect(() => {
    const to = flipped ? 180 : 0;
    r.value = reduce ? to : withTiming(to, { duration: 460, easing: Easing.inOut(Easing.cubic) });
  }, [flipped, reduce, r]);

  const frontStyle = useAnimatedStyle(() => {
    const v = r.value;
    // 뒤집는 가운데쯤 카드가 살짝 들린다
    const lift = Math.sin((v / 180) * Math.PI);
    return {
      opacity: v < 90 ? 1 : 0,
      transform: [{ perspective: 900 }, { rotateY: `${v}deg` }, { scale: 1 + lift * 0.05 }],
    };
  });
  const backStyle = useAnimatedStyle(() => {
    const v = r.value;
    const lift = Math.sin((v / 180) * Math.PI);
    return {
      opacity: v >= 90 ? 1 : 0,
      transform: [{ perspective: 900 }, { rotateY: `${v - 180}deg` }, { scale: 1 + lift * 0.05 }],
    };
  });

  return (
    <View style={style}>
      <Animated.View
        style={[styles.face, frontStyle, { pointerEvents: flipped ? 'none' : 'auto' }]}
        aria-hidden={flipped}
        importantForAccessibility={flipped ? 'no-hide-descendants' : 'auto'}
      >
        {front}
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.face, backStyle, { pointerEvents: flipped ? 'auto' : 'none' }]}
        aria-hidden={!flipped}
        importantForAccessibility={flipped ? 'auto' : 'no-hide-descendants'}
      >
        {back}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  under: { position: 'absolute', left: 5, right: -3, top: 6, bottom: -6 },
  page: { transformOrigin: 'left center' },
  pagePad: { paddingTop: 30, paddingBottom: 16, paddingHorizontal: 12 },
  shade: { position: 'absolute', left: 4, right: 4, top: 4, bottom: 4, borderRadius: 14, backgroundColor: Paint.ink },
  edge: { position: 'absolute', right: 2, top: 10, bottom: 10, width: 9, borderTopRightRadius: 10, borderBottomRightRadius: 10, backgroundColor: Paint.paperDeep, borderRightWidth: 1.5, borderColor: Paint.line },
  rings: { position: 'absolute', left: 0, top: -12 },
  face: { backfaceVisibility: 'hidden' },
});
