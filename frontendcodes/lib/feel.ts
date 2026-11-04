/**
 * 손끝 느낌(진동). 웹이나 진동을 못 쓰는 기기에서는 조용히 넘어간다.
 * 화면에서 expo-haptics를 직접 부르지 말고 여기 이름을 쓴다. 같은 순간에는 같은 진동이 나야 익숙해진다.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const on = Platform.OS === 'ios' || Platform.OS === 'android';
const safe = (fn: () => Promise<unknown>) => {
  if (!on) return;
  fn().catch(() => {});
};

export const feel = {
  /** 버튼을 눌렀을 때 */
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** 정답 */
  right: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** 오답 */
  wrong: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** 마을이 칠해지거나 오늘 목표를 채웠을 때: 톡-톡-쿵 */
  celebrate: () => {
    if (!on) return;
    safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    setTimeout(() => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)), 120);
    setTimeout(() => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)), 260);
  },
};
