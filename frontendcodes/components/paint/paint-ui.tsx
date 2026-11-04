/**
 * 색칠 마을 공통 부품.
 * 종이 배경, 손그림 테두리 상자, 물감 얼룩, 버튼, 글씨, 스위치, 아래 메뉴.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Font, Paint, Size, TabColor } from '@/constants/paint';
import { feel } from '@/lib/feel';
import { blob, jitterPath, pathLength, roughRect } from './rough';
import { usePaintNav } from './transition';

/* ── 선 떨림: 앱 전체가 시계 하나를 같이 쓴다 (160ms마다 0→1→2→3) ── */
let boilTick = 0;
const boilListeners = new Set<(t: number) => void>();
let boilTimer: ReturnType<typeof setInterval> | null = null;
function subscribeBoil(fn: (t: number) => void) {
  boilListeners.add(fn);
  if (!boilTimer) {
    boilTimer = setInterval(() => {
      boilTick = (boilTick + 1) % 4;
      boilListeners.forEach((l) => l(boilTick));
    }, 160);
  }
  return () => {
    boilListeners.delete(fn);
    if (!boilListeners.size && boilTimer) {
      clearInterval(boilTimer);
      boilTimer = null;
    }
  };
}
/** 손그림 애니메이션처럼 선이 1초에 몇 번씩 다시 그려진다. 움직임 줄이기를 켠 사람에게는 멈춰 있다 */
export function useBoil(enabled = true) {
  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!enabled || reduce) return;
    return subscribeBoil(setT);
  }, [enabled, reduce]);
  return t;
}

function useSize() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
  };
  return [size, onLayout] as const;
}

/* ── 종이 화면 ── */
const paperTile = require('@/assets/paint/paper.png');
// 웹에서는 ImageBackground의 repeat가 먹지 않아 종이결이 왼쪽 위 한 칸에만 깔린다 → CSS 배경으로 깐다
const paperUri: string | undefined =
  Platform.OS === 'web' ? (typeof paperTile === 'string' ? paperTile : (paperTile?.uri ?? paperTile?.default?.uri ?? paperTile?.default)) : undefined;
const webPaper = paperUri
  ? ({ backgroundImage: `url(${paperUri})`, backgroundRepeat: 'repeat', backgroundSize: '256px 256px', opacity: 0.5 } as unknown as ViewStyle)
  : null;
export function PaperScreen({ children, edges = ['top'], style }: { children: ReactNode; edges?: Edge[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.paper, style]}>
      {webPaper ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, webPaper]} />
      ) : (
        <ImageBackground source={paperTile} resizeMode="repeat" style={StyleSheet.absoluteFill} imageStyle={{ opacity: 0.5 }} />
      )}
      <SafeAreaView edges={edges} style={{ flex: 1 }}>
        {children}
      </SafeAreaView>
    </View>
  );
}

/* ── 글씨 ── */
export function StoryText({ style, size = Size.title, ...p }: TextProps & { size?: number; style?: StyleProp<TextStyle> }) {
  return <Text {...p} style={[{ fontFamily: Font.story, fontSize: size, color: Paint.ink, letterSpacing: -0.3, lineHeight: size * 1.38 }, style]} />;
}
export function BodyText({ style, size = Size.body, soft, ...p }: TextProps & { size?: number; soft?: boolean; style?: StyleProp<TextStyle> }) {
  return <Text {...p} style={[{ fontFamily: Font.body, fontSize: size, color: soft ? Paint.inkSoft : Paint.ink, lineHeight: size * 1.5 }, style]} />;
}
/** 형광펜처럼 글씨 아래 절반만 칠한다 */
export function Mark({ children, color = Paint.yellowSoft }: { children: ReactNode; color?: string }) {
  return <Text style={{ backgroundColor: color }}>{children}</Text>;
}

/* ── 손그림 테두리 상자 ── */
type RoughBoxProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  seed?: number;
  dashed?: boolean;
  radius?: number;
  /** 상자 안쪽에 번지는 물감 색 */
  wash?: string;
  washOpacity?: number;
  boil?: boolean;
  /** 처음 나타날 때 펜으로 테두리를 그리고 물감이 번진다 (기본 켬) */
  draw?: boolean;
};

/*
 * 처음 나타날 때 그려지기: 같은 순간에 나타난 상자들은 위에서부터 차례로 그려지도록
 * 0.04초씩 늦게 시작한다. 시계 하나(requestAnimationFrame)를 모든 상자가 같이 쓴다.
 */
const DRAW_MS = 520;
let drawChainAt = 0;
let drawChainN = 0;
function nextDrawDelay() {
  const now = Date.now();
  if (now - drawChainAt > 120) drawChainN = 0;
  drawChainAt = now;
  return Math.min(drawChainN++ * 40, 400);
}
const drawListeners = new Set<(now: number) => void>();
let drawRaf = 0;
function subscribeDraw(fn: (now: number) => void) {
  drawListeners.add(fn);
  if (!drawRaf) {
    const loop = () => {
      const now = Date.now();
      drawListeners.forEach((l) => l(now));
      drawRaf = drawListeners.size ? requestAnimationFrame(loop) : 0;
    };
    drawRaf = requestAnimationFrame(loop);
  }
  return () => {
    drawListeners.delete(fn);
  };
}
/** 0 → 1: 처음 나타날 때 한 번만 그려지는 진행도 */
function useDrawIn(enabled: boolean) {
  const reduce = useReducedMotion();
  const [k, setK] = useState(enabled && !reduce ? 0 : 1);
  useEffect(() => {
    if (!enabled || reduce) {
      setK(1);
      return;
    }
    const start = Date.now() + nextDrawDelay();
    let un: (() => void) | null = subscribeDraw((now) => {
      const t = Math.max(0, Math.min(1, (now - start) / DRAW_MS));
      setK(t);
      if (t >= 1 && un) {
        un();
        un = null;
      }
    });
    return () => {
      if (un) un();
    };
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return k;
}

export function RoughBox({ children, style, fill = Paint.card, stroke = Paint.ink, strokeWidth = 2, seed = 1, dashed, radius = 16, wash, washOpacity = 1, boil, draw = true }: RoughBoxProps) {
  const [size, onLayout] = useSize();
  const t = useBoil(!!boil);
  const k = useDrawIn(draw);
  const d = useMemo(() => (size.w ? roughRect(size.w, size.h, { seed: seed + t * 0.37, r: radius }) : ''), [size.w, size.h, seed, t, radius]);
  const len = useMemo(() => (d && k < 1 ? pathLength(d) : 0), [d, k < 1]); // eslint-disable-line react-hooks/exhaustive-deps
  const washD = useMemo(() => (size.w && wash ? blob(size.w / 2, size.h / 2, size.w / 2 - 6, size.h / 2 - 5, seed + 5, 0.06, 14) : ''), [size.w, size.h, seed, wash]);
  // 펜 선은 앞 70% 동안 그려지고, 바탕과 물감은 뒤따라 번진다
  const pen = Math.min(k / 0.7, 1);
  const ease = 1 - Math.pow(1 - pen, 2);
  const paint = k <= 0.35 ? 0 : (k - 0.35) / 0.65;
  const drawing = k < 1 && len > 0 && !dashed;
  return (
    <View style={style} onLayout={onLayout}>
      {size.w > 0 && (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={d} fill={fill} stroke="none" opacity={k < 1 ? 0.35 + 0.65 * paint : 1} />
          {wash ? <Path d={washD} fill={wash} opacity={washOpacity * (k < 1 ? paint : 1)} transform={k < 1 ? `translate(${(size.w / 2) * (1 - paint)} ${(size.h / 2) * (1 - paint)}) scale(${paint})` : undefined} /> : null}
          <Path
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dashed ? '5 6' : drawing ? `${len} ${len}` : undefined}
            strokeDashoffset={drawing ? len * (1 - ease) : undefined}
            opacity={dashed && k < 1 ? pen : 1}
          />
        </Svg>
      )}
      {children}
    </View>
  );
}

/* ── 물감 얼룩 (부모를 채운다) ── */
export function Wash({ color = Paint.yellowSoft, opacity = 0.9, seed = 3, inset = 0, style }: { color?: string; opacity?: number; seed?: number; inset?: number; style?: StyleProp<ViewStyle> }) {
  const [size, onLayout] = useSize();
  const d = useMemo(() => (size.w ? blob(size.w / 2, size.h / 2, size.w / 2 - inset, size.h / 2 - inset, seed, 0.1, 12) : ''), [size.w, size.h, seed, inset]);
  const d2 = useMemo(() => (size.w ? blob(size.w / 2 + 3, size.h / 2 + 2, size.w / 2 - inset - 4, size.h / 2 - inset - 3, seed + 9, 0.12, 10) : ''), [size.w, size.h, seed, inset]);
  return (
    <View style={[StyleSheet.absoluteFill, style]} onLayout={onLayout} pointerEvents="none">
      {size.w > 0 && (
        <Svg width={size.w} height={size.h}>
          <Path d={d} fill={color} opacity={opacity} />
          <Path d={d2} fill={color} opacity={opacity * 0.4} />
          <Path d={d} fill="none" stroke={color} strokeWidth={2} opacity={0.9} />
        </Svg>
      )}
    </View>
  );
}

/* ── 버튼 ── */
type PaintButtonProps = {
  label: string;
  onPress?: (e: { x: number; y: number }) => void;
  variant?: 'primary' | 'ghost' | 'text';
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  icon?: ReactNode;
  seed?: number;
  accessibilityLabel?: string;
};
export function PaintButton({ label, onPress, variant = 'primary', color = Paint.yellow, disabled, style, small, icon, seed = 7, accessibilityLabel }: PaintButtonProps) {
  const h = small ? 46 : 56;
  if (variant === 'text') {
    return (
      <Pressable onPress={(e) => onPress?.({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} disabled={disabled} style={[{ padding: 10, alignSelf: 'center' }, style]} accessibilityRole="button">
        <BodyText soft size={Size.small} style={{ textDecorationLine: 'underline' }}>{label}</BodyText>
      </Pressable>
    );
  }
  return (
    <PressSquish
      onPress={(e) => onPress?.(e)}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      style={style}
    >
      {(pressed) => (
      <RoughBox
        seed={seed}
        boil={pressed}
        strokeWidth={pressed ? 2.6 : 2.2}
        stroke={disabled ? '#BDB09E' : Paint.ink}
        fill={variant === 'ghost' ? Paint.card : 'transparent'}
        wash={variant === 'primary' && !disabled ? color : undefined}
        style={{ height: h, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 }}
      >
        {icon}
        <StoryText size={small ? Size.lead : 19} style={{ color: disabled ? '#A99B8A' : Paint.ink }}>{label}</StoryText>
      </RoughBox>
      )}
    </PressSquish>
  );
}

/**
 * 누르면 꾹 눌렸다가 통 튀어 오르는 껍데기. 누르는 동안 손그림 선이 빠르게 다시 그려지고, 폰이 톡 울린다.
 * children에 함수를 주면 지금 눌려 있는지(pressed)를 받는다.
 */
export function PressSquish({
  children,
  onPress,
  disabled,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  haptic = true,
}: {
  children: ReactNode | ((pressed: boolean) => ReactNode);
  onPress?: (at: { x: number; y: number }) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'tab' | 'link';
  haptic?: boolean;
}) {
  const reduce = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const s = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }, { rotate: `${(1 - s.value) * -12}deg` }] }));
  return (
    <Pressable
      onPress={(e) => onPress?.({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
      onPressIn={() => {
        setPressed(true);
        if (haptic) feel.tap();
        if (!reduce) s.value = withSpring(0.95, { damping: 15, stiffness: 420 });
      }}
      onPressOut={() => {
        setPressed(false);
        if (!reduce) s.value = withSpring(1, { damping: 7, stiffness: 260 });
      }}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={style}
    >
      <Animated.View style={st}>{typeof children === 'function' ? children(pressed) : children}</Animated.View>
    </Pressable>
  );
}

/* ── 손그림 스위치 ── */
export function PaintToggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} hitSlop={8}>
      <RoughBox seed={value ? 21 : 22} radius={15} fill={Paint.card} wash={value ? Paint.yellow : undefined} style={{ width: 54, height: 30, justifyContent: 'center' }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Paint.ink, backgroundColor: Paint.card, marginLeft: value ? 28 : 5 }} />
      </RoughBox>
    </Pressable>
  );
}

/* ── 손그림 아이콘 ── */
const ICONS = {
  home: 'M5 14 L15 5 L25 14 M8 12 V25 H22 V12 M13 25 V18 H17 V25',
  learn: 'M10 24 V12 q0 -3 3 -3 q3 0 3 3 V18 M16 13 V8 q0 -3 3 -3 q3 0 3 3 V20 q0 6 -7 6 q-5 0 -8 -5 L5 17 q-1 -3 2 -3 L10 18',
  translator: 'M5 8 h14 v10 h-8 l-5 4 z M19 12 h6 v9 l-3 -2 h-6',
  mypage: 'M6 24 c4 -10 8 -6 10 -12 s4 -6 8 -6 M20 6 h4 v4',
  back: 'M18 7 L9 15 L18 23',
  close: 'M8 8 L22 22 M22 8 L8 22',
  star: 'M15 4 l3 7 l7 1 l-5 5 l1 7 l-6 -3 l-6 3 l1 -7 l-5 -5 l7 -1 z',
  play: 'M10 7 L23 15 L10 23 Z',
  check: 'M6 16 l6 6 l12 -14',
  note: 'M8 5 h12 l4 4 v16 h-16 z M12 13 h8 M12 18 h8',
  bookmark: 'M9 5 h12 v20 l-6 -5 l-6 5 z',
  logout: 'M13 6 H7 V24 H13 M17 10 l5 5 l-5 5 M22 15 H11',
} as const;
export type PaintIconName = keyof typeof ICONS;
export function PaintIcon({ name, size = 26, color = Paint.ink, fill = 'none', boil }: { name: PaintIconName; size?: number; color?: string; fill?: string; boil?: boolean }) {
  const t = useBoil(!!boil);
  const d = useMemo(() => jitterPath(ICONS[name], 3 + t, 0.5), [name, t]);
  // View로 감싸야 웹에서 손그림 상자의 물감 층(절대 위치)에 가려지지 않는다
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 30 30">
        <Path d={d} fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/* ── 아래 메뉴: 마을 · 표현 · 통역 · 기록 ── */
export type TabKey = 'home' | 'learn' | 'translator' | 'mypage';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: '마을' },
  { key: 'learn', label: '표현' },
  { key: 'translator', label: '통역' },
  { key: 'mypage', label: '기록' },
];
export function PaintTabBar({ current }: { current: TabKey }) {
  const nav = usePaintNav();
  return (
    <SafeAreaView edges={['bottom']} style={styles.tabWrap}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.key === current;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.label}
              onPress={() => { if (on) return; feel.tap(); void nav.tab(current, t.key); }}
              style={styles.tab}
            >
              <View style={{ width: 44, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                {on && <Wash color={TabColor[t.key]} opacity={0.75} seed={t.key.length} />}
                <PaintIcon name={t.key} color={on ? Paint.ink : Paint.inkSoft} boil={on} />
              </View>
              <BodyText size={Size.caption} style={{ color: on ? Paint.ink : Paint.inkSoft, fontFamily: on ? Font.story : Font.body }}>{t.label}</BodyText>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

/* ── 화면 맨 위: 뒤로 가기 + 제목 ── */
export function PaintHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={10} style={{ width: 40, height: 44, justifyContent: 'center' }}>
          <PaintIcon name="back" size={30} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <StoryText size={Size.heading}>{title}</StoryText>
        {sub ? <BodyText soft size={Size.small}>{sub}</BodyText> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { flex: 1, backgroundColor: Paint.paper },
  tabWrap: { backgroundColor: Paint.paper, borderTopWidth: 1.5, borderTopColor: Paint.line },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8, paddingBottom: 6 },
  tab: { alignItems: 'center', gap: 2, minWidth: 64, paddingVertical: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
});
