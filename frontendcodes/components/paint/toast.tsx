/**
 * 알림 쪽지: 테이프로 붙인 종이가 위에서 내려왔다가 다시 올라간다.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Size } from '@/constants/paint';
import { BodyText, RoughBox, StoryText } from './paint-ui';

export function PaintToast({ title, sub, visible, top = 12 }: { title: string; sub?: string; visible: boolean; top?: number }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(-160);
  useEffect(() => {
    y.value = reduce ? withTiming(visible ? 0 : -160, { duration: 1 }) : withSpring(visible ? 0 : -160, { damping: 13, stiffness: 140 });
  }, [visible, reduce, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { rotate: '-1deg' }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { top }, style]} accessibilityLiveRegion="polite">
      <View style={[styles.tape, { left: 22, transform: [{ rotate: '-8deg' }] }]} />
      <View style={[styles.tape, { right: 22, transform: [{ rotate: '7deg' }] }]} />
      <RoughBox seed={41} style={styles.box}>
        <StoryText size={Size.lead}>{title}</StoryText>
        {sub ? <BodyText soft size={Size.small}>{sub}</BodyText> : null}
      </RoughBox>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20, zIndex: 50 },
  box: { paddingVertical: 12, paddingHorizontal: 16 },
  tape: { position: 'absolute', top: -9, width: 46, height: 18, backgroundColor: 'rgba(255,224,138,0.85)', zIndex: 2 },
});
