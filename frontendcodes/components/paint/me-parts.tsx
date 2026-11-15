/**
 * 기록 · 오답 노트 화면에서 쓰는 부품.
 * 얼굴 동그라미, 물감 숫자 얼룩, 이번 주 물방울, 줄 하나짜리 메뉴, 뒤로 가기 머리줄.
 */
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { Font, Paint, Size } from '@/constants/paint';
import { getKstDateKey } from '@/lib/daily-goal';
import { BodyText, PaintIcon, StoryText, Wash, type PaintIconName } from './paint-ui';

/** 숫자가 0부터 올라간다. 움직임 줄이기를 켜면 바로 끝 숫자 */
export function useCountUp(target: number, duration = 620) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) {
      setValue(target);
      return;
    }
    const startedAt = Date.now();
    setValue(0);
    const timer = setInterval(() => {
      const p = Math.min((Date.now() - startedAt) / duration, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration, reduce]);
  return value;
}

/* ── 얼굴 동그라미: 사진이 있으면 사진, 없으면 펜으로 그린 얼굴 ── */
export function MeAvatar({ uri, size = 76 }: { uri?: string | null; size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <Wash color={Paint.yellowSoft} opacity={0.95} seed={11} />
      {uri ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          style={{ position: 'absolute', left: 6, top: 6, width: size - 12, height: size - 12, borderRadius: (size - 12) / 2 }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Svg width={size} height={size} viewBox="0 0 72 72" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle cx={36} cy={36} r={32} fill="none" stroke={Paint.ink} strokeWidth={2.2} />
        {!uri ? (
          <Path
            d="M36 19 a11 11 0 1 0 0.01 0 M16 58 q20 -22 40 0 M32 29 v2 M40 29 v2 M32 35 q4 3 8 0"
            fill="none"
            stroke={Paint.ink}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
}

/* ── 물감 얼룩 위 숫자 ── */
export function StatBlob({ value, unit, label, color, seed }: { value: number; unit?: string; label: string; color: string; seed: number }) {
  const shown = useCountUp(value);
  return (
    <View style={styles.blob} accessible accessibilityLabel={`${label} ${value}${unit ?? ''}`}>
      <Wash color={color} opacity={0.7} seed={seed} inset={6} />
      <StoryText size={32} style={{ lineHeight: 36 }}>
        {shown}
        {unit ? <StoryText size={15} style={{ color: Paint.inkSoft }}>{unit}</StoryText> : null}
      </StoryText>
      <BodyText size={Size.small} style={{ marginTop: 4 }}>{label}</BodyText>
    </View>
  );
}

/* ── 이번 주 물방울 7개 (월~일). 그날 문제를 풀었으면 채운다 ── */
const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
function weekKeys() {
  const [y, m, d] = getKstDateKey().split('-').map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  return DAY_NAMES.map((_, i) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - mondayOffset + i);
    return { key: day.toISOString().slice(0, 10), isToday: i === mondayOffset, isFuture: i > mondayOffset };
  });
}
export function WeekDrops({ counts }: { counts: Record<string, number> }) {
  const days = weekKeys();
  const studied = days.filter((d) => (counts[d.key] ?? 0) > 0).length;
  return (
    <View style={styles.week} accessible accessibilityLabel={`이번 주 ${studied}일 배움`}>
      {days.map((d, i) => {
        const full = (counts[d.key] ?? 0) > 0;
        return (
          <View key={d.key} style={styles.weekDay}>
            <Svg width={28} height={30} viewBox="0 0 28 30">
              <Path
                d="M14 3 C9 11 5 15 5 20 a9 9 0 0 0 18 0 C23 15 19 11 14 3 Z"
                fill={full ? Paint.yellow : 'none'}
                stroke={Paint.ink}
                strokeWidth={1.7}
                strokeLinejoin="round"
                strokeDasharray={d.isToday && !full ? '3 3' : undefined}
                opacity={d.isFuture ? 0.45 : 1}
              />
            </Svg>
            <BodyText size={Size.caption} soft style={d.isToday ? { color: Paint.ink, fontFamily: Font.story } : undefined}>
              {DAY_NAMES[i]}
            </BodyText>
          </View>
        );
      })}
    </View>
  );
}

/* ── 손그림 상자 안 한 줄 메뉴 ── */
export function MeRow({ icon, label, onPress, right, first }: { icon?: PaintIconName; label: string; onPress?: (p: { x: number; y: number }) => void; right?: ReactNode; first?: boolean }) {
  const inner = (
    <>
      <View style={styles.rowLeft}>
        {icon ? <PaintIcon name={icon} size={24} /> : null}
        <BodyText size={16}>{label}</BodyText>
      </View>
      {right ?? (onPress ? <View style={{ transform: [{ rotate: '180deg' }] }}><PaintIcon name="back" size={20} color={Paint.inkSoft} /></View> : null)}
    </>
  );
  const rowStyle = [styles.row, !first && styles.rowLine];
  if (!onPress) return <View style={rowStyle}>{inner}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={(e) => onPress({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
      style={({ pressed }) => [rowStyle, pressed && { opacity: 0.6 }]}
    >
      {inner}
    </Pressable>
  );
}

/* ── 머리줄: 뒤로 가기(누른 자리를 넘긴다) + 제목 ── */
export function MeHeader({ title, sub, onBack }: { title: string; sub?: string; onBack: (p: { x: number; y: number }) => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={(e) => onBack({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
        accessibilityRole="button"
        accessibilityLabel="뒤로 가기"
        hitSlop={8}
        style={{ width: 44, height: 44, justifyContent: 'center' }}
      >
        <PaintIcon name="back" size={30} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <StoryText size={Size.heading} accessibilityRole="header">{title}</StoryText>
        {sub ? <BodyText soft size={Size.small}>{sub}</BodyText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  blob: { flex: 1, height: 104, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  weekDay: { alignItems: 'center', gap: 4 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowLine: { borderTopWidth: 1.5, borderStyle: 'dashed', borderTopColor: Paint.line },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
});
