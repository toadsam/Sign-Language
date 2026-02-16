import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
            style={styles.heroCard}
          >
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
          <Pressable style={styles.kakaoButton} onPress={() => router.push('/home')}>
            <MaterialCommunityIcons name="chat" size={20} color="#3c1e1e" />
            <Text style={styles.kakaoText}>카카오 1초 로그인/회원가입</Text>
          </Pressable>

          <Pressable style={styles.googleButton}>
            <Ionicons name="logo-google" size={20} color="#4285F4" />
            <Text style={styles.googleText}>구글로 간편 로그인/회원가입</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <View style={styles.footerLinksRow}>
            <Text style={styles.footerLink}>이용약관</Text>
            <Text style={styles.footerDivider}>|</Text>
            <Text style={styles.footerLink}>개인정보처리방침</Text>
          </View>
          <Text style={styles.footerCopy}>© 2024 수어지교. All rights reserved.</Text>
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
  googleText: {
    color: '#4b5563',
    fontSize: 16,
    fontWeight: '800',
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
});