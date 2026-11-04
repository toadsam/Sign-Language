/**
 * 펜으로 쓰는 글씨.
 * 글자가 한 자씩 펜으로 쓰듯 나타나고(살짝 기울어진 채 작게 → 제자리), 작은 펜촉이 마지막 글자를 따라간다.
 * 다 쓰면 손으로 그은 밑줄이 왼쪽부터 그어진다.
 * text나 runKey가 바뀌면 처음부터 다시 쓴다. 움직임 줄이기를 켜면 바로 다 보인다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type AccessibilityProps,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';

import { Font, Paint, Size } from '@/constants/paint';
import { jitterPath, pathLength, rng, roughLine } from './rough';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const PEN = 22; // 펜촉 그림 크기
const LINE_H = 8; // 밑줄 자리 높이

type Props = {
  text: string;
  /** 글이 같아도 이 값이 바뀌면 다시 쓴다 (번역할 때마다 바뀌는 값 등) */
  runKey?: number | string;
  size?: number;
  /** story: 고운바탕 굵게, body: 고운돋움 */
  font?: 'story' | 'body';
  color?: string;
  /** 다 쓴 뒤 밑줄을 긋는다 */
  underline?: boolean;
  underlineColor?: string;
  /** 펜촉을 보여 준다 */
  pen?: boolean;
  /** 한 글자 쓰는 시간(ms) */
  speed?: number;
  /** 쓰기 시작하기 전 기다리는 시간(ms) */
  delay?: number;
  seed?: number;
  align?: 'left' | 'center';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** 밑줄까지 다 그은 뒤 */
  onDone?: () => void;
  accessibilityLiveRegion?: AccessibilityProps['accessibilityLiveRegion'];
};

export function Handwrite(props: Props) {
  // 글이나 runKey가 바뀌면 통째로 새로 만들어서 처음부터 쓴다
  return <HandwriteRun key={`${props.runKey ?? ''}|${props.text}`} {...props} />;
}

type Box = { x: number; y: number; w: number; h: number };

function HandwriteRun({
  text,
  size = Size.lead,
  font = 'story',
  color = Paint.ink,
  underline = true,
  underlineColor = Paint.ink,
  pen = true,
  speed = 52,
  delay = 0,
  seed = 1,
  align = 'left',
  style,
  textStyle,
  onDone,
  accessibilityLiveRegion,
}: Props) {
  const reduce = useReducedMotion();
  // Array.from: 한글 한 글자(또는 이모지)를 반으로 쪼개지 않게
  const chars = useMemo(() => Array.from(text), [text]);
  const n = chars.length;
  const prog = useRef(new Animated.Value(reduce ? n : 0)).current;
  const lineProg = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const [writing, setWriting] = useState(!reduce && n > 0);
  const [rowW, setRowW] = useState(0);
  const boxes = useRef<(Box | undefined)[]>([]);
  const measured = useRef(0);
  const [boxesReady, setBoxesReady] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // 글자마다 기울기를 조금씩 다르게 (seed가 같으면 늘 같은 모양)
  const tilts = useMemo(() => {
    const r = rng(seed + n * 0.13);
    return chars.map(() => (r() - 0.5) * 18);
  }, [chars, n, seed]);

  useEffect(() => {
    if (reduce || n === 0) {
      prog.setValue(n);
      lineProg.setValue(1);
      setWriting(false);
      doneRef.current?.();
      return;
    }
    let line: Animated.CompositeAnimation | null = null;
    const write = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(prog, { toValue: n, duration: n * speed, easing: Easing.linear, useNativeDriver: false }),
    ]);
    write.start(({ finished }) => {
      if (!finished) return;
      setWriting(false);
      if (!underline) {
        doneRef.current?.();
        return;
      }
      line = Animated.timing(lineProg, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: false });
      line.start(({ finished: ok }) => ok && doneRef.current?.());
    });
    return () => {
      write.stop();
      line?.stop();
    };
  }, [reduce, n, delay, speed, underline, prog, lineProg]);

  const onBox = (i: number) => (e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    if (!boxes.current[i]) measured.current += 1;
    boxes.current[i] = { x, y, w: width, h: height };
    if (measured.current >= n && !boxesReady) setBoxesReady(true);
  };

  // 펜촉 위치: 지금 쓰는 글자의 왼쪽 → 오른쪽으로 움직이고, 줄이 바뀌면 바로 건너간다
  const penStyle = useMemo(() => {
    if (!boxesReady || n === 0) return null;
    const input: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const b = boxes.current[i] ?? { x: 0, y: 0, w: 0, h: size };
      const top = b.y + b.h * 0.72 - PEN;
      input.push(i, i + 0.999);
      xs.push(b.x, b.x + b.w);
      ys.push(top, top);
    }
    return {
      transform: [
        { translateX: prog.interpolate({ inputRange: input, outputRange: xs, extrapolate: 'clamp' }) },
        { translateY: prog.interpolate({ inputRange: input, outputRange: ys, extrapolate: 'clamp' }) },
      ],
    };
  }, [boxesReady, n, prog, size]);

  const lineD = useMemo(() => (rowW > 8 ? jitterPath(roughLine(2, 4.5, rowW - 2, 3, seed + 3, 1.1), seed + 7, 0.5) : ''), [rowW, seed]);
  const lineLen = useMemo(() => (lineD ? pathLength(lineD) : 0), [lineD]);

  const glyph: TextStyle = {
    fontFamily: font === 'story' ? Font.story : Font.body,
    fontSize: size,
    lineHeight: size * (font === 'story' ? 1.38 : 1.5),
    color,
  };

  return (
    <View
      style={[{ alignItems: align === 'center' ? 'center' : 'flex-start' }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      accessibilityLiveRegion={accessibilityLiveRegion}>
      <View
        style={[styles.row, { justifyContent: align === 'center' ? 'center' : 'flex-start', paddingBottom: underline ? LINE_H : 0 }]}
        onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
        {chars.map((ch, i) =>
          ch === '\n' ? (
            <View key={i} style={styles.br} />
          ) : (
            <Glyph key={i} ch={ch} i={i} prog={prog} tilt={tilts[i]} style={[glyph, textStyle]} onLayout={onBox(i)} />
          ),
        )}
        {underline && lineD ? (
          <Svg width={rowW} height={LINE_H} style={styles.line} pointerEvents="none">
            <AnimatedPath
              d={lineD}
              fill="none"
              stroke={underlineColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={0.75}
              strokeDasharray={`${lineLen} ${lineLen}`}
              strokeDashoffset={lineProg.interpolate({ inputRange: [0, 1], outputRange: [lineLen, 0] })}
            />
          </Svg>
        ) : null}
        {pen && writing && penStyle ? (
          <Animated.View pointerEvents="none" style={[styles.pen, penStyle]}>
            <Svg width={PEN} height={PEN} viewBox="0 0 22 22">
              {/* 끝이 왼쪽 아래를 향한 연필 */}
              <G transform="translate(1 21) rotate(-45)">
                <Path d="M0 0 L5 -4 L26 -4 L26 4 L5 4 Z" fill={Paint.coral} stroke={Paint.ink} strokeWidth={1.6} strokeLinejoin="round" />
                <Path d="M0 0 L5 -4 L5 4 Z" fill={Paint.ink} />
              </G>
            </Svg>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

/* 글자 하나: 차례가 오면 기울어진 채 작게 → 제자리로 */
function Glyph({
  ch,
  i,
  prog,
  tilt,
  style,
  onLayout,
}: {
  ch: string;
  i: number;
  prog: Animated.Value;
  tilt: number;
  style: StyleProp<TextStyle>;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const st = useMemo(
    () => ({
      opacity: prog.interpolate({ inputRange: [i, i + 0.55], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [
        { translateY: prog.interpolate({ inputRange: [i, i + 1], outputRange: [3, 0], extrapolate: 'clamp' }) },
        { scale: prog.interpolate({ inputRange: [i, i + 0.6, i + 1], outputRange: [0.55, 1.06, 1], extrapolate: 'clamp' }) },
        { rotate: prog.interpolate({ inputRange: [i, i + 1], outputRange: [`${tilt}deg`, '0deg'], extrapolate: 'clamp' }) },
      ],
    }),
    [prog, i, tilt],
  );
  return (
    <Animated.Text onLayout={onLayout} style={[style, st]} importantForAccessibility="no">
      {/* 빈칸은 웹에서 접히지 않게 붙은 빈칸으로 */}
      {ch === ' ' ? ' ' : ch}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', maxWidth: '100%', position: 'relative' },
  br: { width: '100%', height: 0 },
  line: { position: 'absolute', left: 0, bottom: 0 },
  pen: { position: 'absolute', left: 0, top: 0 },
});
