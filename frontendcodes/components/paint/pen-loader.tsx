/**
 * 기다리는 동안: 펜이 종이에 손을 그렸다가 지우고, 다시 그린다.
 * 빙글빙글 도는 표시 대신 쓴다. 움직임 줄이기를 켜면 다 그린 그림으로 멈춰 있다.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';

import { Paint, Size } from '@/constants/paint';
import { BodyText, useBoil } from './paint-ui';
import { blob, jitterPath, pathLength } from './rough';

// 펼친 손 하나 (손바닥 + 다섯 손가락을 한 붓에)
const HAND =
  'M34 92 Q26 74 28 58 L22 34 Q20 26 27 25 Q33 25 34 33 L39 52 L38 20 Q38 12 45 12 Q52 12 52 20 L53 50 L56 16 Q57 8 64 9 Q70 10 70 18 L67 52 L74 26 Q76 19 82 21 Q88 23 86 31 L78 64 Q86 58 92 60 Q98 63 94 70 L80 88 Q70 100 52 100 Q40 100 34 92';

export function PenLoader({ label, size = 96, style }: { label?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const boil = useBoil();
  const len = useMemo(() => pathLength(HAND), []);
  const [t, setT] = useState(reduce ? 0.5 : 0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const t0 = Date.now();
    const step = () => {
      setT(((Date.now() - t0) / 2400) % 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);
  // 0~0.5 그리기, 0.5~0.7 물감, 0.7~1 지우기
  const draw = t < 0.5 ? t / 0.5 : 1;
  const erase = t > 0.72 ? (t - 0.72) / 0.28 : 0;
  const paint = t < 0.5 ? 0 : t < 0.62 ? (t - 0.5) / 0.12 : 1;
  const d = useMemo(() => jitterPath(HAND, 3 + boil, 0.7), [boil]);
  const washD = useMemo(() => blob(58, 62, 34 * paint, 32 * paint, 4, 0.14, 11), [paint]);
  // 펜 끝 위치: 그리는 동안 대충 손 둘레를 돈다
  const a = draw * Math.PI * 2 - Math.PI / 2;
  const penX = 58 + Math.cos(a) * 36, penY = 56 + Math.sin(a) * 42;
  return (
    <View style={[styles.wrap, style]} accessibilityRole="progressbar" accessibilityLabel={label ?? '불러오는 중'}>
      <Svg width={size} height={size} viewBox="0 0 116 116">
        <G opacity={1 - erase}>
          {paint > 0 && <Path d={washD} fill={Paint.yellowSoft} opacity={0.9} />}
          <Path
            d={d}
            fill="none"
            stroke={Paint.ink}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={`${len} ${len}`}
            strokeDashoffset={len * (1 - draw)}
          />
        </G>
        {t < 0.5 && !reduce && (
          <G transform={`translate(${penX} ${penY}) rotate(35)`}>
            <Path d="M0 0 L5 -6 L28 -6 L28 6 L5 6 Z" fill={Paint.coral} stroke={Paint.ink} strokeWidth={2} strokeLinejoin="round" />
            <Path d="M0 0 L5 -6 L5 6 Z" fill={Paint.ink} />
          </G>
        )}
      </Svg>
      {label ? <BodyText soft size={Size.body}>{label}</BodyText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 6 },
});
