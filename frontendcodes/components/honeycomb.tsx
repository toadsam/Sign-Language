import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { Palette, Type } from '@/constants/design';
import { LearningUnit } from '@/lib/learning-units';

type CellState = 'done' | 'current' | 'locked';

const CELL_COLORS: Record<CellState, { face: string; edge: string; icon: string }> = {
  done: { face: '#ffc233', edge: '#d9901a', icon: Palette.ink },
  current: { face: '#ffe08a', edge: '#e0a21b', icon: Palette.primaryDeep },
  locked: { face: '#f3ead6', edge: '#e2d5b8', icon: '#b3a58a' },
};

// 지그재그로 놓아 벌집처럼 보이게 한다. 칸 너비 대비 비율.
const ZIGZAG = [0, 0.55, 0.85, 0.55, 0, -0.55, -0.85, -0.55];

/**
 * 뾰족한 위아래를 가진 육각형. 직사각형 세 장을 0°, 60°, -60°로 겹쳐 만든다.
 * side는 한 변의 길이, 전체 크기는 가로 √3·side, 세로 2·side.
 */
function Hexagon({ side, color }: { side: number; color: string }) {
  const width = Math.sqrt(3) * side;
  const rect = {
    position: 'absolute' as const,
    left: 0,
    top: side / 2,
    width,
    height: side,
    backgroundColor: color,
    borderRadius: side * 0.14,
  };
  return (
    <View style={{ width, height: side * 2 }}>
      <View style={rect} />
      <View style={[rect, { transform: [{ rotate: '60deg' }] }]} />
      <View style={[rect, { transform: [{ rotate: '-60deg' }] }]} />
    </View>
  );
}

type HexCellProps = {
  side: number;
  state: CellState;
  unit: LearningUnit;
  onPress?: () => void;
};

/** 아래에 두께가 있는 입체 벌집 칸. 지금 할 칸은 통통 숨 쉰다. */
function HexCell({ side, state, unit, onPress }: HexCellProps) {
  const depth = Math.round(side * 0.16);
  const [pressed, setPressed] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const colors = CELL_COLORS[state];

  useEffect(() => {
    if (state !== 'current') return;
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ])
        );
        loop.start();
      });
    return () => loop?.stop();
  }, [pulse, state]);

  const width = Math.sqrt(3) * side;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] });
  const stateLabel = state === 'done' ? '완료' : state === 'current' ? '지금 할 차례' : '아직 잠김';

  return (
    <Pressable
      onPress={state === 'locked' ? undefined : onPress}
      onPressIn={() => {
        if (state === 'locked') return;
        setPressed(true);
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${unit.title} 단원, ${stateLabel}`}
      accessibilityState={{ disabled: state === 'locked' }}
      style={{ alignItems: 'center' }}>
      <Animated.View style={{ width, height: side * 2 + depth, transform: [{ scale }] }}>
        {state === 'current' && (
          <Animated.View style={[styles.glow, { opacity: glow, left: -side * 0.18, top: -side * 0.18 }]}>
            <Hexagon side={side * 1.18} color="#ffd255" />
          </Animated.View>
        )}
        <View style={[styles.abs, { top: depth }]}>
          <Hexagon side={side} color={colors.edge} />
        </View>
        <View style={[styles.abs, { top: pressed ? depth : 0 }]}>
          <Hexagon side={side} color={colors.face} />
          {/* 윗부분 광택: 젤리처럼 보이게 */}
          <View
            style={[
              styles.shine,
              { left: width * 0.28, top: side * 0.42, width: width * 0.3, height: side * 0.16, borderRadius: side * 0.1 },
            ]}
          />
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Ionicons name={state === 'locked' ? 'lock-closed' : unit.icon} size={side * 0.62} color={colors.icon} />
          </View>
          {state === 'done' && (
            <View style={[styles.badge, { right: width * 0.06, top: side * 0.2 }]}>
              <Ionicons name="checkmark" size={14} color="#ffffff" />
            </View>
          )}
        </View>
      </Animated.View>
      <Text style={[styles.cellTitle, state === 'locked' && styles.cellTitleLocked]}>{unit.title}</Text>
    </Pressable>
  );
}

type HoneycombMapProps = {
  units: LearningUnit[];
  completed: number;
  onPressUnit: (unit: LearningUnit) => void;
  side?: number;
};

/** 위에서 아래로 지그재그로 내려가는 벌집 지도. 지금 할 칸 옆에 꿀짓이가 떠 있다. */
export function HoneycombMap({ units, completed, onPressUnit, side = 40 }: HoneycombMapProps) {
  const width = Math.sqrt(3) * side;
  return (
    <View style={styles.map}>
      {units.map((unit, index) => {
        const state: CellState = index < completed ? 'done' : index === completed ? 'current' : 'locked';
        const shift = ZIGZAG[index % ZIGZAG.length] * width;
        return (
          <View key={unit.key} style={[styles.row, { transform: [{ translateX: shift }] }]}>
            <HexCell side={side} state={state} unit={unit} onPress={() => onPressUnit(unit)} />
            {state === 'current' && (
              <View style={[styles.bee, shift > 0 ? { right: width + 18 } : { left: width + 18 }]}>
                <View style={styles.tag}>
                  <Text style={styles.tagText}>여기부터!</Text>
                </View>
                <Mascot mood="cheer" size={78} onPress={() => onPressUnit(unit)} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: {
    position: 'absolute',
    left: 0,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
  },
  shine: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  badge: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Palette.success,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellTitle: {
    marginTop: 4,
    fontFamily: Type.family,
    fontSize: Type.caption + 1,
    fontWeight: '800',
    color: Palette.ink,
  },
  cellTitleLocked: {
    color: Palette.muted,
  },
  map: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  row: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bee: {
    position: 'absolute',
    top: -8,
    alignItems: 'center',
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Palette.ink,
    marginBottom: -4,
    zIndex: 1,
  },
  tagText: {
    fontFamily: Type.family,
    fontSize: Type.caption,
    fontWeight: '800',
    color: '#ffffff',
  },
});
