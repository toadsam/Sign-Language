/**
 * 표현 화면 · 북마크 화면이 같이 쓰는 부품.
 * 고르기 칩, 물감 동그라미, 뒤로 가기 머리, 물감 진행 막대, 손 모양 그림.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';

import { Font, Paint, Size } from '@/constants/paint';
import { BodyText, PaintIcon, RoughBox, StoryText, Wash, useBoil } from './paint-ui';
import { blob, jitterPath, rng, roughRect } from './rough';

/* ── 고르기 칩: 고르면 잎사귀색 물감이 번진다 ── */
export function LearnChips<K extends string>({ items, value, onChange, label }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist" accessibilityLabel={label}>
      {items.map((it, i) => (
        <Chip key={it.key} label={it.label} on={it.key === value} seed={30 + i} onPress={() => onChange(it.key)} />
      ))}
    </ScrollView>
  );
}

function Chip({ label, on, seed, onPress }: { label: string; on: boolean; seed: number; onPress: () => void }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    s.value = reduce ? (on ? 1 : 0) : withSpring(on ? 1 : 0, { damping: 11, stiffness: 220 });
  }, [on, reduce, s]);
  const washStyle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: 0.75 * Math.min(1, s.value * 1.4) }));
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} hitSlop={{ top: 4, bottom: 4 }}>
      <RoughBox seed={seed} radius={14} strokeWidth={1.6} style={styles.chip}>
        <Animated.View style={[StyleSheet.absoluteFill, washStyle]} pointerEvents="none">
          <Wash color={Paint.leaf} opacity={1} seed={seed} inset={3} />
        </Animated.View>
        <BodyText size={14} style={on ? { fontFamily: Font.story } : undefined}>{label}</BodyText>
      </RoughBox>
    </Pressable>
  );
}

/* ── 물감 동그라미 (장소 카드 왼쪽). 잠긴 곳은 점선만 ── */
export function Swatch({ color, locked, size = 48, seed = 1 }: { color: string; locked?: boolean; size?: number; seed?: number }) {
  const r = size * 0.375;
  const c = size / 2;
  const fill = useMemo(() => blob(c, c, r, r, seed, 0.12, 11), [c, r, seed]);
  const ring = useMemo(() => blob(c, c, r, r, seed + 3, 0.05, 14), [c, r, seed]);
  return (
    <Svg width={size} height={size} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {!locked && <Path d={fill} fill={color} opacity={0.9} />}
      <Path d={ring} fill="none" stroke={Paint.ink} strokeWidth={1.8} strokeDasharray={locked ? '4 5' : undefined} opacity={locked ? 0.5 : 1} />
    </Svg>
  );
}

/* ── 화면 맨 위: 뒤로 가기(누른 자리를 넘긴다) + 제목 + 한 줄 ── */
export function LearnHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: (p: { x: number; y: number }) => void; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable
          onPress={(e) => onBack({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
          style={styles.back}
        >
          <PaintIcon name="back" size={30} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <StoryText size={Size.heading} accessibilityRole="header">{title}</StoryText>
        {sub ? <BodyText soft size={Size.small}>{sub}</BodyText> : null}
      </View>
      {right}
    </View>
  );
}

/* ── 물감 진행 막대: 손그림 테두리 안을 물감이 채운다 ── */
export function PaintProgress({ percent, color = Paint.leaf, seed = 41, label }: { percent: number; color?: string; seed?: number; label: string }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const p = useSharedValue(0);
  const clamped = Math.max(0, Math.min(100, percent));
  useEffect(() => {
    p.value = reduce ? clamped : withTiming(clamped, { duration: 680 });
  }, [clamped, reduce, p]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${p.value}%` }));
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const frame = useMemo(() => (w ? roughRect(w, 18, { seed, r: 9 }) : ''), [w, seed]);
  return (
    <View
      style={styles.track}
      onLayout={onLayout}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      <Animated.View style={[styles.fill, fillStyle]}>
        <Wash color={color} opacity={0.9} seed={seed} inset={1} />
      </Animated.View>
      {w > 0 && (
        <Svg width={w} height={18} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={frame} fill="none" stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

/* ── 작은 손그림 아이콘 버튼 (44 이상) ── */
export function LearnIconButton({ children, onPress, label, disabled, style }: { children: ReactNode; onPress: () => void; label: string; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={({ pressed }) => [{ opacity: disabled ? 0.5 : 1, transform: pressed ? [{ rotate: '-4deg' }] : [] }, style]}>
      <RoughBox seed={51} radius={22} strokeWidth={1.8} style={styles.iconBtn}>
        {children}
      </RoughBox>
    </Pressable>
  );
}

/* ── 손 모양 그림 (카드 뒷면): 펜 선 손 + 뒤에 번진 물감. seed마다 모양과 기울기가 조금씩 다르다 ── */
const HAND_POSES = [
  // 편 손바닥
  'M34 92 Q26 74 28 58 L22 34 Q20 26 27 25 Q33 25 34 33 L39 52 L38 20 Q38 12 45 12 Q52 12 52 20 L53 50 L56 16 Q57 8 64 9 Q70 10 70 18 L67 52 L74 26 Q76 19 82 21 Q88 23 86 31 L78 64 Q86 58 92 60 Q98 63 94 70 L80 88 Q70 100 52 100 Q40 100 34 92',
  // 주먹
  'M30 96 Q26 78 30 62 Q32 44 44 40 Q50 34 58 38 Q64 32 72 37 Q80 33 86 40 Q94 42 92 56 L90 78 Q86 98 64 100 Q42 102 30 96 M44 40 Q42 52 46 60 M58 38 Q56 50 60 58 M72 37 Q70 50 74 58 M34 66 Q50 58 68 66 Q74 70 70 76',
  // 검지로 가리키기
  'M34 96 Q28 80 32 64 Q34 54 42 52 L50 50 L50 18 Q50 10 57 10 Q64 10 64 18 L64 52 Q72 48 78 54 Q86 52 90 60 Q94 64 92 74 L88 86 Q80 102 58 102 Q42 102 34 96 M64 56 Q70 62 66 68 M78 56 Q82 64 78 70 M42 52 Q36 64 50 70 Q60 72 62 66',
  // 두 손가락 (브이)
  'M36 96 Q28 80 32 64 Q34 56 42 54 L34 22 Q32 14 39 12 Q46 11 48 19 L56 50 L62 18 Q64 10 71 11 Q78 13 76 21 L70 54 Q80 52 86 58 Q92 64 90 74 L86 86 Q78 102 58 102 Q44 102 36 96 M70 58 Q76 64 72 70 M42 56 Q36 66 50 72 Q60 74 62 68',
];
export function HandSketch({ seed = 1, color = Paint.yellowSoft, size = 64, boil }: { seed?: number; color?: string; size?: number; boil?: boolean }) {
  const t = useBoil(!!boil);
  const pose = HAND_POSES[Math.abs(Math.floor(seed)) % HAND_POSES.length];
  const tilt = useMemo(() => (rng(seed + 11)() - 0.5) * 18, [seed]);
  const d = useMemo(() => jitterPath(pose, seed * 7 + t, 0.8), [pose, seed, t]);
  const washD = useMemo(() => blob(60, 62, 40, 36, seed + 2, 0.14, 11), [seed]);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 116 116">
        <Path d={washD} fill={color} opacity={0.85} />
        <G transform={`rotate(${tilt.toFixed(1)} 58 58)`}>
          <Path d={d} fill="none" stroke={Paint.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 4 },
  chip: { height: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8 },
  track: { height: 18, borderRadius: 9, overflow: 'hidden' },
  fill: { height: '100%' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
