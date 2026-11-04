/**
 * 스티커판.
 * 기록 화면이 이미 가진 숫자(푼 문제, 맞힘, 날짜별 푼 수, 틀린 수)만으로 스티커를 준다. 따로 불러오지 않는다.
 * - 받은 스티커: 흰 테두리를 오려 낸 모양 + 펜 테두리 + 물감 + 가운데 작은 펜 그림, 살짝 기울어 붙어 있다
 * - 아직 못 받은 칸: 연한 점선 자리 + "?"
 * - 화면이 나타나면 받은 스티커가 들린 채(크게, 모서리 접힘, 그림자) 나타났다가 꾹 눌려 붙는다. 차례로
 * - 누르면 아래에 이름과 받는 방법이 나온다
 * 움직임 줄이기를 켜면 처음부터 다 붙어 있다.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Font, Paint, Size } from '@/constants/paint';
import { DAILY_GOAL_TARGET } from '@/lib/daily-goal';
import { BodyText, PressSquish, RoughBox, StoryText } from './paint-ui';
import { blob, jitterPath, rng, roughLine } from './rough';

/** 스티커를 판단하는 데 쓰는 숫자 (모두 기록 화면에 이미 있다) */
export type StickerStats = {
  /** 지금까지 푼 문제 수 */
  total: number;
  /** 지금까지 맞힌 문제 수 */
  correct: number;
  /** 오늘 푼 문제 수 */
  today: number;
  /** 하루 목표를 채운 날이 가장 길게 이어진 날 수 (지난 기록 포함) */
  bestGoalStreak: number;
};

type StickerDef = {
  key: string;
  name: string;
  /** 받는 방법 (화면과 읽어 주기에 그대로 쓴다) */
  rule: string;
  color: string;
  /** 30×30 칸에 그린 펜 그림 */
  icon: string;
  earned: (s: StickerStats) => boolean;
};

/* ── 스티커 표: 이름 · 받는 방법 · 판단 규칙 ── */
export const STICKERS: readonly StickerDef[] = [
  {
    key: 'first',
    name: '첫 퀴즈',
    rule: '퀴즈를 한 문제라도 풀면 받아요',
    color: Paint.leaf,
    icon: 'M15 26 V14 M15 17 q-7 0 -8 -7 q7 0 8 7 M15 14 q6 -1 7 -7 q-6 0 -7 7',
    earned: (s) => s.total >= 1,
  },
  {
    key: 'today',
    name: '오늘 목표 달성',
    rule: `오늘 ${DAILY_GOAL_TARGET}문제를 채우면 받아요 (오늘만 붙어 있어요)`,
    color: Paint.yellow,
    icon: 'M15 10 a5 5 0 1 0 0.01 0 M15 3 v3 M15 24 v3 M3 15 h3 M24 15 h3 M7 7 l2 2 M21 21 l2 2 M23 7 l-2 2 M7 23 l2 -2',
    earned: (s) => s.today >= DAILY_GOAL_TARGET,
  },
  {
    key: 'streak3',
    name: '3일 연속',
    rule: `하루 ${DAILY_GOAL_TARGET}문제를 3일 이어서 채우면 받아요`,
    color: Paint.coral,
    icon: 'M15 26 q-7 0 -7 -7 q0 -5 5 -9 q0 4 3 5 q1 -4 -1 -8 q8 4 8 12 q0 7 -8 7 z',
    earned: (s) => s.bestGoalStreak >= 3,
  },
  {
    key: 'streak7',
    name: '7일 연속',
    rule: `하루 ${DAILY_GOAL_TARGET}문제를 7일 이어서 채우면 받아요`,
    color: Paint.maple,
    icon: 'M15 4 l3 7 l7 1 l-5 5 l1 7 l-6 -3 l-6 3 l1 -7 l-5 -5 l7 -1 z',
    earned: (s) => s.bestGoalStreak >= 7,
  },
  {
    key: 'solve50',
    name: '문제 50개',
    rule: '퀴즈를 모두 50문제 풀면 받아요',
    color: Paint.sky,
    icon: 'M7 23 l2 -6 l11 -11 l4 4 l-11 11 z M18 8 l4 4',
    earned: (s) => s.total >= 50,
  },
  {
    key: 'solve200',
    name: '문제 200개',
    rule: '퀴즈를 모두 200문제 풀면 받아요',
    color: Paint.mint,
    icon: 'M6 21 L5 9 l5 5 l5 -8 l5 8 l5 -5 l-1 12 z M7 25 h16',
    earned: (s) => s.total >= 200,
  },
  {
    key: 'sharp',
    name: '꼼꼼한 눈',
    rule: '20문제 넘게 풀고 정확도 80% 이상이면 받아요',
    color: Paint.blossom,
    icon: 'M4 15 q11 -11 22 0 q-11 11 -22 0 z M15 11 a4 4 0 1 0 0.01 0',
    earned: (s) => s.total >= 20 && s.correct / s.total >= 0.8,
  },
  {
    key: 'oops',
    name: '틀려도 괜찮아',
    rule: '처음으로 한 문제를 틀리면 받아요. 오답 노트에 모여요',
    color: Paint.skin,
    icon: 'M8 5 h12 l4 4 v16 h-16 z M12 14 q3 3 6 0 M12 19 h6',
    earned: (s) => s.total - s.correct >= 1,
  },
];

/** 하루 목표를 채운 날이 가장 길게 이어진 날 수 (날짜 키 "YYYY-MM-DD") */
export function getBestGoalStreak(counts: Record<string, number>, target = DAILY_GOAL_TARGET) {
  const days = Object.keys(counts)
    .filter((k) => (counts[k] ?? 0) >= target && /^\d{4}-\d{2}-\d{2}$/.test(k))
    .map((k) => {
      const [y, m, d] = k.split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 86400000;
    })
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  days.forEach((d, i) => {
    run = i > 0 && d - days[i - 1] === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

const COLS = 4;
const STAGGER = 110;

/* ── 스티커 하나 ── */
function Sticker({
  def,
  earned,
  size,
  seed,
  order,
  playKey,
  reduce,
  selected,
  onPress,
}: {
  def: StickerDef;
  earned: boolean;
  size: number;
  seed: number;
  order: number;
  playKey: number;
  reduce: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const R = useMemo(() => rng(seed), [seed]);
  // 붙어 있는 각도: -8° ~ 8°
  const tilt = useMemo(() => (R() - 0.5) * 16, [R]);
  const c = size / 2;
  const r = size * 0.43;

  const edge = useMemo(() => blob(c, c, r, r * 0.95, seed, 0.07, 12), [c, r, seed]);
  const wash1 = useMemo(() => blob(c, c, r * 0.76, r * 0.72, seed + 3, 0.14, 10), [c, r, seed]);
  const wash2 = useMemo(() => blob(c + 2, c + 2, r * 0.56, r * 0.5, seed + 9, 0.18, 9), [c, r, seed]);
  const icon = useMemo(() => jitterPath(def.icon, seed + 5, 0.45), [def.icon, seed]);
  // 오른쪽 위 모서리가 접힌 세모 (들려 있을 때만 보인다)
  const curl = useMemo(() => {
    const px = c + r * 0.72;
    const py = c - r * 0.7;
    const k = size * 0.2;
    return jitterPath(`M${px - k} ${py - k * 0.15} L${px + k * 0.15} ${py + k} L${px - k * 0.55} ${py + k * 0.45} Z`, seed + 11, 0.6);
  }, [c, r, size, seed]);
  const underline = useMemo(() => roughLine(size * 0.22, size - 3, size * 0.78, size - 3, seed + 13, 1.2), [size, seed]);

  // lift: 1이면 들린 채, 0이면 붙음 (용수철이 0을 살짝 넘어 꾹 눌리는 느낌)
  const lift = useSharedValue(earned && !reduce ? 1 : 0);
  const show = useSharedValue(earned && !reduce ? 0 : 1);
  useEffect(() => {
    if (!earned || reduce) {
      lift.value = 0;
      show.value = 1;
      return;
    }
    const wait = order * STAGGER;
    lift.value = 1;
    show.value = 0;
    show.value = withDelay(wait, withTiming(1, { duration: 140 }));
    lift.value = withDelay(wait + 220, withSpring(0, { damping: 7, stiffness: 240 }));
  }, [playKey, earned, reduce, order, lift, show]);

  const bodySt = useAnimatedStyle(() => ({
    opacity: show.value,
    transform: [
      { translateY: -6 * lift.value },
      { scale: 1 + 0.15 * lift.value },
      { rotate: `${tilt - 6 * lift.value}deg` },
    ],
  }));
  const shadowSt = useAnimatedStyle(() => ({
    opacity: show.value * (0.1 + 0.16 * Math.max(lift.value, 0)),
    transform: [{ translateX: 1.5 + 3 * lift.value }, { translateY: 2 + 5 * lift.value }, { scale: 1 + 0.1 * lift.value }],
  }));
  const curlSt = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(lift.value, 0) * 1.6, 1) }));

  const label = `스티커: ${def.name}, ${earned ? '받음' : '아직 못 받음'}`;

  return (
    <PressSquish onPress={onPress} accessibilityLabel={label} style={[styles.cell, { width: size, height: size + 6 }]}>
      <View style={{ width: size, height: size + 6 }}>
        {earned ? (
          <>
            {/* 그림자 */}
            <Animated.View pointerEvents="none" style={[styles.abs, { width: size, height: size }, shadowSt]}>
              <Svg width={size} height={size}>
                <Path d={edge} fill={Paint.ink} />
              </Svg>
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.abs, { width: size, height: size }, bodySt]}>
              <View style={{ width: size, height: size }}>
                <Svg width={size} height={size}>
                  <Path d={edge} fill={Paint.snow} stroke={Paint.ink} strokeWidth={1.8} strokeLinejoin="round" />
                  <Path d={wash1} fill={def.color} opacity={0.85} />
                  <Path d={wash2} fill={def.color} opacity={0.45} />
                </Svg>
              </View>
              {/* 가운데 펜 그림 */}
              <View style={[styles.abs, { left: c - size * 0.21, top: c - size * 0.21, width: size * 0.42, height: size * 0.42 }]}>
                <Svg width={size * 0.42} height={size * 0.42} viewBox="0 0 30 30">
                  <Path d={icon} fill="none" stroke={Paint.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
              {/* 접힌 모서리 */}
              <Animated.View style={[styles.abs, { width: size, height: size }, curlSt]}>
                <Svg width={size} height={size}>
                  <Path d={curl} fill={Paint.paperDeep} stroke={Paint.ink} strokeWidth={1.4} strokeLinejoin="round" />
                </Svg>
              </Animated.View>
            </Animated.View>
          </>
        ) : (
          <View style={[styles.abs, { width: size, height: size, opacity: 0.6, transform: [{ rotate: `${tilt * 0.4}deg` }] }]}>
            <View style={{ width: size, height: size }}>
              <Svg width={size} height={size}>
                <Path d={edge} fill="none" stroke={Paint.inkFaint} strokeWidth={1.5} strokeDasharray="4 5" strokeLinecap="round" />
              </Svg>
            </View>
            <View style={[styles.abs, styles.center, { width: size, height: size }]}>
              <StoryText size={Size.lead} style={{ color: Paint.inkFaint }}>?</StoryText>
            </View>
          </View>
        )}
        {/* 누른 스티커 아래 펜 밑줄 */}
        {selected ? (
          <View pointerEvents="none" style={[styles.abs, { width: size, height: size + 6 }]}>
            <Svg width={size} height={size + 6}>
              <Path d={underline} fill="none" stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
          </View>
        ) : null}
      </View>
    </PressSquish>
  );
}

/**
 * 스티커판.
 * stats: 판단에 쓰는 숫자. playKey가 바뀌면 받은 스티커를 처음부터 다시 붙인다.
 */
export function StickerBoard({ stats, playKey = 0 }: { stats: StickerStats; playKey?: number }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = e.nativeEvent.layout.width;
    if (Math.abs(nw - w) > 0.5) setW(nw);
  };

  const earnedList = STICKERS.map((d) => d.earned(stats));
  const earnedCount = earnedList.filter(Boolean).length;
  // 받은 것끼리만 차례를 매긴다
  const orders = earnedList.map((e, i) => (e ? earnedList.slice(0, i).filter(Boolean).length : 0));
  const size = w ? Math.min(Math.floor(w / COLS) - 8, 84) : 0;

  const pickedIndex = STICKERS.findIndex((d) => d.key === picked);
  const pickedDef = pickedIndex >= 0 ? STICKERS[pickedIndex] : null;

  return (
    <View>
      <RoughBox seed={47} style={styles.box}>
        <BodyText soft size={Size.small} style={styles.count}>
          {`모은 스티커 ${earnedCount} / ${STICKERS.length}`}
        </BodyText>
        <View onLayout={onLayout} style={styles.grid}>
          {size > 0
            ? STICKERS.map((d, i) => (
                <View key={d.key} style={{ width: `${100 / COLS}%`, alignItems: 'center', paddingVertical: 4 }}>
                  <Sticker
                    def={d}
                    earned={earnedList[i]}
                    size={size}
                    seed={i * 17 + 5}
                    order={orders[i]}
                    playKey={playKey}
                    reduce={reduce}
                    selected={picked === d.key}
                    onPress={() => setPicked((p) => (p === d.key ? null : d.key))}
                  />
                </View>
              ))
            : null}
        </View>
      </RoughBox>
      {/* 누른 스티커 설명 (읽어 주기에 바뀐 내용을 알린다) */}
      <View accessibilityLiveRegion="polite" style={styles.caption}>
        {pickedDef ? (
          <BodyText size={Size.body} style={styles.captionText}>
            <BodyText size={Size.body} style={{ fontFamily: Font.story }}>{pickedDef.name}</BodyText>
            {earnedList[pickedIndex] ? '  · 받았어요' : '  · 아직이에요'}
            {'\n'}
            <BodyText soft size={Size.small}>{pickedDef.rule}</BodyText>
          </BodyText>
        ) : (
          <BodyText soft size={Size.caption} style={styles.captionText}>
            스티커를 누르면 이름과 받는 방법이 보여요
          </BodyText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  box: { marginHorizontal: 20, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 10 },
  count: { textAlign: 'center', fontFamily: Font.story, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center' },
  caption: { marginTop: 10, paddingHorizontal: 24, minHeight: 44, justifyContent: 'center' },
  captionText: { textAlign: 'center' },
});
