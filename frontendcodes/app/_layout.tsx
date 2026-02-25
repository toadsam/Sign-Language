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

    const inLoginScreen = (segments[0] as string | undefined) === 'login';
    const canUseApp = Boolean(accessToken) || isGuest;

    if (!canUseApp && !inLoginScreen) {
      router.replace('/login' as any);
      return;
    }

    if (canUseApp && inLoginScreen) {
      router.replace('/home' as any);
    }
  }, [accessToken, isGuest, isLoading, segments]);

  if (isLoading) {
    return null;
  }

  return (
    <Stack>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="learn" options={{ headerShown: false }} />
      <Stack.Screen name="translator" options={{ headerShown: false }} />
      <Stack.Screen name="mapping" options={{ headerShown: false }} />
      <Stack.Screen name="mypage" options={{ headerShown: false }} />
      <Stack.Screen name="wrongnote" options={{ headerShown: false }} />
      <Stack.Screen name="bookmark" options={{ headerShown: false }} />
      <Stack.Screen name="quiz" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}

