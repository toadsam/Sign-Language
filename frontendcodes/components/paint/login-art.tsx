/**
 * 로그인 화면 그림: 창 안에서 두 사람이 손짓으로 이야기한다.
 */
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { Paint } from '@/constants/paint';
import { useBoil } from './paint-ui';
import { blob, jitterPath } from './rough';

export function LoginArt({ width = 320 }: { width?: number }) {
  const reduce = useReducedMotion();
  const boil = useBoil();
  const [ph, setPh] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const t0 = Date.now();
    const step = () => {
      setPh((Date.now() - t0) / 450);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);
  const j = (d: string, s: number) => jitterPath(d, s + boil, 0.8);
  const a1 = -10 + 11 * Math.sin(ph), a2 = 12 - 11 * Math.sin(ph + 0.8);
  return (
    <Svg width={width} height={(width * 300) / 340} viewBox="0 0 340 300" accessibilityLabel="창 안에서 두 사람이 수어로 이야기하는 그림">
      <Path d={blob(170, 155, 132, 118, 2, 0.05, 14)} fill={Paint.yellowSoft} />
      <Path d={blob(262, 84, 22, 22, 5)} fill={Paint.yellow} />
      <Path d="M40 220 Q170 196 300 222 V270 H40Z" fill={Paint.leaf} opacity={0.7} />
      <Path d={blob(124, 232, 30, 46, 8, 0.06)} fill={Paint.coral} />
      <Path d={blob(218, 232, 30, 46, 9, 0.06)} fill={Paint.sky} />
      <G fill="none" stroke={Paint.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <Path d={j('M34 34 H306 V276 H34 Z M170 34 V60 M34 150 H50 M290 150 H306', 1)} />
        <Circle cx={124} cy={162} r={16} fill={Paint.skin} />
        <Circle cx={218} cy={162} r={16} fill={Paint.skin} />
        <Path d="M118 160 v2 M130 160 v2 M119 170 q5 4 10 0 M212 160 v2 M224 160 v2 M213 170 q5 4 10 0" />
        <Path d={j('M96 268 Q100 196 124 186 Q148 196 152 268 M190 268 Q194 196 218 186 Q242 196 246 268', 3)} />
        <G transform={`rotate(${a1} 146 206)`}>
          <Path d="M146 206 Q166 204 168 182" />
          <Ellipse cx={168} cy={174} rx={6} ry={9} fill={Paint.skin} />
        </G>
        <G transform={`rotate(${a2} 196 206)`}>
          <Path d="M196 206 Q178 204 176 186" />
          <Ellipse cx={176} cy={178} rx={6} ry={9} fill={Paint.skin} />
        </G>
        <Path d="M160 150 q12 -10 24 0 M154 140 q18 -16 36 0" opacity={0.6} />
      </G>
    </Svg>
  );
}
