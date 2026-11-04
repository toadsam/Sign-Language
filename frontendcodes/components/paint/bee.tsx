/**
 * 꿀짓이: 펜으로 그린 꿀벌. 날개가 파닥이고 몸이 살짝 위아래로 떠 있다.
 * 예전 꿀짓이 PNG 대신 이 그림을 쓴다 (손그림 화면과 한 몸처럼 보이게).
 *
 * phase로 시간대 모습이 바뀐다.
 * - morning: 눈을 반달로 뜨고 반짝이를 달고 있다 (막 일어난 기분 좋은 얼굴)
 * - night: 수면 모자를 쓰고 눈을 감은 채 졸고, 머리 위로 z가 떠오른다. 날갯짓도 느려진다
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Text as SvgText } from 'react-native-svg';

import { Font, Paint } from '@/constants/paint';
import { useBoil } from './paint-ui';
import { jitterPath } from './rough';

export type BeePhase = 'morning' | 'day' | 'evening' | 'night';

export function Bee({ size = 56, flip = false, still = false, phase = 'day' }: { size?: number; flip?: boolean; still?: boolean; phase?: BeePhase }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const t = useBoil(!still);
  const night = phase === 'night';
  useEffect(() => {
    if (reduce || still) return;
    const id = setInterval(() => setW((v) => (v + 1) % 4), night ? 180 : 70);
    return () => clearInterval(id);
  }, [reduce, still, night]);
  const flap = night ? [-8, -4, 0, -4][w] : [-20, -6, 10, -6][w];
  const bob = [0, 1.5, 0, -1.5][t];
  const body = jitterPath('M-6 -14 q-4 14 0 28 M4 -14 q4 14 0 28', 2 + t, 0.6);
  // 밤: z가 하나씩 떠오른다 (boil 시계 4칸을 그대로 쓴다)
  const zs = [0, 1, 2].map((k) => ((t + k * 1.33) % 4) / 4);
  // View로 감싸야 웹에서 손그림 상자의 물감 층(절대 위치)에 가려지지 않는다
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="-34 -36 68 68">
        <G transform={`translate(0 ${bob}) scale(${flip ? -1 : 1} 1)`}>
          <Ellipse cx={-4} cy={-18} rx={9} ry={13} fill="#FFFFFFCC" stroke={Paint.ink} strokeWidth={2.2} transform={`rotate(${flap} -4 -6)`} />
          <Ellipse cx={8} cy={-17} rx={8} ry={12} fill="#FFFFFFCC" stroke={Paint.ink} strokeWidth={2.2} transform={`rotate(${-flap + 38} 8 -6)`} />
          <Ellipse cx={0} cy={0} rx={20} ry={15} fill={Paint.yellow} stroke={Paint.ink} strokeWidth={2.4} />
          <Path d={body} fill="none" stroke={Paint.ink} strokeWidth={2.4} strokeLinecap="round" />
          <Path d="M20 2 l7 1" stroke={Paint.ink} strokeWidth={2.2} strokeLinecap="round" />

          {/* 눈 */}
          {night ? (
            <Path d="M-15 -3 q2.5 2.5 5 0" fill="none" stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" />
          ) : phase === 'morning' ? (
            <Path d="M-15 -2 q2.5 -3 5 0" fill="none" stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" />
          ) : (
            <Circle cx={-12} cy={-3} r={1.8} fill={Paint.ink} />
          )}
          {/* 입: 밤에는 작게 오므린 입 */}
          {night ? (
            <Circle cx={-13} cy={5} r={1.6} fill="none" stroke={Paint.ink} strokeWidth={1.6} />
          ) : (
            <Path d="M-16 4 q3 3 6 0" fill="none" stroke={Paint.ink} strokeWidth={2} strokeLinecap="round" />
          )}
          {/* 볼 */}
          {(phase === 'morning' || phase === 'evening') && <Ellipse cx={-7} cy={4} rx={3} ry={2} fill={Paint.coral} opacity={0.6} />}

          {night ? (
            // 수면 모자: 고깔이 뒤로 처지고 끝에 방울
            <G>
              <Path d={jitterPath('M-22 -8 Q-16 -20 -2 -15 Q-10 -24 -22 -30 Q-30 -32 -32 -24 Q-26 -18 -22 -8 Z', 9 + t, 0.5)} fill={Paint.sky} stroke={Paint.ink} strokeWidth={2} strokeLinejoin="round" />
              <Path d="M-23 -9 Q-14 -17 -3 -14" fill="none" stroke={Paint.ink} strokeWidth={3.4} strokeLinecap="round" opacity={0.25} />
              <Circle cx={-31} cy={-26} r={3.4} fill={Paint.card} stroke={Paint.ink} strokeWidth={1.8} />
            </G>
          ) : (
            <Path d="M-14 -14 q-6 -10 -12 -8 M-10 -15 q-2 -12 -8 -14" fill="none" stroke={Paint.ink} strokeWidth={2} strokeLinecap="round" />
          )}
          {phase === 'morning' && (
            <Path d={jitterPath('M-28 -20 v-6 M-31 -23 h6 M22 -22 v-4 M20 -24 h4', 4 + t, 0.3)} stroke={Paint.ink} strokeWidth={1.6} strokeLinecap="round" />
          )}
        </G>
        {night &&
          !reduce &&
          !still &&
          zs.map((f, k) => (
            <SvgText
              key={k}
              x={(flip ? 14 : -14) + (flip ? 1 : -1) * f * 10}
              y={-20 - f * 14}
              fontSize={7 + f * 5}
              fontFamily={Font.story}
              fill={Paint.ink}
              opacity={1 - f}
              textAnchor="middle"
            >
              z
            </SvgText>
          ))}
      </Svg>
    </View>
  );
}
