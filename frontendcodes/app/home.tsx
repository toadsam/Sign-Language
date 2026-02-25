import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#1f80e3';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.profileWrap}>
              <Image
                source={{
                  uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCuZETDLRamDcAeDLqsFHRHY7H8vVuyNRf2BjbeRkBNnbpvzmtYka4wZUIw4nMw4UjnoxdJhQ3GWnkkh6SipTszqzAzyaMMiH_aojuiiRJtAzGyRXJJ4vCWTh4DlSgdkPdpyPpso6vK9-TlBdgpMt42i_pur5Bqft_LCR-sNkZarzqQP3WoO5pXedmHsVIJ6jji1gBXedgAtCdJCkMYhfIsWplUnRXF_VqMTidonJ1lZVrHZL4LzhdBALOXzlKcDvzWXEqHotuHtQ',
                }}
                style={styles.profileImage}
              />
              <Text style={styles.profileName}>Suyeojigyo</Text>
            </View>
            <Pressable style={styles.iconButton}>
              <Ionicons name="notifications" size={20} color="#111827" />
            </Pressable>
          </View>

          <View style={styles.intro}>
            <Text style={styles.greeting}>안녕하세요, 지은님! 👋</Text>
            <Text style={styles.greetingSub}>수어 학습을 응원합니다!</Text>
          </View>

          <View style={styles.goalCard}>
            <View style={styles.goalRow}>
              <Text style={styles.goalTitle}>오늘의 목표</Text>
              <Text style={styles.goalPercent}>60%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={styles.progressFill} />
            </View>
            <Text style={styles.goalDesc}>오늘의 퀴즈 5개 중 3개 완료</Text>
          </View>

          <View style={styles.challengeCard}>
            <ImageBackground
              source={{
                uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAeBXLm8AsZa9W_A4zcMMuEO5YNVSZsEBJJt-0__TjAgfJHqfJxaMgOjKZpQbWURqkfin-snASQwDh8amBBn42SrIMt-cM0Ovdh2VkTtHiXock6utcXPhhGnWO1kKOWTGDk9sbBLxB99saqgejzYDcBCxUdWYzbCfuEGdd6GkJ-27Z2whgDZkv4kvIUxQ0fHlaxD_IyShlXhqB3W215cLWdLGNlt7o11RnFrsxnvTEti7H_Jk4tWgbA--E1_9JGH4mxCHCEz7Tlmg',
              }}
              imageStyle={styles.challengeImage}
              style={styles.challengeImageWrap}>
              <View style={styles.challengeOverlay} />
              <View style={styles.challengeBadge}>
                <Text style={styles.challengeBadgeText}>오늘의 챌린지</Text>
              </View>
            </ImageBackground>

            <View style={styles.challengeBody}>
              <Text style={styles.challengeTitle}>오늘의 퀴즈 풀기</Text>
              <Text style={styles.challengeSub}>AI 아바타와 함께 수어 실력을 키워보세요.</Text>
              <Pressable style={styles.challengeButton}>
                <Text style={styles.challengeButtonText}>퀴즈 시작하기</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.quickWrap}>
            <Text style={styles.quickTitle}>빠른 메뉴</Text>
            <Pressable style={styles.quickCard}>
              <View style={styles.quickIconWrap}>
                <MaterialCommunityIcons name="sign-language" size={22} color={PRIMARY} />
              </View>
              <View style={styles.quickTextWrap}>
                <Text style={styles.quickMain}>수어 통역</Text>
                <Text style={styles.quickSub}>실시간으로 텍스트를 수어로 변환하세요</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </Pressable>
          </View>
        </ScrollView>

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem}>
            <Ionicons name="home" size={18} color={PRIMARY} />
            <Text style={[styles.navText, styles.navTextActive]}>홈</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/learn')}>
            <Ionicons name="school-outline" size={18} color="#94a3b8" />
            <Text style={styles.navText}>학습하기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/translator')}>
            <MaterialCommunityIcons name="sign-language" size={18} color="#94a3b8" />
            <Text style={styles.navText}>통역기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/mypage')}>
            <Ionicons name="person-outline" size={18} color="#94a3b8" />
            <Text style={styles.navText}>마이페이지</Text>
          </Pressable>
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
  scrollContent: {
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 104,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  profileName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: {
    marginTop: 14,
  },
  greeting: {
    fontSize: 21,
    fontWeight: '800',
    color: '#111827',
    lineHeight: 29,
  },
  greetingSub: {
    marginTop: 3,
    fontSize: 15,
    color: '#5a7da1',
    fontWeight: '500',
  },
  goalCard: {
    marginTop: 24,
    paddingHorizontal: 4,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  goalPercent: {
    fontSize: 16,
    color: PRIMARY,
    fontWeight: '700',
  },
  progressTrack: {
    marginTop: 10,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#cfdbe7',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: '60%',
    borderRadius: 999,
    backgroundColor: PRIMARY,
  },
  goalDesc: {
    marginTop: 8,
    color: '#5a7da1',
    fontSize: 14,
    fontWeight: '500',
  },
  challengeCard: {
    marginTop: 22,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  challengeImageWrap: {
    height: 166,
    justifyContent: 'flex-end',
  },
  challengeImage: {
    width: '100%',
    height: '100%',
  },
  challengeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
  },
  challengeBadge: {
    marginLeft: 12,
    marginBottom: 10,
    backgroundColor: PRIMARY,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  challengeBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  challengeBody: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  challengeTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#111827',
  },
  challengeSub: {
    marginTop: 4,
    color: '#5a7da1',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  challengeButton: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
  },
  challengeButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  quickWrap: {
    marginTop: 24,
  },
  quickTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  quickCard: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dbe4ef',
    backgroundColor: '#edf4fb',
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  quickTextWrap: {
    flex: 1,
  },
  quickMain: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  quickSub: {
    marginTop: 2,
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 72,
    paddingBottom: 6,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 58,
  },
  navText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  navTextActive: {
    color: PRIMARY,
  },
});
