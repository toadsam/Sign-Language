import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { LoginArt } from '@/components/paint/login-art';
import { LOGO_NAME, VillageLogo } from '@/components/paint/logo';
import { BodyText, Mark, PaintButton, PaperScreen, StoryText } from '@/components/paint/paint-ui';
import { usePaintNav } from '@/components/paint/transition';
import { Size } from '@/constants/paint';

import { useAuth } from '@/context/auth-context';
import { useGoogleIdTokenAuthRequest } from '@/lib/auth/google';
import { getBaseUrl } from '@/lib/api/base-url';

export default function LoginScreen() {
  const apiBaseUrl = getBaseUrl();
  const router = useRouter();
  const nav = usePaintNav();
  const { signInWithGoogleIdToken, signInWithBackendUser, continueAsGuest, accessToken, isGuest } = useAuth();
  const { request, response, promptAsync, hasGoogleClientId } = useGoogleIdTokenAuthRequest();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const processedIdTokenRef = useRef<string | null>(null);

  // accessToken이나 isGuest가 이미 있으면 홈으로 이동하는 로직을 제거
  // (회원가입 미완료 시 signup으로 이동해야 하므로)
  // useEffect(() => {
  //   if (accessToken || isGuest) {
  //     router.replace('/home');
  //   }
  // }, [accessToken, isGuest, router]);

  const processGoogleIdToken = useCallback(async (idToken: string) => {
    if (processedIdTokenRef.current === idToken) {
      return;
    }
    processedIdTokenRef.current = idToken;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const loginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      const loginData = await loginResponse.json();
      console.log('로그인 응답:', loginData);
      console.log('isRegistered 값:', loginData.isRegistered);
      console.log('user.isRegistered 값:', loginData.user?.isRegistered);

      if (loginResponse.ok && loginData.success) {
        console.log('로그인 성공, 백엔드 응답:', loginData);

        if (loginData.isRegistered === true) {
          console.log('회원가입 완료 유저 -> 백엔드 유저 정보로 로그인, 홈으로 이동');
          console.log('백엔드 유저 정보:', loginData.user);

          await signInWithBackendUser(loginData.accessToken, loginData.user);
          void nav.go('/home', { replace: true });
        } else {
          console.log('회원가입 미완료 유저 -> 회원가입 화면으로 이동');

          await signInWithBackendUser(loginData.accessToken, loginData.user);

          const googleId = loginData.user.id;
          const email = loginData.user.email || '';

          console.log('이동할 경로:', '/signup', '파라미터:', { googleId, email });

          router.push({
            pathname: '/signup' as any,
            params: {
              googleId,
              email,
            },
          } as any);
        }
      } else if (loginResponse.status === 404 && loginData.needsSignup) {
        console.log('유저 없음 -> 회원가입 시도');
        const signupResponse = await fetch(`${apiBaseUrl}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });

        const signupData = await signupResponse.json();
        console.log('회원가입 응답:', signupData);

        if (signupResponse.ok && signupData.success) {
          await signInWithBackendUser(signupData.accessToken, signupData.user);

          const googleId = signupData.user.id;
          const email = signupData.user.email || '';

          console.log('회원가입 성공 -> 회원가입 화면으로 이동, googleId:', googleId);
          router.push({
            pathname: '/signup' as any,
            params: {
              googleId,
              email,
            },
          } as any);
        } else {
          setErrorMessage(signupData.message || '회원가입에 실패했습니다.');
        }
      } else {
        setErrorMessage(loginData.message || '로그인에 실패했습니다.');
      }
    } catch (error) {
      console.error(error);
      setErrorMessage('로그인에 실패했습니다. 다시 시도해 주세요.');
      processedIdTokenRef.current = null;
    } finally {
      setIsSubmitting(false);
    }
  }, [apiBaseUrl, router, nav, signInWithBackendUser]);

  useEffect(() => {
    const login = async () => {
      if (!response) {
        return;
      }

      if (response.type === 'cancel' || response.type === 'dismiss') {
        setErrorMessage('Google 로그인 창이 닫혔습니다.');
        return;
      }

      if (response.type === 'error') {
        setErrorMessage('Google 로그인에 실패했습니다. Redirect URI 설정을 확인해 주세요.');
        return;
      }

      if (response.type !== 'success') {
        return;
      }

      const idToken = response.params?.id_token;
      if (!idToken) {
        setErrorMessage('Google id token을 읽지 못했습니다.');
        return;
      }

      await processGoogleIdToken(idToken);
    };

    void login();
  }, [processGoogleIdToken, response]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type !== 'sign-language.google-auth' || typeof event.data.idToken !== 'string') {
        return;
      }

      void processGoogleIdToken(event.data.idToken);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [processGoogleIdToken]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash.includes('id_token=')) {
      return;
    }

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const idToken = params.get('id_token');
    if (!idToken) {
      return;
    }

    window.history.replaceState(null, '', window.location.pathname);
    if (window.opener && window.opener !== window) {
      try {
        window.opener.postMessage({ type: 'sign-language.google-auth', idToken }, window.location.origin);
        window.close();
        return;
      } catch {
        // Complete login in this window if the popup cannot reach its opener.
      }
    }

    void processGoogleIdToken(idToken);
  }, [processGoogleIdToken]);

  const handleGooglePress = async () => {
    if (!hasGoogleClientId) {
      setErrorMessage('frontendcodes/.env의 EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID를 확인해 주세요.');
      return;
    }

    if (!request) {
      setErrorMessage('Google 로그인 준비 중입니다. `npx expo start -c`로 다시 실행해 주세요.');
      return;
    }

    setErrorMessage(null);

    const result = await promptAsync();

    if (result.type === 'cancel' || result.type === 'dismiss') {
      setErrorMessage('Google 로그인 창이 닫혔습니다.');
    }

    if (result.type === 'error') {
      setErrorMessage('Google 로그인에 실패했습니다. Redirect URI 설정을 확인해 주세요.');
    }
  };

  const handleGuestStart = async (at: { x: number; y: number }) => {
    setErrorMessage(null);
    await continueAsGuest();
    // 노란 붓이 지나가며 마을로 들어간다
    void nav.go('/home', { replace: true, ...at });
  };

  // "이미 로그인된 상태입니다" UI 제거
  // (회원가입 미완료 유저가 signup으로 이동해야 하는데 방해됨)

  const { width } = useWindowDimensions();
  const artWidth = Math.min(width - 44, 360);

  return (
    <PaperScreen edges={['top', 'bottom']}>
      <View style={styles.root}>
        <View style={styles.art}>
          <LoginArt width={artWidth} />
        </View>

        <View style={styles.copy}>
          <VillageLogo size={Size.title} style={{ alignSelf: 'flex-start' }} />
          <StoryText size={Size.display - 3} style={{ marginTop: 16 }}>
            손으로 하는 말,{'\n'}
            <Mark>마을</Mark>에서 같이 배워요
          </StoryText>
          <BodyText soft style={{ marginTop: 8 }}>
            장소마다 쓰는 수어 표현을 하나 배울 때마다{'\n'}마을에 색이 하나씩 칠해져요.
          </BodyText>
        </View>

        <View style={styles.buttons}>
          <PaintButton
            label={isSubmitting ? '로그인 중…' : '구글로 계속하기'}
            disabled={!request || isSubmitting}
            onPress={handleGooglePress}
            seed={11}
          />
          <PaintButton variant="ghost" label="로그인 없이 둘러보기" onPress={handleGuestStart} seed={12} />
          {errorMessage ? (
            <BodyText size={Size.small} style={styles.error} accessibilityRole="alert">
              {errorMessage}
            </BodyText>
          ) : null}
          <View style={styles.footer}>
            <BodyText size={Size.caption} soft>이용약관 · 개인정보처리방침</BodyText>
            <BodyText size={Size.caption} soft>© 2026 {LOGO_NAME}</BodyText>
          </View>
        </View>
      </View>
    </PaperScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 22 },
  art: { alignItems: 'center', marginTop: 18 },
  copy: { marginTop: 8 },
  buttons: { marginTop: 'auto', gap: 10, paddingBottom: 6 },
  error: { color: '#B5462F', textAlign: 'center' },
  footer: { alignItems: 'center', gap: 2, marginTop: 4 },
});
