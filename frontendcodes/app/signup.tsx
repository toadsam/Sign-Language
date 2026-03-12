import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';
import { getBaseUrl } from '@/lib/api/base-url';

export default function SignupScreen() {
  const apiBaseUrl = getBaseUrl();
  const router = useRouter();
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
        router.replace('/home');
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Ionicons name="person-add" size={40} color="#137fec" />
            </View>
            <Text style={styles.title}>추가 정보 입력</Text>
            <Text style={styles.subtitle}>
              서비스 이용을 위해 아래 정보를 입력해주세요
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>이름 *</Text>
              <TextInput
                style={styles.input}
                placeholder="홍길동"
                placeholderTextColor="#9ca3af"
                value={name}
                onChangeText={setName}
                editable={!isSubmitting}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>이메일</Text>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                value={email}
                editable={false}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>전화번호 *</Text>
              <TextInput
                style={styles.input}
                placeholder="010-1234-5678"
                placeholderTextColor="#9ca3af"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                keyboardType="phone-pad"
                editable={!isSubmitting}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>학교/직장 *</Text>
              <TextInput
                style={styles.input}
                placeholder="아주대학교"
                placeholderTextColor="#9ca3af"
                value={organization}
                onChangeText={setOrganization}
                editable={!isSubmitting}
              />
            </View>

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <Pressable
              disabled={isSubmitting}
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.submitButton,
                isSubmitting && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.submitButtonText}>
                {isSubmitting ? '처리 중...' : '회원가입 완료'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2f4f7',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 30,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1f2937',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    textAlign: 'center',
  },
  form: {
    gap: 18,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
  },
  input: {
    height: 50,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2937',
  },
  inputDisabled: {
    backgroundColor: '#f3f4f6',
    color: '#9ca3af',
  },
  errorText: {
    marginTop: -6,
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  submitButton: {
    marginTop: 12,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#137fec',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
});

