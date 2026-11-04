import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { Palette, Type } from '@/constants/design';

export const SPLASH_LINE = '소리가 없어도, 마음은 닿아요';

// 꿀벌의 8자 춤 궤적. 렘니스케이트 위의 점들.
const TRAIL_COUNT = 16;
const TRAIL = Array.from({ length: TRAIL_COUNT }, (_, i) => {
  const t = (i / TRAIL_COUNT) * Math.PI * 2;
  const d = 1 + Math.sin(t) ** 2;
  return { x: Math.cos(t) / d, y: (Math.sin(t) * Math.cos(t)) / d };
});

/**
 * 앱을 켤 때 잠깐 보이는 첫 화면.
 * 꿀짓이가 날아 들어오며 8자 꿀방울 궤적을 남기고, 로고와 한 줄 멘트가 떠오른다.
 * 화면을 누르면 바로 넘어간다.
 */
export function SplashOverlay({ onDone }: { onDone: () => void }) {
  const fly = useRef(new Animated.Value(0)).current;
  const trail = useRef(TRAIL.map(() => new Animated.Value(0))).current;
  const text = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);

  function finish() {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(fade, { toValue: 0, duration: 320, useNativeDriver: true }).start(() => onDone());
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) {
          fly.setValue(1);
          trail.forEach((dot) => dot.setValue(1));
          text.setValue(1);
          timer = setTimeout(finish, 1200);
          return;
        }
        Animated.sequence([
          Animated.timing(fly, { toValue: 1, duration: 900, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
          Animated.stagger(
            35,
            trail.map((dot) => Animated.timing(dot, { toValue: 1, duration: 180, useNativeDriver: true }))
          ),
          Animated.timing(text, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.delay(1100),
        ]).start(finish);
      });
    return () => {
      if (timer) clearTimeout(timer);
    };
    // 처음 한 번만 재생한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beeX = fly.interpolate({ inputRange: [0, 1], outputRange: [-260, 0] });
  const beeY = fly.interpolate({ inputRange: [0, 0.5, 1], outputRange: [120, -40, 0] });
  const beeTilt = fly.interpolate({ inputRange: [0, 0.7, 1], outputRange: ['-24deg', '10deg', '0deg'] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}>
      <Pressable style={styles.fill} onPress={finish} accessibilityRole="button" accessibilityLabel={`수어지교. ${SPLASH_LINE}. 눌러서 시작`}>
        <View style={[styles.blob, styles.blobA]} />
        <View style={[styles.blob, styles.blobB]} />

        <View style={styles.stage}>
          {TRAIL.map((point, index) => (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                {
                  opacity: trail[index],
                  transform: [
                    { translateX: point.x * 120 },
                    { translateY: point.y * 120 + 24 },
                    { scale: trail[index] },
                  ],
                },
              ]}
            />
          ))}
          <Animated.View style={{ transform: [{ translateX: beeX }, { translateY: beeY }, { rotate: beeTilt }] }}>
            <Mascot mood="hello" size={170} />
          </Animated.View>
        </View>

        <Animated.View
          style={{
            alignItems: 'center',
            opacity: text,
            transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
          }}>
          <Text style={styles.title}>수어지교</Text>
          <Text style={styles.line}>{SPLASH_LINE}</Text>
        </Animated.View>

        <Animated.Text style={[styles.footer, { opacity: text }]}>손끝으로 잇는 수어 학습</Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Palette.bg,
    zIndex: 100,
  },
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: Palette.primary,
  },
  blobA: {
    width: 360,
    height: 360,
    top: -140,
    right: -120,
    opacity: 0.22,
  },
  blobB: {
    width: 260,
    height: 260,
    bottom: -90,
    left: -100,
    opacity: 0.16,
  },
  stage: {
    width: 260,
    height: 230,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Palette.primaryWarm,
  },
  title: {
    marginTop: 18,
    fontFamily: Type.family,
    fontSize: Type.display + 4,
    fontWeight: '900',
    color: Palette.ink,
  },
  line: {
    marginTop: 8,
    fontFamily: Type.family,
    fontSize: Type.bodyStrong + 2,
    fontWeight: '700',
    color: Palette.inkSoft,
  },
  footer: {
    position: 'absolute',
    bottom: 48,
    fontFamily: Type.family,
    fontSize: Type.caption + 1,
    fontWeight: '700',
    color: Palette.muted,
  },
});
