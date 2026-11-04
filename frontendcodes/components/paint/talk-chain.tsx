/**
 * 통역 화면의 낱말 줄.
 * 1) 쓴 문장을 낱말 조각으로 보여 준다
 * 2) 수어에 없는 조사·어미가 아래로 떨어지고, 기본형 글자가 붙는다 (카페에서 → 카페, 주세요 → 주다)
 * 3) 수어 순서(gloss) 조각으로 바뀌고, 지금 손짓하는 조각이 노랗게 칠해진다
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Font, Paint, Size } from '@/constants/paint';
import { BodyText, RoughBox } from './paint-ui';

type Piece = { stem: string; drop: string; add: string };
type Phase = 'written' | 'cut' | 'gloss';

/** 쓴 낱말과 서버가 고른 토큰을 앞 글자가 겹치는 만큼 짝짓는다 */
export function pairWords(words: string[], tokens: string[]): Piece[] {
  const used = new Set<number>();
  return words.map((raw) => {
    const word = raw.trim();
    let best = -1;
    let bestLen = 0;
    tokens.forEach((tok, i) => {
      if (used.has(i)) return;
      let n = 0;
      while (n < word.length && n < tok.length && word[n] === tok[n]) n++;
      if (n > bestLen) {
        best = i;
        bestLen = n;
      }
    });
    if (best < 0) return { stem: '', drop: word, add: '' };
    used.add(best);
    return { stem: word.slice(0, bestLen), drop: word.slice(bestLen), add: tokens[best].slice(bestLen) };
  });
}

const NOTE: Record<Phase, string> = {
  written: '쓴 문장 그대로',
  cut: '수어에 없는 조사·어미를 떼어 내요',
  gloss: '이 순서대로 손짓해요',
};

type Props = {
  /** 쓴 문장을 띄어쓰기로 자른 것 */
  words: string[];
  /** 서버가 고른 토큰 (normalizedTokens) */
  tokens: string[];
  /** 손짓 순서대로 보여 줄 조각 */
  gloss: string[];
  /** 지금 손짓하는 조각 번호 (-1이면 없음) */
  active: number;
  /** 번역할 때마다 바뀌는 값. 바뀌면 처음부터 다시 보여 준다 */
  runKey: number;
  /** 조각을 누르면 그 낱말로 건너뛴다. 없으면 누를 수 없다 */
  onPick?: (index: number) => void;
  /** 조각이 없는 낱말 표시 (영상 없음) */
  muted?: boolean[];
  /** 끝난 뒤 안내 문구 */
  doneNote?: string;
};

export function TalkChain({ words, tokens, gloss, active, runKey, onPick, muted, doneNote }: Props) {
  const reduce = useReducedMotion();
  const pieces = useMemo(() => pairWords(words, tokens), [words, tokens]);
  const [phase, setPhase] = useState<Phase>(runKey ? 'written' : 'gloss');
  const [cutCount, setCutCount] = useState(0);

  // 번역할 때마다 1) → 2) → 3) 차례로
  useEffect(() => {
    if (!runKey) return;
    if (pieces.length === 0) {
      setPhase('gloss');
      return;
    }
    setPhase('written');
    setCutCount(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 500 + pieces.length * 110;
    timers.push(setTimeout(() => setPhase('cut'), at));
    pieces.forEach((_, i) => {
      timers.push(setTimeout(() => setCutCount(i + 1), at + i * 360));
    });
    at += pieces.length * 360 + 600;
    timers.push(setTimeout(() => setPhase('gloss'), at));
    return () => timers.forEach(clearTimeout);
  }, [runKey, pieces]);

  const note = phase === 'gloss' && active < 0 && doneNote ? doneNote : NOTE[phase];

  return (
    <View>
      <View style={styles.chain} accessibilityLiveRegion="polite">
        {phase === 'gloss'
          ? gloss.map((g, i) => (
              <View key={`${runKey}-g-${i}`} style={styles.link}>
                {i > 0 ? <View style={styles.dot} /> : null}
                <GlossChip
                  label={g}
                  index={i}
                  on={i === active}
                  muted={!!muted?.[i]}
                  reduce={reduce}
                  onPress={onPick ? () => onPick(i) : undefined}
                />
              </View>
            ))
          : pieces.map((p, i) => (
              <View key={`${runKey}-w-${i}`} style={styles.link}>
                {i > 0 ? <View style={styles.dot} /> : null}
                <WordChip piece={p} index={i} cut={phase === 'cut' && i < cutCount} reduce={reduce} />
              </View>
            ))}
      </View>
      <BodyText soft size={Size.small} style={styles.note}>
        {note}
      </BodyText>
    </View>
  );
}

/* 쓴 낱말 조각: 떼어 낼 부분이 떨어지고 기본형 글자가 붙는다 */
function WordChip({ piece, index, cut, reduce }: { piece: Piece; index: number; cut: boolean; reduce: boolean }) {
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const fall = useRef(new Animated.Value(0)).current;
  const addIn = useRef(new Animated.Value(0)).current;
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (reduce) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, { toValue: 1, duration: 450, delay: index * 110, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [enter, index, reduce]);

  useEffect(() => {
    if (!cut) return;
    if (reduce) {
      setGone(true);
      addIn.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.timing(fall, { toValue: 1, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      Animated.timing(addIn, { toValue: 1, duration: 300, delay: 450, useNativeDriver: false }),
    ]).start(() => setGone(true));
  }, [addIn, cut, fall, reduce]);

  // 통째로 떨어지는 낱말은 조각도 사라진다
  if (gone && !piece.stem && !piece.add) return null;

  const enterStyle = {
    opacity: enter,
    transform: [
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
      { rotate: enter.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '0deg'] }) },
    ],
  };
  const dropStyle = {
    opacity: fall.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [
      { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) },
      { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '14deg'] }) },
    ],
  };
  const label = cut ? `${piece.stem}${piece.add}` : `${piece.stem}${piece.drop}`;

  return (
    <Animated.View style={enterStyle} accessible accessibilityLabel={label}>
      <RoughBox seed={11 + index * 3} radius={12} wash={cut ? Paint.sky : undefined} washOpacity={0.55} style={styles.chip}>
        <Text style={styles.chipText}>{piece.stem}</Text>
        {piece.drop && !gone ? <Animated.Text style={[styles.chipText, styles.drop, dropStyle]}>{piece.drop}</Animated.Text> : null}
        {piece.add && cut ? <Animated.Text style={[styles.chipText, { opacity: addIn }]}>{piece.add}</Animated.Text> : null}
      </RoughBox>
    </Animated.View>
  );
}

/* 수어 순서 조각: 지금 손짓하는 조각은 노랗게 칠하고 살짝 들린다 */
function GlossChip({ label, index, on, muted, reduce, onPress }: { label: string; index: number; on: boolean; muted: boolean; reduce: boolean; onPress?: () => void }) {
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(enter, { toValue: 1, duration: 360, delay: index * 90, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [enter, index, reduce]);

  const lift = on && !reduce ? [{ translateY: -4 }, { rotate: '-1.5deg' }] : [];
  const body = (
    <RoughBox
      seed={31 + index * 5}
      radius={12}
      dashed={muted}
      stroke={muted ? Paint.inkSoft : Paint.ink}
      wash={on ? Paint.yellow : Paint.sky}
      washOpacity={on ? 1 : 0.55}
      style={styles.chip}
    >
      <Text style={[styles.chipText, muted && { color: Paint.inkSoft }]}>{label}</Text>
    </RoughBox>
  );
  const a11y = `${label}${muted ? ', 영상 없음' : ''}${on ? ', 지금 손짓 중' : ''}`;

  return (
    <Animated.View style={{ opacity: enter, transform: lift }}>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${a11y}. 이 낱말부터 보기`} accessibilityState={{ selected: on }} hitSlop={4}>
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={a11y}>
          {body}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chain: { minHeight: 62, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', rowGap: 8 },
  link: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 14, height: 2, marginHorizontal: 3, borderRadius: 2, backgroundColor: Paint.ink, opacity: 0.35 },
  chip: { minHeight: 46, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: Font.story, fontSize: 19, color: Paint.ink },
  drop: { color: Paint.inkSoft },
  note: { textAlign: 'center', marginTop: 8, minHeight: 20 },
});
