/**
 * 앱 전체가 같이 쓰는 디자인 값.
 * 화면에서 색이나 크기를 직접 적지 말고 여기 값을 가져다 쓴다.
 * 중심 색은 노랑: 따뜻함, 그리고 약자를 지킨다는 느낌(노란 우산 · 어린이 보호구역).
 * 노랑 위 글씨는 흰색 대신 진한 갈색(ink)을 쓴다. 흰 글씨는 노랑 위에서 읽히지 않는다.
 */

import { Fonts } from '@/constants/theme';

export const Palette = {
  primary: '#ffc233',
  // 노랑 계열 글씨용. 흰 바탕 대비 4.5:1 이상
  primaryDeep: '#9a5b00',
  primarySoft: '#fff1c7',
  primaryWarm: '#ff9f43',
  mascot: '#ffd255',
  mascotLine: '#e0a21b',

  ink: '#3a2a17',
  inkSoft: '#5e4a33',
  // 흰 바탕에서 작은 글씨로 써도 대비 4.5:1 이상
  muted: '#7a6650',
  line: '#f1e4c8',
  bg: '#fff9ec',
  surface: '#ffffff',

  success: '#2e9e5b',
  successSoft: '#e6f6ec',
  danger: '#e5574f',
  dangerSoft: '#fff0ee',
  warning: '#ff8a5b',
  warningSoft: '#ffefe6',
  info: '#3b8fe8',
  infoSoft: '#e8f2fd',
} as const;

export const Type = {
  family: Fonts.rounded,
  caption: 12,
  body: 15,
  bodyStrong: 16,
  title: 20,
  heading: 24,
  display: 30,
} as const;

export const Radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const Shadow = {
  card: {
    shadowColor: '#e8cf98',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  soft: {
    shadowColor: '#e8cf98',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
} as const;
