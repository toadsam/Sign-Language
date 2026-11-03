import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Palette, Type } from '@/constants/design';

export type MascotMood = 'hello' | 'correct' | 'wrong' | 'cheer' | 'thinking' | 'celebrate' | 'sleepy';

/**
 * 완성된 마스코트 이미지가 생기면 여기에 연결한다.
 * 예) hello: require('@/assets/mascot/kkuljit-hello.png'),
 * 비어 있는 표정은 아래의 임시 그림으로 그린다. (프롬프트는 docs/design/mascot-prompts.md)
 */
const MASCOT_IMAGES: Partial<Record<MascotMood, ImageSourcePropType>> = {};

const MOOD_LABELS: Record<MascotMood, string> = {
  hello: '손을 흔들며 인사하는',
  correct: '정답에 신난',
  wrong: '괜찮다고 다독이는',
  cheer: '응원하는',
  thinking: '생각 중인',
  celebrate: '목표 달성을 축하하는',
  sleepy: '졸린',
};

type HandPose = { x: number; y: number; rotate: number; fingers: boolean };

// 좌표는 100×100 상자 기준. 손가락 다섯 개를 지키는 게 이 캐릭터의 규칙이다.
const HAND_POSES: Record<MascotMood, [HandPose, HandPose]> = {
  hello: [
    { x: 20, y: 68, rotate: -20, fingers: true },
    { x: 84, y: 34, rotate: 15, fingers: true },
  ],
  correct: [
    { x: 14, y: 28, rotate: -28, fingers: true },
    { x: 86, y: 28, rotate: 28, fingers: true },
  ],
  celebrate: [
    { x: 36, y: 14, rotate: -12, fingers: true },
    { x: 64, y: 14, rotate: 12, fingers: true },
  ],
  cheer: [
    { x: 16, y: 42, rotate: -10, fingers: false },
    { x: 84, y: 42, rotate: 10, fingers: false },
  ],
  wrong: [
    { x: 12, y: 64, rotate: -78, fingers: true },
    { x: 88, y: 64, rotate: 78, fingers: true },
  ],
  thinking: [
    { x: 20, y: 70, rotate: -12, fingers: true },
    { x: 60, y: 62, rotate: -32, fingers: true },
  ],
  sleepy: [
    { x: 38, y: 42, rotate: 20, fingers: false },
    { x: 82, y: 72, rotate: 20, fingers: true },
  ],
};

// [왼쪽 눈썹 각도, 오른쪽 눈썹 각도, 위로 올림]
const BROWS: Record<MascotMood, [number, number, number]> = {
  hello: [-10, 10, 2],
  correct: [-14, 14, 3],
  celebrate: [-14, 14, 3],
  cheer: [16, -16, 0],
  wrong: [-18, 18, 1],
  thinking: [-4, 14, 2],
  sleepy: [6, -6, -1],
};

const FINGERS = [
  { angle: -64, length: 7 },
  { angle: -28, length: 10 },
  { angle: -8, length: 11 },
  { angle: 12, length: 10 },
  { angle: 32, length: 8 },
];

type MascotProps = {
  mood?: MascotMood;
  size?: number;
  /** 누르면 반응한다. 넘긴 함수도 같이 불린다. */
  onPress?: () => void;
  interactive?: boolean;
};

export function Mascot({ mood = 'hello', size = 120, onPress, interactive = false }: MascotProps) {
  const u = (n: number) => (n * size) / 100;
  const [reduceMotion, setReduceMotion] = useState(false);
  const float = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const wave = useRef(new Animated.Value(0)).current;
  const flap = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(false));
  }, []);

  // 둥실둥실 떠 있는 움직임. 신난 표정은 더 높이 뛴다.
  useEffect(() => {
    if (reduceMotion) return;
    const excited = mood === 'correct' || mood === 'celebrate';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: excited ? 380 : 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: excited ? 380 : 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float, mood, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(2800),
        Animated.timing(blink, { toValue: 0.1, duration: 80, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [blink, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || mood !== 'hello') {
      wave.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wave, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(wave, { toValue: -1, duration: 260, useNativeDriver: true }),
        Animated.timing(wave, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.delay(1200),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [mood, reduceMotion, wave]);

  // 꿀벌 날갯짓. 졸릴 때는 날개를 접는다.
  useEffect(() => {
    if (reduceMotion || mood === 'sleepy') {
      flap.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flap, { toValue: 0.55, duration: 120, useNativeDriver: true }),
        Animated.timing(flap, { toValue: 1, duration: 120, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [flap, mood, reduceMotion]);

  // 표정이 바뀔 때 살짝 튀어 오른다.
  useEffect(() => {
    if (reduceMotion) return;
    pop.setValue(0.88);
    Animated.spring(pop, { toValue: 1, tension: 220, friction: 7, useNativeDriver: true }).start();
  }, [mood, pop, reduceMotion]);

  function handlePress() {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (!reduceMotion) {
      pop.setValue(1.14);
      Animated.spring(pop, { toValue: 1, tension: 200, friction: 5, useNativeDriver: true }).start();
    }
    onPress?.();
  }

  const floatY = float.interpolate({
    inputRange: [0, 1],
    outputRange: [0, mood === 'correct' || mood === 'celebrate' ? -u(8) : -u(3.5)],
  });
  const image = MASCOT_IMAGES[mood];

  const figure = (
    <Animated.View
      style={{ width: size, height: size, transform: [{ translateY: floatY }, { scale: pop }] }}>
      {image ? (
        <Image source={image} style={{ width: size, height: size }} resizeMode="contain" />
      ) : (
        <DrawnMascot mood={mood} u={u} blink={blink} wave={wave} flap={flap} />
      )}
    </Animated.View>
  );

  const label = `마스코트 꿀짓이, ${MOOD_LABELS[mood]} 모습`;

  if (!interactive && !onPress) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={label}>
        {figure}
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="누르면 꿀짓이가 반응해요">
      {figure}
    </Pressable>
  );
}

type DrawnProps = {
  mood: MascotMood;
  u: (n: number) => number;
  blink: Animated.Value;
  wave: Animated.Value;
  flap: Animated.Value;
};

/** 이미지가 오기 전까지 쓰는 임시 꿀벌 그림. View만으로 그린다. */
function DrawnMascot({ mood, u, blink, wave, flap }: DrawnProps) {
  const [leftHand, rightHand] = HAND_POSES[mood];
  const [leftBrow, rightBrow, browLift] = BROWS[mood];
  const happyEyes = mood === 'correct' || mood === 'celebrate';
  const sleepy = mood === 'sleepy';
  const waveRotate = wave.interpolate({ inputRange: [-1, 1], outputRange: ['-14deg', '14deg'] });

  return (
    <View style={{ width: u(100), height: u(100) }}>
      {/* 날개: 몸 뒤에서 파닥인다 */}
      <Animated.View style={[styles.abs, styles.wing, { left: u(6), top: u(22), width: u(26), height: u(22), borderRadius: u(13), transform: [{ rotate: '-24deg' }, { scaleY: flap }] }]} />
      <Animated.View style={[styles.abs, styles.wing, { left: u(68), top: u(22), width: u(26), height: u(22), borderRadius: u(13), transform: [{ rotate: '24deg' }, { scaleY: flap }] }]} />

      {/* 더듬이 두 개, 끝은 동그란 방울 */}
      <View style={[styles.abs, styles.antenna, { left: u(39), top: u(8), width: u(2.6), height: u(15), borderRadius: u(2), transform: [{ rotate: '-22deg' }] }]} />
      <View style={[styles.abs, styles.antenna, { left: u(58.4), top: u(8), width: u(2.6), height: u(15), borderRadius: u(2), transform: [{ rotate: '22deg' }] }]} />
      <View style={[styles.abs, styles.antenna, { left: u(33), top: u(4), width: u(8), height: u(8), borderRadius: u(4) }]} />
      <View style={[styles.abs, styles.antenna, { left: u(59), top: u(4), width: u(8), height: u(8), borderRadius: u(4) }]} />

      {/* 발 */}
      <View style={[styles.abs, styles.foot, { left: u(34), top: u(82), width: u(13), height: u(8), borderRadius: u(5) }]} />
      <View style={[styles.abs, styles.foot, { left: u(53), top: u(82), width: u(13), height: u(8), borderRadius: u(5) }]} />

      {/* 몸: 꿀색 + 갈색 줄무늬 두 줄 */}
      <View
        style={[
          styles.abs,
          styles.body,
          {
            left: u(22),
            top: u(20),
            width: u(56),
            height: u(66),
            borderTopLeftRadius: u(30),
            borderTopRightRadius: u(30),
            borderBottomLeftRadius: u(26),
            borderBottomRightRadius: u(26),
          },
        ]}>
        <View style={[styles.stripe, { top: u(40), height: u(7) }]} />
        <View style={[styles.stripe, { top: u(52), height: u(7) }]} />
      </View>

      {/* 눈썹 */}
      <View style={[styles.abs, styles.brow, { left: u(33), top: u(30 - browLift), width: u(11), height: u(2.8), borderRadius: u(2), transform: [{ rotate: `${leftBrow}deg` }] }]} />
      <View style={[styles.abs, styles.brow, { left: u(56), top: u(30 - browLift), width: u(11), height: u(2.8), borderRadius: u(2), transform: [{ rotate: `${rightBrow}deg` }] }]} />

      {/* 눈 */}
      {[u(34), u(57)].map((left, index) =>
        happyEyes ? (
          <View key={index} style={[styles.abs, { left, top: u(37), width: u(10), height: u(5.5), overflow: 'hidden' }]}>
            <View style={{ width: u(10), height: u(10), borderRadius: u(5), borderWidth: u(2.6), borderColor: Palette.ink }} />
          </View>
        ) : sleepy ? (
          <View key={index} style={[styles.abs, { left, top: u(40), width: u(10), height: u(2.6), borderRadius: u(2), backgroundColor: Palette.ink }]} />
        ) : (
          <Animated.View
            key={index}
            style={[styles.abs, { left: left + u(0.5), top: u(35), width: u(9), height: u(11), borderRadius: u(5), backgroundColor: Palette.ink, transform: [{ scaleY: blink }] }]}>
            <View style={{ position: 'absolute', left: u(1.6), top: u(1.6), width: u(3.4), height: u(3.4), borderRadius: u(2), backgroundColor: '#ffffff' }} />
          </Animated.View>
        )
      )}

      {/* 볼 */}
      <View style={[styles.abs, styles.cheek, { left: u(27), top: u(48), width: u(9), height: u(5), borderRadius: u(3) }]} />
      <View style={[styles.abs, styles.cheek, { left: u(64), top: u(48), width: u(9), height: u(5), borderRadius: u(3) }]} />

      <Mouth mood={mood} u={u} />

      <Hand pose={leftHand} u={u} />
      <Hand pose={rightHand} u={u} extraRotate={mood === 'hello' ? waveRotate : undefined} />

      {mood === 'celebrate' && (
        <View style={[styles.abs, { left: u(41), top: u(-8) }]}>
          <Ionicons name="star" size={u(18)} color="#fbbf24" />
        </View>
      )}
      {mood === 'correct' && (
        <>
          <View style={[styles.abs, { left: u(2), top: u(6) }]}>
            <Ionicons name="sparkles" size={u(14)} color="#fbbf24" />
          </View>
          <View style={[styles.abs, { left: u(84), top: u(4) }]}>
            <Ionicons name="sparkles" size={u(11)} color="#fbbf24" />
          </View>
        </>
      )}
      {mood === 'thinking' && (
        <Text style={[styles.abs, styles.mark, { left: u(78), top: u(4), fontSize: u(18) }]}>?</Text>
      )}
      {mood === 'sleepy' && (
        <Text style={[styles.abs, styles.mark, { left: u(74), top: u(6), fontSize: u(14) }]}>z z</Text>
      )}
    </View>
  );
}

function Mouth({ mood, u }: { mood: MascotMood; u: (n: number) => number }) {
  if (mood === 'correct' || mood === 'celebrate' || mood === 'cheer') {
    return (
      <View
        style={[
          styles.abs,
          {
            left: u(44),
            top: u(48),
            width: u(12),
            height: u(9),
            borderTopLeftRadius: u(2),
            borderTopRightRadius: u(2),
            borderBottomLeftRadius: u(7),
            borderBottomRightRadius: u(7),
            backgroundColor: '#5a2a44',
            overflow: 'hidden',
          },
        ]}>
        <View style={{ position: 'absolute', left: u(3), top: u(5), width: u(6), height: u(5), borderRadius: u(3), backgroundColor: '#ff8fa8' }} />
      </View>
    );
  }
  if (mood === 'thinking' || mood === 'sleepy') {
    const w = mood === 'sleepy' ? 7 : 5;
    return (
      <View style={[styles.abs, { left: u(50 - w / 2), top: u(50), width: u(w), height: u(w + 1), borderRadius: u(4), backgroundColor: '#5a2a44' }]} />
    );
  }
  const w = mood === 'wrong' ? 9 : 12;
  return (
    <View style={[styles.abs, { left: u(50 - w / 2), top: u(47), width: u(w), height: u(w / 2), overflow: 'hidden' }]}>
      <View
        style={{
          width: u(w),
          height: u(w),
          marginTop: -u(w / 2),
          borderRadius: u(w / 2),
          borderWidth: u(2.6),
          borderColor: Palette.ink,
        }}
      />
    </View>
  );
}

function Hand({
  pose,
  u,
  extraRotate,
}: {
  pose: HandPose;
  u: (n: number) => number;
  extraRotate?: Animated.AnimatedInterpolation<string>;
}) {
  const palm = u(16);
  const transforms: any[] = [{ rotate: `${pose.rotate}deg` }];
  if (extraRotate) transforms.push({ rotate: extraRotate });

  return (
    <Animated.View
      style={[
        styles.abs,
        { left: u(pose.x) - palm / 2, top: u(pose.y) - palm / 2, width: palm, height: palm, transform: transforms },
      ]}>
      {pose.fingers &&
        FINGERS.map((finger, index) => (
          <View
            key={index}
            style={[styles.abs, { left: 0, top: 0, width: palm, height: palm, transform: [{ rotate: `${finger.angle}deg` }] }]}>
            <View
              style={[
                styles.finger,
                {
                  position: 'absolute',
                  left: (palm - u(4.6)) / 2,
                  top: -u(finger.length) + u(4),
                  width: u(4.6),
                  height: u(finger.length),
                  borderRadius: u(2.3),
                },
              ]}
            />
          </View>
        ))}
      <View style={[styles.palm, { width: palm, height: palm, borderRadius: palm / 2, borderWidth: u(1.2) }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  abs: {
    position: 'absolute',
  },
  body: {
    backgroundColor: Palette.mascot,
    borderWidth: 1.5,
    borderColor: Palette.mascotLine,
    overflow: 'hidden',
  },
  stripe: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#6b4a2b',
  },
  wing: {
    backgroundColor: 'rgba(196, 232, 255, 0.9)',
    borderWidth: 1.5,
    borderColor: '#9fd2f5',
  },
  antenna: {
    backgroundColor: '#6b4a2b',
  },
  foot: {
    backgroundColor: Palette.mascotLine,
  },
  brow: {
    backgroundColor: Palette.ink,
  },
  cheek: {
    backgroundColor: '#ff9b85',
    opacity: 0.85,
  },
  palm: {
    backgroundColor: Palette.mascot,
    borderColor: Palette.mascotLine,
  },
  finger: {
    backgroundColor: Palette.mascot,
    borderWidth: 1,
    borderColor: Palette.mascotLine,
  },
  mark: {
    fontFamily: Type.family,
    fontWeight: '900',
    color: Palette.primaryDeep,
  },
});
