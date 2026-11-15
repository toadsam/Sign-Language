/**
 * 수어링고 글씨 로고: 글자마다 메뉴 물감(마을 · 표현 · 통역 · 기록) 한 방울을 깔고
 * 펜으로 쓴 글씨를 살짝 비뚤게 올린다. 정식 로고가 오면 이 부품만 바꾸면 된다.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Size, TabColor } from '@/constants/paint';
import { StoryText, Wash } from './paint-ui';

export const LOGO_NAME = '수어링고';
export const LOGO_LETTERS: { ch: string; color: string; tilt: number; dy: number }[] = [
  { ch: '수', color: TabColor.home, tilt: -5, dy: 1 },
  { ch: '어', color: TabColor.learn, tilt: 4, dy: -2 },
  { ch: '링', color: TabColor.translator, tilt: -3, dy: 2 },
  { ch: '고', color: TabColor.mypage, tilt: 5, dy: -1 },
];

export function VillageLogo({ size = Size.lead + 2, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const cell = size * 1.55;
  return (
    <View style={[styles.row, style]} accessible accessibilityRole="header" accessibilityLabel={LOGO_NAME}>
      {LOGO_LETTERS.map((l, i) => (
        <View
          key={l.ch}
          style={{ width: cell, height: cell, marginLeft: i ? -size * 0.22 : 0, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: l.dy }, { rotate: `${l.tilt}deg` }] }}
        >
          <Wash color={l.color} opacity={0.8} seed={11 + i * 5} inset={2} />
          <StoryText size={size} style={{ lineHeight: size * 1.2 }}>{l.ch}</StoryText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
