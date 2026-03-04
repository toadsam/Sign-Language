﻿import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ImageBackground, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';
import { useGoogleIdTokenAuthRequest } from '@/lib/auth/google';

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithGoogleIdToken, signInWithBackendUser, continueAsGuest, accessToken, isGuest } = useAuth();
  const { request, response, promptAsync, isExpoGo, hasGoogleClientId } = useGoogleIdTokenAuthRequest();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // accessToken이나 isGuest가 이미 있으면 홈으로 이동하는 로직을 제거
  // (회원가입 미완료 시 signup으로 이동해야 하므로)
  // useEffect(() => {
  //   if (accessToken || isGuest) {
  //     router.replace('/home');
  //   }
  // }, [accessToken, isGuest, router]);

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

      try {
        setIsSubmitting(true);
        setErrorMessage(null);
<<<<<<< HEAD
        await signInWithGoogleIdToken(idToken);
        router.replace('/home');
=======

        // 1. 먼저 로그인 시도
        const loginResponse = await fetch('http://localhost:8080/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });

        const loginData = await loginResponse.json();
        console.log('로그인 응답:', loginData);
        console.log('isRegistered 값:', loginData.isRegistered);
        console.log('user.isRegistered 값:', loginData.user?.isRegistered);

        if (loginResponse.ok && loginData.success) {
          // 로그인 성공
          console.log('로그인 성공, 백엔드 응답:', loginData);

          if (loginData.isRegistered === true) {
            // 회원가입 완료된 유저 -> 백엔드 유저 정보로 AuthContext 업데이트 후 홈으로
            console.log('회원가입 완료 유저 -> 백엔드 유저 정보로 로그인, 홈으로 이동');
            console.log('백엔드 유저 정보:', loginData.user);

            await signInWithBackendUser(loginData.accessToken, loginData.user);
            router.replace('/home');
          } else {
            // 회원가입 미완료 유저 -> 회원가입 화면으로
            console.log('회원가입 미완료 유저 -> 회원가입 화면으로 이동');

            // 임시로 토큰만 저장 (회원가입 완료 후 다시 업데이트됨)
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
          // 2. 유저가 없으면 회원가입 시도
          console.log('유저 없음 -> 회원가입 시도');
          const signupResponse = await fetch('http://localhost:8080/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          });

          const signupData = await signupResponse.json();
          console.log('회원가입 응답:', signupData);

          if (signupResponse.ok && signupData.success) {
            // 회원가입 성공 -> 백엔드 유저 정보로 AuthContext 업데이트 후 회원가입 화면으로
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
>>>>>>> 5822cc4279c14711c9be9faba5acf1d44fb72d1d
      } catch (error) {
        console.error(error);
        setErrorMessage('로그인에 실패했습니다. 다시 시도해 주세요.');
      } finally {
        setIsSubmitting(false);
      }
    };

    void login();
  }, [response, router, signInWithBackendUser]);

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

    const result =
      Platform.OS === 'web'
        ? await promptAsync({ useProxy: false })
        : await promptAsync({ useProxy: isExpoGo });

    if (result.type === 'cancel' || result.type === 'dismiss') {
      setErrorMessage('Google 로그인 창이 닫혔습니다.');
    }

    if (result.type === 'error') {
      setErrorMessage('Google 로그인에 실패했습니다. Redirect URI 설정을 확인해 주세요.');
    }
  };

  const handleGuestStart = async () => {
    setErrorMessage(null);
    await continueAsGuest();
    router.replace('/home');
  };

  // "이미 로그인된 상태입니다" UI 제거
  // (회원가입 미완료 유저가 signup으로 이동해야 하는데 방해됨)

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.heroOuter}>
          <ImageBackground
            source={{
              uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBXn24fQMDcoI3rUzrydUHazyrICj3jYUhTR7ZfzqwcDCPgl-ncgo3DUdv3Ee9q2aDTTEEG8FneqPQiO-pNYOmdjmpuetwsK0Gz2K5T2mXGEuzJU6O7kr6G81w7wUGGKAi_rcZ_q98Tpins_Nj13BbSzIkqaGm4jiDXV8HVQhYkeFioIFYP4Q-8GpH5Pk-Zjz32E-rJJp9QLMD7xVPdQfONgD_OBCvl3l11HlnMYDQOChcqysBFrz9Za3HxtuzlZqlS3doIl2xSYQ',
            }}
            imageStyle={styles.heroImage}
            style={styles.heroCard}>
            <View style={styles.heroOverlay} />
            <View style={styles.heroContent}>
              <View style={styles.heroBadge}>
                <MaterialCommunityIcons name="sign-language" size={20} color="#137fec" />
              </View>
              <Text style={styles.heroTitle}>반가워요!{"\n"}수어지교입니다</Text>
              <Text style={styles.heroSubtitle}>오늘도 수어로 세상을 이어보세요</Text>
            </View>
          </ImageBackground>
        </View>

        <View style={styles.loginWrap}>
          <Pressable style={styles.kakaoButton}>
            <MaterialCommunityIcons name="chat" size={20} color="#3c1e1e" />
            <Text style={styles.kakaoText}>카카오는 준비 중입니다</Text>
          </Pressable>

          <Pressable
            disabled={!request || isSubmitting}
            onPress={handleGooglePress}
            style={({ pressed }) => [
              styles.googleButton,
              (!request || isSubmitting) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}>
            <Ionicons name="logo-google" size={20} color="#4285F4" />
            <Text style={styles.googleText}>
              {isSubmitting ? '로그인 중...' : '구글로 간편 로그인 / 회원가입'}
            </Text>
          </Pressable>

          <Pressable onPress={handleGuestStart} style={styles.guestStartButton}>
            <Text style={styles.guestStartText}>로그인 없이 시작</Text>
          </Pressable>
        </View>

        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        <View style={styles.footer}>
          <View style={styles.footerLinksRow}>
            <Text style={styles.footerLink}>이용약관</Text>
            <Text style={styles.footerDivider}>|</Text>
            <Text style={styles.footerLink}>개인정보처리방침</Text>
          </View>
          <Text style={styles.footerCopy}>© 2026 수어지교. All rights reserved.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2f4f7',
  },
  root: {
    flex: 1,
    backgroundColor: '#f2f4f7',
  },
  heroOuter: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  heroCard: {
    minHeight: 188,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  heroImage: {
    borderRadius: 16,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  heroContent: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  heroBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    marginTop: 4,
    color: '#d8dee8',
    fontSize: 14,
    fontWeight: '600',
  },
  loginWrap: {
    paddingHorizontal: 14,
    paddingTop: 46,
    gap: 10,
  },
  kakaoButton: {
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FEE500',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 3,
  },
  kakaoText: {
    color: '#3c1e1e',
    fontSize: 16,
    fontWeight: '800',
  },
  googleButton: {
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dfe3e9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  googleText: {
    color: '#4b5563',
    fontSize: 16,
    fontWeight: '800',
  },
  guestStartButton: {
    alignSelf: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginTop: 2,
  },
  guestStartText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  errorText: {
    marginTop: 12,
    color: '#dc2626',
    fontSize: 13,
    textAlign: 'center',
  },
  footer: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingBottom: 14,
    gap: 4,
  },
  footerLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  footerLink: {
    color: '#c5ccd6',
    fontSize: 10,
    fontWeight: '500',
  },
  footerDivider: {
    color: '#d8dde4',
    fontSize: 10,
    fontWeight: '500',
  },
  footerCopy: {
    color: '#bcc5d1',
    fontSize: 10,
    fontWeight: '500',
  },
  loggedInWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f2f4f7',
    gap: 10,
  },
  loggedInTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1f2937',
  },
  loggedInSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  goHomeButton: {
    marginTop: 8,
    height: 46,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: '#137fec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goHomeButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
