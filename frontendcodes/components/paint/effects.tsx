/**
 * 물감 효과 모음.
 * - PaintSplash: 한 점에서 물감 방울이 사방으로 튄다 (정답)
 * - InkSplat: 잉크 얼룩이 번졌다가 옅어진다 (오답)
 * - PaintConfetti: 화면 위에서 물감 조각이 쏟아진다 (오늘 목표 완료)
 * 모두 누르기를 막지 않고, 움직임 줄이기를 켠 사람에게는 나타나지 않는다.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Paint } from '@/constants/paint';
import { blob, rng } from './rough';

const SPLASH_COLORS = [Paint.yellow, Paint.yellowSoft, Paint.coral, Paint.mint, Paint.sky];

/* ── 물감 방울 하나 ── */
function Drop({ p, dx, dy, size, color, seed, spin }: { p: SharedValue<number>; dx: number; dy: number; size: number; color: string; seed: number; spin: number }) {
  const d = useMemo(() => blob(size / 2, size / 2, size / 2 - 1, size / 2 - 1, seed, 0.16, 8), [size, seed]);
  const st = useAnimatedStyle(() => {
    const t = p.value;
    // 처음엔 빠르게 튀고, 끝에서 살짝 떨어지며 옅어진다
    const k = 1 - Math.pow(1 - t, 3);
    return {
      opacity: t <= 0 ? 0 : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3,
      transform: [
        { translateX: dx * k - size / 2 },
        { translateY: dy * k + 30 * t * t - size / 2 },
        { scale: 0.4 + 0.8 * Math.min(t * 4, 1) - 0.3 * t },
        { rotate: `${spin * t}deg` },
      ],
    };
  });
  return (
    <Animated.View style={[styles.abs, { width: size, height: size }, st]}>
      <Svg width={size} height={size}>
        <Path d={d} fill={color} stroke={Paint.ink} strokeWidth={1.2} strokeOpacity={0.55} />
      </Svg>
    </Animated.View>
  );
}

/** trigger 값이 바뀔 때마다 (x, y)에서 물감이 튄다. 부모 안에 절대 위치로 깔린다 */
export function PaintSplash({ trigger, x, y, count = 12, spread = 90, colors = SPLASH_COLORS }: { trigger: number; x: number; y: number; count?: number; spread?: number; colors?: string[] }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  const drops = useMemo(() => {
    const r = rng(trigger * 31 + 7);
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + r() * 0.5;
      const dist = spread * (0.55 + r() * 0.6);
      return { dx: Math.cos(a) * dist, dy: Math.sin(a) * dist * 0.85 - 10, size: 9 + r() * 12, color: colors[i % colors.length], seed: i + trigger, spin: (r() - 0.5) * 240 };
    });
  }, [trigger, count, spread, colors]);
  useEffect(() => {
    if (!trigger || reduce) return;
    p.value = 0;
    p.value = withTiming(1, { duration: 760, easing: Easing.linear });
  }, [trigger, reduce, p]);
  if (!trigger || reduce) return null;
  return (
    <View pointerEvents="none" style={[styles.abs, { left: x, top: y }]}>
      {drops.map((d, i) => (
        <Drop key={`${trigger}-${i}`} p={p} {...d} />
      ))}
    </View>
  );
}

/** trigger 값이 바뀔 때마다 부모 가운데에 잉크 얼룩이 번졌다가 옅어진다 */
export function InkSplat({ trigger, seed = 3 }: { trigger: number; seed?: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  const d = useMemo(() => blob(50, 50, 40, 34, seed + trigger, 0.22, 11), [seed, trigger]);
  const d2 = useMemo(() => blob(82, 26, 7, 6, seed + 9, 0.2, 7) + blob(18, 78, 5, 5, seed + 4, 0.2, 7) + blob(88, 70, 4, 4, seed + 2, 0.2, 6), [seed]);
  useEffect(() => {
    if (!trigger || reduce) return;
    p.value = 0;
    p.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) });
  }, [trigger, reduce, p]);
  const st = useAnimatedStyle(() => ({
    opacity: p.value <= 0 ? 0 : p.value < 0.25 ? 0.22 : 0.22 * (1 - (p.value - 0.25) / 0.75),
    transform: [{ scale: 0.5 + Math.min(p.value * 3, 1) * 0.6 }],
  }));
  if (!trigger || reduce) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, st]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Path d={d} fill={Paint.ink} />
        <Path d={d2} fill={Paint.ink} />
      </Svg>
    </Animated.View>
  );
}

/* ── 쏟아지는 물감 조각 ── */
function Flake({ p, x, delay, fall, sway, size, color, seed, spin, star }: { p: SharedValue<number>; x: number; delay: number; fall: number; sway: number; size: number; color: string; seed: number; spin: number; star: boolean }) {
  const d = useMemo(
    () => (star ? 'M10 1 l2.6 6 l6.4 .6 l-4.9 4.3 l1.5 6.3 l-5.6 -3.4 l-5.6 3.4 l1.5 -6.3 l-4.9 -4.3 l6.4 -.6 z' : blob(10, 10, 8, 6, seed, 0.18, 8)),
    [star, seed],
  );
  const st = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, (p.value - delay) / (1 - delay)));
    return {
      opacity: t <= 0 ? 0 : t > 0.85 ? (1 - t) / 0.15 : 1,
      transform: [
        { translateX: x + Math.sin(t * 6 + seed) * sway },
        { translateY: -40 + fall * t },
        { rotate: `${spin * t}deg` },
        { scale: size / 20 },
      ],
    };
  });
  return (
    <Animated.View style={[styles.abs, { width: 20, height: 20 }, st]}>
      <Svg width={20} height={20} viewBox="0 0 20 20">
        <Path d={d} fill={color} stroke={Paint.ink} strokeWidth={1.3} strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

/** trigger 값이 바뀔 때마다 화면 가득 물감 조각이 쏟아진다 (약 2.6초) */
export function PaintConfetti({ trigger, count = 34 }: { trigger: number; count?: number }) {
  const reduce = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const p = useSharedValue(0);
  const flakes = useMemo(() => {
    const r = rng(trigger * 13 + 1);
    return Array.from({ length: count }, (_, i) => ({
      x: r() * width,
      delay: r() * 0.35,
      fall: height * (0.75 + r() * 0.4),
      sway: 10 + r() * 22,
      size: 12 + r() * 14,
      color: SPLASH_COLORS[i % SPLASH_COLORS.length],
      seed: i,
      spin: (r() - 0.5) * 540,
      star: i % 4 === 0,
    }));
  }, [trigger, count, width, height]);
  useEffect(() => {
    if (!trigger || reduce) return;
    p.value = 0;
    p.value = withDelay(80, withTiming(1, { duration: 2600, easing: Easing.linear }));
  }, [trigger, reduce, p]);
  if (!trigger || reduce) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 80, elevation: 80 }]}>
      {flakes.map((f, i) => (
        <Flake key={`${trigger}-${i}`} p={p} {...f} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
