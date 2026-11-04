/**
 * 꿀짓이: 펜으로 그린 꿀벌. 날개가 파닥이고 몸이 살짝 위아래로 떠 있다.
 * 예전 꿀짓이 PNG 대신 이 그림을 쓴다 (손그림 화면과 한 몸처럼 보이게).
 */
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { Paint } from '@/constants/paint';
import { useBoil } from './paint-ui';
import { jitterPath } from './rough';

export function Bee({ size = 56, flip = false, still = false }: { size?: number; flip?: boolean; still?: boolean }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const t = useBoil(!still);
  useEffect(() => {
    if (reduce || still) return;
    const id = setInterval(() => setW((v) => (v + 1) % 4), 70);
    return () => clearInterval(id);
  }, [reduce, still]);
  const flap = [-20, -6, 10, -6][w];
  const bob = [0, 1.5, 0, -1.5][t];
  const body = jitterPath('M-6 -14 q-4 14 0 28 M4 -14 q4 14 0 28', 2 + t, 0.6);
  return (
    <Svg width={size} height={size} viewBox="-34 -36 68 68">
      <G transform={`translate(0 ${bob}) scale(${flip ? -1 : 1} 1)`}>
        <Ellipse cx={-4} cy={-18} rx={9} ry={13} fill="#FFFFFFCC" stroke={Paint.ink} strokeWidth={2.2} transform={`rotate(${flap} -4 -6)`} />
        <Ellipse cx={8} cy={-17} rx={8} ry={12} fill="#FFFFFFCC" stroke={Paint.ink} strokeWidth={2.2} transform={`rotate(${-flap + 38} 8 -6)`} />
        <Ellipse cx={0} cy={0} rx={20} ry={15} fill={Paint.yellow} stroke={Paint.ink} strokeWidth={2.4} />
        <Path d={body} fill="none" stroke={Paint.ink} strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M20 2 l7 1" stroke={Paint.ink} strokeWidth={2.2} strokeLinecap="round" />
        <Circle cx={-12} cy={-3} r={1.8} fill={Paint.ink} />
        <Path d="M-16 4 q3 3 6 0" fill="none" stroke={Paint.ink} strokeWidth={2} strokeLinecap="round" />
        <Path d="M-14 -14 q-6 -10 -12 -8 M-10 -15 q-2 -12 -8 -14" fill="none" stroke={Paint.ink} strokeWidth={2} strokeLinecap="round" />
      </G>
    </Svg>
  );
}
