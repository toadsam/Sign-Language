import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { ImageBackground, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function LoginScreen() {
  const router = useRouter();

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
              <Text style={styles.heroTitle}>반가워요!{'\n'}수어지교입니다</Text>
              <Text style={styles.heroSubtitle}>오늘도 수어로 세상을 이어보세요</Text>
            </View>
          </ImageBackground>
        </View>

        <View style={styles.formWrap}>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>이메일</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail" size={19} color="#94a3b8" />
              <TextInput
                style={styles.input}
                placeholder="example@email.com"
                placeholderTextColor="#94a3b8"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>비밀번호</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed" size={19} color="#94a3b8" />
              <TextInput
                style={styles.input}
                placeholder="비밀번호를 입력하세요"
                placeholderTextColor="#94a3b8"
                secureTextEntry
              />
            </View>
          </View>

          <Pressable style={styles.loginButton} onPress={() => router.push('/home')}>
            <Text style={styles.loginButtonText}>로그인</Text>
          </Pressable>

          <View style={styles.dividerWrap}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>SNS 계정으로 간편 로그인</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialWrap}>
            <Pressable style={styles.kakaoButton}>
              <MaterialCommunityIcons name="chat" size={22} color="#3c1e1e" />
            </Pressable>
          </View>

          <View style={styles.footerArea}>
            <Pressable onPress={() => router.push('/signup')}>
              <Text style={styles.signupText}>회원가입</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f7f8',
  },
  root: {
    flex: 1,
    backgroundColor: '#f6f7f8',
  },
  heroOuter: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 2,
  },
  heroCard: {
    minHeight: 260,
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
    paddingHorizontal: 22,
    paddingBottom: 20,
  },
  heroBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  heroSubtitle: {
    marginTop: 6,
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '500',
  },
  formWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 18,
    gap: 14,
  },
  fieldWrap: {
    gap: 8,
  },
  label: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  inputWrap: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '400',
  },
  loginButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#137fec',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 3,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  dividerWrap: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  socialWrap: {
    alignItems: 'center',
    marginTop: 2,
  },
  kakaoButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerArea: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 20,
  },
  signupText: {
    color: '#137fec',
    fontSize: 14,
    fontWeight: '800',
  },
});
