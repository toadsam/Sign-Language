/**
 * 앱의 첫 주소("/").
 * 예전에는 따로 만든 소개 화면이 있었는데, 색칠 마을에서는 로그인 화면이 그 역할을 한다.
 * 로그인했거나 둘러보기 중이면 마을(홈)로, 아니면 로그인으로 보낸다.
 */
import { Redirect } from 'expo-router';

import { useAuth } from '@/context/auth-context';

export default function Index() {
  const { isLoading, accessToken, isGuest } = useAuth();
  if (isLoading) return null;
  return <Redirect href={accessToken || isGuest ? '/home' : '/login'} />;
}
