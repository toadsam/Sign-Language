/**
 * 앱이 쓰는 화면 크기.
 *
 * 2026-11-17 재훈: 웹에서는 창이 넓으면(PC · 태블릿 · "데스크톱 사이트"로 연 폰) 화면이 옆으로 퍼져 보였다.
 * 그래서 넓은 화면에서는 앱을 폰 너비(APP_MAX_WIDTH)로 가운데에 두고 양옆을 비운다 (app/_layout.tsx).
 * 화면 너비로 그림 크기를 정하는 곳은 창 너비가 아니라 이 훅의 너비를 써야 틀 밖으로 나가지 않는다.
 * 폰 앱(네이티브)에서는 창 크기 그대로다.
 */
import { createContext, useContext } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/** 넓은 화면에서 앱을 가운데에 둘 때의 너비 */
export const APP_MAX_WIDTH = 480;

/** 지금 화면이 폰 너비 틀 안에 있는지. AI 작업실(sign-*)처럼 넓게 쓰는 화면은 false 다 */
export const AppFrameContext = createContext(true);

export function useAppSize() {
  const { width, height } = useWindowDimensions();
  const framed = useContext(AppFrameContext);
  return { width: Platform.OS === 'web' && framed ? Math.min(width, APP_MAX_WIDTH) : width, height };
}
