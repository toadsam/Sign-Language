import * as Haptics from 'expo-haptics';
import { ReactNode, useState } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Palette, Radius, Type } from '@/constants/design';

type ChunkyButtonProps = {
  label: string;
  onPress?: () => void;
  /** 윗면 색 */
  color?: string;
  /** 아래 두꺼운 띠 색. 누르면 윗면이 이 띠 위로 내려앉는다. */
  edge?: string;
  textColor?: string;
  borderColor?: string;
  height?: number;
  depth?: number;
  left?: ReactNode;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/** 아래에 띠를 깐 입체 버튼. 누르면 쑥 들어간다. */
export function ChunkyButton({
  label,
  onPress,
  color = Palette.primary,
  edge = Palette.mascotLine,
  textColor = Palette.ink,
  borderColor,
  height = 56,
  depth = 5,
  left,
  right,
  style,
  accessibilityLabel,
}: ChunkyButtonProps) {
  const [pressed, setPressed] = useState(false);
  const offset = pressed ? depth : 0;

  return (
    <Pressable
      style={[{ height: height + depth }, style]}
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}>
      <View style={[styles.edge, { top: depth, height, backgroundColor: edge }]} />
      <View
        style={[
          styles.face,
          {
            height,
            backgroundColor: color,
            transform: [{ translateY: offset }],
            borderColor: borderColor ?? 'transparent',
            borderWidth: borderColor ? 2 : 0,
          },
        ]}>
        {left}
        <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
          {label}
        </Text>
        {right}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  edge: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: Radius.lg,
  },
  face: {
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  label: {
    fontFamily: Type.family,
    fontSize: Type.bodyStrong + 1,
    fontWeight: '900',
  },
});
