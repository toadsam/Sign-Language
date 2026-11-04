/**
 * 퀴즈 답 카드 한 장. 손그림 테두리 상자 안에 보기 글자와 답이 있다.
 * 고르면 형광펜이 왼쪽부터 칠해지고, 맞으면 민트색, 틀리면 카드가 흔들린다.
 */
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Paint, Size } from '@/constants/paint';
import { PaintIcon, RoughBox, StoryText, Wash } from './paint-ui';

export type QuizAnswerState = 'idle' | 'picked' | 'right' | 'wrong' | 'faded';

type Props = {
  letter: string;
  text: string;
  state: QuizAnswerState;
  index: number;
  /** 문제가 바뀔 때마다 바뀌는 값. 바뀌면 카드가 차례로 나타난다 */
  revealKey: number | string;
  disabled?: boolean;
  onPress: () => void;
};

export function QuizAnswer({ letter, text, state, index, revealKey, disabled, onPress }: Props) {
  const reduce = useReducedMotion();
  const hl = useSharedValue(0);
  const tilt = useSharedValue(0);
  const enter = useSharedValue(1);

  // 문제가 바뀌면 차례로 올라온다
  useEffect(() => {
    if (reduce) {
      enter.value = 1;
      return;
    }
    enter.value = 0;
    enter.value = withDelay(index * 55, withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [revealKey, index, reduce, enter]);

  // 형광펜: 고르거나 정답이면 칠한다
  useEffect(() => {
    const on = state === 'picked' || state === 'right';
    if (reduce) {
      hl.value = on ? 1 : 0;
      return;
    }
    hl.value = on ? withSpring(1, { damping: 11, stiffness: 160 }) : withTiming(0, { duration: 140 });
  }, [state, reduce, hl]);

  // 틀리면 흔들린다
  useEffect(() => {
    if (state !== 'wrong' || reduce) return;
    tilt.value = withSequence(
      withTiming(-3, { duration: 110 }),
      withTiming(3, { duration: 110 }),
      withTiming(-2, { duration: 110 }),
      withTiming(0, { duration: 110 }),
    );
  }, [state, reduce, tilt]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 12 }, { rotate: `${tilt.value}deg` }],
  }));
  const hlStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: hl.value }] }));

  const fill = state === 'right' ? Paint.rightSoft : state === 'wrong' ? Paint.wrongSoft : Paint.card;
  const hlColor = state === 'right' ? Paint.mint : Paint.yellowSoft;
  const stateLabel = state === 'right' ? ', 정답' : state === 'wrong' ? ', 고른 답, 오답' : state === 'picked' ? ', 고름' : '';

  return (
    <Animated.View style={[styles.cell, wrapStyle, state === 'faded' && styles.faded]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${letter}. ${text}${stateLabel}`}
        accessibilityState={{ selected: state === 'picked' || state === 'wrong', disabled }}
        style={({ pressed }) => ({ transform: pressed ? [{ rotate: '-1.5deg' }, { scale: 0.97 }] : [] })}
      >
        <RoughBox seed={11 + index * 7} fill={fill} strokeWidth={2} style={styles.card}>
          <View style={styles.badge}>
            <StoryText size={Size.small} style={styles.badgeText}>{letter}</StoryText>
          </View>
          <View style={styles.textWrap}>
            <Animated.View pointerEvents="none" style={[styles.hl, hlStyle]}>
              <Wash color={hlColor} opacity={0.95} seed={index + 4} />
            </Animated.View>
            <StoryText size={Size.lead} numberOfLines={3} style={styles.text}>{text}</StoryText>
          </View>
          {state === 'right' && <PaintIcon name="check" size={22} />}
          {state === 'wrong' && <PaintIcon name="close" size={20} />}
        </RoughBox>
      </Pressable>
    </Animated.View>
  );
}

/** 보기 4개를 2줄 2칸으로 놓는다 */
export function QuizAnswerGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  cell: { width: '48.5%' },
  faded: { opacity: 0.5 },
  card: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.6,
    borderColor: Paint.ink,
    backgroundColor: Paint.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { lineHeight: 18 },
  textWrap: { flex: 1, justifyContent: 'center' },
  hl: {
    position: 'absolute',
    left: -4,
    right: -2,
    top: '50%',
    height: 22,
    marginTop: -6,
    transformOrigin: 'left center',
  },
  text: { color: Paint.ink },
});
