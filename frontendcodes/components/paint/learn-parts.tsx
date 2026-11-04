/**
 * 표현 화면 · 북마크 화면이 같이 쓰는 부품.
 * 고르기 칩, 물감 동그라미, 뒤로 가기 머리, 물감 진행 막대.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Font, Paint, Size } from '@/constants/paint';
import { BodyText, PaintIcon, RoughBox, StoryText, Wash } from './paint-ui';
import { blob, roughRect } from './rough';

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

const styles = StyleSheet.create({
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 4 },
  chip: { height: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8 },
  track: { height: 18, borderRadius: 9, overflow: 'hidden' },
  fill: { height: '100%' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
