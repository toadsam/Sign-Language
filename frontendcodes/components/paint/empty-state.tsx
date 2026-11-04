/**
 * 빈 화면 · 오류 화면 그림.
 * 글자만 덩그러니 두지 말고, 상황마다 꿀짓이가 있는 작은 그림과 한 줄 말, 할 일 버튼을 보여 준다.
 *
 * kind
 * - offline: 서버에 닿지 않음 (꿀짓이가 끊어진 전화선을 들고 있다)
 * - error: 그 밖의 오류 (꿀짓이가 엎지른 물감 통)
 * - empty-note: 오답 노트가 비었음 (깨끗한 공책 위에서 엄지 척)
 * - empty-bookmark: 북마크가 없음 (빈 책갈피)
 * - no-quiz: 풀 문제가 없음 (빈 액자)
 * - search: 찾는 결과가 없음 (돋보기)
 */
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { Paint, Size } from '@/constants/paint';
import { Bee } from './bee';
import { BodyText, PaintButton, StoryText, useBoil } from './paint-ui';
import { blob, jitterPath } from './rough';

export type EmptyKind = 'offline' | 'error' | 'empty-note' | 'empty-bookmark' | 'no-quiz' | 'search';

const COPY: Record<EmptyKind, { title: string; sub: string }> = {
  offline: { title: '마을에 전화가 안 닿아요', sub: '인터넷이 잠깐 끊겼거나 서버가 쉬고 있어요. 잠시 뒤 다시 해 봐요.' },
  error: { title: '물감을 쏟았어요', sub: '무언가 잘못됐어요. 다시 해 보면 대부분 괜찮아져요.' },
  'empty-note': { title: '오답 노트가 깨끗해요', sub: '틀린 문제가 생기면 여기에 모아 둘게요.' },
  'empty-bookmark': { title: '아직 꽂아 둔 책갈피가 없어요', sub: '마음에 드는 표현에 책갈피를 꽂아 보세요.' },
  'no-quiz': { title: '지금 풀 문제가 없어요', sub: '다른 단원을 골라 보거나 조금 뒤에 다시 와 주세요.' },
  search: { title: '찾는 그림이 없어요', sub: '다른 말로 찾아볼까요?' },
};

/** 오류 문장을 보고 끊김인지 아닌지 고른다 */
export function errorKind(message?: string | null): EmptyKind {
  if (!message) return 'error';
  return /fetch|network|timeout|연결|네트워크|시간 초과/i.test(message) ? 'offline' : 'error';
}

// 꿀짓이 옆에 놓는 소품 (0~120, 0~100 좌표)
const PROPS: Record<EmptyKind, { ink: string; paint: { d: string; c: string }[] }> = {
  offline: {
    ink: 'M8 78 q12 -2 22 -14 q8 -12 18 -10 M52 50 l6 -6 M56 56 l8 -2 M50 58 l2 8 M78 66 q14 4 18 16 M96 82 h14 v-8 h-14 z M100 74 v-4 M106 74 v-4',
    paint: [{ d: blob(103, 78, 9, 6, 2, 0.1), c: Paint.sky }],
  },
  error: {
    ink: 'M70 50 l16 -10 l14 22 l-16 10 z M84 72 q10 8 30 6 M74 80 q18 10 40 8',
    paint: [{ d: blob(96, 82, 22, 9, 4, 0.2), c: Paint.coral }, { d: blob(80, 60, 6, 6, 5, 0.1), c: Paint.yellow }],
  },
  'empty-note': {
    ink: 'M62 40 h48 v52 h-48 z M86 40 v52 M68 54 h12 M68 64 h12 M92 54 h12 M92 64 h12 M118 30 l-4 8 M122 42 l-8 2 M108 26 l0 8',
    paint: [{ d: blob(86, 66, 26, 28, 6, 0.06), c: Paint.yellowSoft }],
  },
  'empty-bookmark': {
    ink: 'M74 36 h22 v52 l-11 -10 l-11 10 z M66 30 q30 -10 44 6',
    paint: [{ d: 'M74 36 h22 v52 l-11 -10 l-11 10 z', c: Paint.coral }],
  },
  'no-quiz': {
    ink: 'M64 34 h50 v44 h-50 z M70 40 h38 v32 h-38 z M89 34 l0 -10 M80 24 h18 M84 56 q5 -6 10 0',
    paint: [{ d: blob(89, 56, 18, 15, 7, 0.08), c: Paint.sky }],
  },
  search: {
    ink: 'M78 52 a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0 M102 62 l14 14 M86 46 q4 -4 8 -2',
    paint: [{ d: blob(92, 52, 12, 12, 8, 0.06), c: Paint.yellowSoft }],
  },
};

export function EmptyState({
  kind,
  title,
  sub,
  actionLabel,
  onAction,
  style,
  compact,
}: {
  kind: EmptyKind;
  title?: string;
  sub?: string;
  actionLabel?: string;
  onAction?: (at: { x: number; y: number }) => void;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const boil = useBoil();
  const p = PROPS[kind];
  const ink = useMemo(() => jitterPath(p.ink, 5 + boil, 0.7), [p.ink, boil]);
  const copy = COPY[kind];
  const w = compact ? 180 : 220;
  return (
    <View style={[styles.wrap, style]} accessibilityRole="summary" accessibilityLabel={`${title ?? copy.title}. ${sub ?? copy.sub}`}>
      <View style={{ width: w, height: (w * 100) / 130 }}>
        <Svg width={w} height={(w * 100) / 130} viewBox="0 0 130 100" style={StyleSheet.absoluteFill}>
          <Path d={blob(65, 60, 60, 36, 3, 0.08, 12)} fill={Paint.paperDeep} />
          {p.paint.map((x, i) => (
            <Path key={i} d={x.d} fill={x.c} opacity={0.9} />
          ))}
          <G fill="none" stroke={Paint.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d={ink} />
            <Path d={jitterPath('M6 94 H124', 9 + boil, 0.8)} opacity={0.5} />
          </G>
        </Svg>
        <View style={[styles.bee, { left: w * 0.06, top: w * 0.18 }]}>
          <Bee size={w * 0.36} flip={kind === 'offline' || kind === 'error'} />
        </View>
      </View>
      <StoryText size={compact ? Size.lead : Size.title} style={styles.title}>{title ?? copy.title}</StoryText>
      <BodyText soft size={Size.small} style={styles.sub}>{sub ?? copy.sub}</BodyText>
      {actionLabel && onAction ? <PaintButton small label={actionLabel} onPress={onAction} seed={kind.length + 30} style={{ marginTop: 6, minWidth: 180 }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4, paddingHorizontal: 24 },
  bee: { position: 'absolute' },
  title: { textAlign: 'center', marginTop: 4 },
  sub: { textAlign: 'center', maxWidth: 280 },
});
