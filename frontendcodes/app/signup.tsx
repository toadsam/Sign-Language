import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Bee } from '@/components/paint/bee';
import { BodyText, Mark, PaintButton, PaperScreen, RoughBox, StoryText } from '@/components/paint/paint-ui';
import { usePaintNav } from '@/components/paint/transition';
import { Font, Paint, Size } from '@/constants/paint';

import { useAuth } from '@/context/auth-context';
import { getBaseUrl } from '@/lib/api/base-url';

export default function SignupScreen() {
  const apiBaseUrl = getBaseUrl();
  const nav = usePaintNav();
  const params = useLocalSearchParams();
  const googleId = params.googleId as string;
  const email = params.email as string;
  const { updateUser } = useAuth();

  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [organization, setOrganization] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    // 필드 검증
    if (!name.trim()) {
      setErrorMessage('이름을 입력해주세요.');
      return;
    }
    if (!phoneNumber.trim()) {
      setErrorMessage('전화번호를 입력해주세요.');
      return;
    }
    if (!organization.trim()) {
      setErrorMessage('학교/직장을 입력해주세요.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      console.log('회원가입 완료 요청:', { googleId, name, phoneNumber, organization });

      const response = await fetch(`${apiBaseUrl}/api/auth/signup/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleId,
          name: name.trim(),
          phoneNumber: phoneNumber.trim(),
          organization: organization.trim(),
        }),
      });

      const data = await response.json();
      console.log('회원가입 완료 응답:', data);

      if (data.success) {
        // AuthContext의 user 정보 업데이트
        await updateUser({
          name: name.trim(),
          email: email,
        });

        console.log('회원가입 완료! 홈으로 이동');

        // Alert 대신 바로 홈으로 이동
        void nav.go('/home', { replace: true });
      } else {
        setErrorMessage(data.message || '회원가입에 실패했습니다.');
      }
    } catch (error) {
      console.error('회원가입 에러:', error);
      setErrorMessage('서버와의 통신에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 입력 칸 하나: 손그림 테두리 상자 안에 글자
  const field = (label: string, value: string, onChange: ((v: string) => void) | null, opts: { placeholder?: string; phone?: boolean } = {}, seed = 1) => (
    <View style={styles.field}>
      <BodyText size={Size.small} style={styles.label}>{label}</BodyText>
      <RoughBox seed={seed} fill={onChange ? Paint.card : Paint.paperDeep} style={styles.inputBox}>
        <TextInput
          style={styles.input}
          placeholder={opts.placeholder}
          placeholderTextColor={Paint.inkFaint}
          value={value}
          onChangeText={onChange ?? undefined}
          keyboardType={opts.phone ? 'phone-pad' : 'default'}
          editable={!!onChange && !isSubmitting}
          accessibilityLabel={label}
        />
      </RoughBox>
    </View>
  );

  return (
    <PaperScreen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Bee size={64} />
            <StoryText size={Size.heading} style={{ marginTop: 8 }}>
              마을에 이름을 <Mark>적어 주세요</Mark>
            </StoryText>
            <BodyText soft>서비스를 이용하려면 아래 정보가 필요해요.</BodyText>
          </View>

          <View style={styles.form}>
            {field('이름 *', name, setName, { placeholder: '홍길동' }, 31)}
            {field('이메일', email, null, {}, 32)}
            {field('전화번호 *', phoneNumber, setPhoneNumber, { placeholder: '010-1234-5678', phone: true }, 33)}
            {field('학교/직장 *', organization, setOrganization, { placeholder: '아주대학교' }, 34)}

            {errorMessage ? (
              <BodyText size={Size.small} style={styles.error} accessibilityRole="alert">{errorMessage}</BodyText>
            ) : null}

            <PaintButton label={isSubmitting ? '처리 중…' : '회원가입 완료'} disabled={isSubmitting} onPress={handleSubmit} seed={35} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </PaperScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 32 },
  header: { gap: 4, marginBottom: 20 },
  form: { gap: 14 },
  field: { gap: 6 },
  label: { fontFamily: Font.story },
  inputBox: { height: 52, justifyContent: 'center', paddingHorizontal: 14 },
  input: { fontFamily: Font.body, fontSize: Size.lead, color: Paint.ink, outlineStyle: 'none' } as never,
  error: { color: '#B5462F', textAlign: 'center' },
});
