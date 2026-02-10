import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { ImageBackground, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function SignupScreen() {
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

            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={18} color="#fff" />
            </Pressable>

            <View style={styles.heroContent}>
              <View style={styles.heroIconWrap}>
                <MaterialCommunityIcons name="sign-language" size={20} color="#137fec" />
              </View>
              <Text style={styles.heroTitle}>
                새로운 만남을{'\n'}환영합니다!
              </Text>
              <Text style={styles.heroSubtitle}>수어지교와 함께 소통의 벽을 허물어보세요</Text>
            </View>
          </ImageBackground>
        </View>

        <View style={styles.formWrap}>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>닉네임</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="person" size={20} color="#94a3b8" />
              <TextInput
                style={styles.input}
                placeholder="사용할 닉네임을 입력하세요"
                placeholderTextColor="#94a3b8"
              />
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>이메일</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail" size={20} color="#94a3b8" />
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
              <Ionicons name="lock-closed" size={20} color="#94a3b8" />
              <TextInput
                style={styles.input}
                placeholder="6자리 이상 입력하세요"
                placeholderTextColor="#94a3b8"
                secureTextEntry
              />
            </View>
          </View>

          <View style={styles.submitArea}>
            <Pressable style={styles.submitButton}>
              <Text style={styles.submitText}>회원가입 완료</Text>
            </Pressable>
          </View>

          <View style={styles.loginRow}>
            <Text style={styles.loginHint}>이미 계정이 있으신가요?</Text>
            <Pressable onPress={() => router.back()}>
              <Text style={styles.loginLink}>로그인</Text>
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
    paddingBottom: 0,
  },
  heroCard: {
    minHeight: 260,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: '#dbeafe',
  },
  heroImage: {
    borderRadius: 16,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  backButton: {
    position: 'absolute',
    left: 14,
    top: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  heroContent: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 2,
  },
  heroIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  heroSubtitle: {
    marginTop: 2,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '500',
  },
  formWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 14,
  },
  fieldWrap: {
    gap: 8,
  },
  label: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 2,
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
  submitArea: {
    marginTop: 'auto',
    paddingTop: 8,
  },
  submitButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#137fec',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 3,
  },
  submitText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 6,
    paddingBottom: 8,
  },
  loginHint: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '500',
  },
  loginLink: {
    color: '#137fec',
    fontSize: 13,
    fontWeight: '800',
  },
});
