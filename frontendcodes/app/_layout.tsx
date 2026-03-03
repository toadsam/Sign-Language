import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/context/auth-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthGate />
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}

function AuthGate() {
  const segments = useSegments();
  const { isLoading, accessToken, isGuest } = useAuth();

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const currentPath = (segments[0] as string | undefined);
    const inLoginScreen = currentPath === 'login';
    const inSignupScreen = currentPath === 'signup';
    const canUseApp = Boolean(accessToken) || isGuest;

    console.log('AuthGate - currentPath:', currentPath, 'canUseApp:', canUseApp, 'inLoginScreen:', inLoginScreen, 'inSignupScreen:', inSignupScreen);

    // 로그인/회원가입 화면이 아닌데 인증이 안되어 있으면 로그인으로
    if (!canUseApp && !inLoginScreen && !inSignupScreen) {
      console.log('AuthGate - 인증 없음, 로그인으로 이동');
      router.replace('/login' as any);
      return;
    }

    // 인증이 되어 있고 로그인 화면에 있으면 홈으로
    // BUT: 회원가입 화면으로 이동 중일 수 있으므로 체크하지 않음
    // (login.tsx에서 router.push를 호출했지만 아직 경로가 변경되지 않은 상태)
    // if (canUseApp && inLoginScreen && !inSignupScreen) {
    //   console.log('AuthGate - 로그인 화면에서 홈으로 리다이렉트');
    //   router.replace('/home' as any);
    // }
  }, [accessToken, isGuest, isLoading, segments]);

  if (isLoading) {
    return null;
  }

  return (
    <Stack>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="learn" options={{ headerShown: false }} />
      <Stack.Screen name="translator" options={{ headerShown: false }} />
      <Stack.Screen name="mypage" options={{ headerShown: false }} />
      <Stack.Screen name="wrongnote" options={{ headerShown: false }} />
      <Stack.Screen name="bookmark" options={{ headerShown: false }} />
      <Stack.Screen name="quiz" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}

