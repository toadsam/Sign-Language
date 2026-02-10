import React from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={styles.safeArea.backgroundColor} />

      <View style={styles.container}>
        <View style={styles.heroCard}>
          <View style={styles.heroOverlay} />
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeIcon}>🤟</Text>
          </View>

          <Text style={styles.heroTitle}>반가워요!{"\n"}수어지고입니다</Text>
          <Text style={styles.heroSubtitle}>오늘도 수어로 세상을 이어보세요</Text>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>이메일</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.inputIcon}>✉</Text>
            <TextInput
              placeholder="example@email.com"
              placeholderTextColor="#A7B0BE"
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <Text style={[styles.label, styles.passwordLabel]}>비밀번호</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              placeholder="비밀번호를 입력하세요"
              placeholderTextColor="#A7B0BE"
              style={styles.input}
              secureTextEntry
            />
          </View>

          <TouchableOpacity activeOpacity={0.85} style={styles.loginButton}>
            <Text style={styles.loginButtonText}>로그인</Text>
          </TouchableOpacity>

          <View style={styles.dividerWrap}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>SNS 계정으로 간편 로그인</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity activeOpacity={0.85} style={styles.kakaoButton}>
            <Text style={styles.kakaoIcon}>💬</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.85} style={styles.signupWrap}>
          <Text style={styles.signupText}>회원가입</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F2F3F5',
  },
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  heroCard: {
    height: 208,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#5FA9B4',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 16,
    position: 'relative',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(25, 40, 49, 0.33)',
  },
  heroBadge: {
    position: 'absolute',
    left: 16,
    top: 64,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadgeIcon: {
    fontSize: 18,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 39,
    lineHeight: 45,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.4,
  },
  heroSubtitle: {
    color: '#EAF3F8',
    fontSize: 14,
    fontWeight: '600',
  },
  formSection: {
    marginTop: 22,
    paddingHorizontal: 6,
  },
  label: {
    color: '#313742',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  passwordLabel: {
    marginTop: 14,
  },
  inputWrap: {
    height: 56,
    borderRadius: 20,
    backgroundColor: '#EEF0F3',
    borderWidth: 1,
    borderColor: '#E0E5EB',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  inputIcon: {
    width: 26,
    textAlign: 'center',
    color: '#A8B0BE',
    fontSize: 14,
    marginRight: 4,
  },
  input: {
    flex: 1,
    color: '#39404D',
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 0,
  },
  loginButton: {
    marginTop: 24,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1F80E3',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F80E3',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 4,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  dividerWrap: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#D7DCE4',
  },
  dividerText: {
    color: '#A6AFBD',
    fontSize: 12,
    fontWeight: '600',
  },
  kakaoButton: {
    marginTop: 24,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEE500',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  kakaoIcon: {
    fontSize: 18,
    marginTop: -1,
  },
  signupWrap: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingBottom: 24,
  },
  signupText: {
    color: '#1F80E3',
    fontSize: 20,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

export default App;
