import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#137fec';

export default function MyPageScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.headerIcon} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </Pressable>
          <Text style={styles.headerTitle}>마이페이지</Text>
          <View style={styles.headerIcon} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.profileCard}>
            <View style={styles.avatarWrap}>
              <Image
                source={{
                  uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA9xzg_QHvuUbnQVvId25kc3DxT6xgZYv7hdXVPBleZEWUHktwcMlvQG1wx-vXuT53_Ah-AQVmTIBVym4_hT8xWPSd9Fp9rCWpXdIQWWr4REC3xvNLAjTBVl8BvaBCZCW1WZwNkrA8zFK28kgB3birhCN3AX21RhyN83PJDnB3HbWsnyYI8ZfOJHO7DL3LhPpwUIZoxWLeddmWQP9xoPrqcGe2WLR9OI25acRea0Px0vbWqG8RvtJow0X1bCQXGv6hckv7Zn9rsyA',
                }}
                contentFit="cover"
                style={styles.avatar}
              />
              <Pressable style={styles.editBadge}>
                <Ionicons name="create" size={13} color="#fff" />
              </Pressable>
            </View>
            <Text style={styles.name}>김수여</Text>
            <Text style={styles.subtitle}>열심히 배우고 있어요! 👋</Text>
          </View>

          <Text style={styles.sectionTitle}>나의 학습 통계</Text>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={styles.statTop}>
                <View style={[styles.statIconWrap, { backgroundColor: '#fff7ed' }]}>
                  <Ionicons name="flame" size={18} color="#f97316" />
                </View>
                <Text style={styles.statLabel}>연속 학습일</Text>
              </View>
              <Text style={styles.statValue}>
                12<Text style={styles.statUnit}>일</Text>
              </Text>
            </View>

            <View style={styles.statCard}>
              <View style={styles.statTop}>
                <View style={[styles.statIconWrap, { backgroundColor: '#eff6ff' }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#3b82f6" />
                </View>
                <Text style={styles.statLabel}>평균 정확도</Text>
              </View>
              <Text style={styles.statValue}>
                85<Text style={styles.statUnit}>%</Text>
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>학습 관리</Text>
          <View style={styles.menuWrap}>
            <Pressable style={styles.menuItem} onPress={() => router.push('/wrongnote')}>
              <View style={styles.menuLeft}>
                <View style={[styles.menuIconWrap, { backgroundColor: '#fef2f2' }]}>
                  <MaterialCommunityIcons name="alert-box-outline" size={18} color="#ef4444" />
                </View>
                <Text style={styles.menuText}>오답 노트 (단어장)</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </Pressable>

            <Pressable style={styles.menuItem} onPress={() => router.push('/bookmark')}>
              <View style={styles.menuLeft}>
                <View style={[styles.menuIconWrap, { backgroundColor: '#fffbeb' }]}>
                  <Ionicons name="bookmark" size={18} color="#f59e0b" />
                </View>
                <Text style={styles.menuText}>북마크</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </Pressable>
          </View>

          <Pressable style={styles.logoutBtn}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} onPress={() => router.push('/home')}>
            <Ionicons name="home-outline" size={20} color="#94a3b8" />
            <Text style={styles.navText}>홈</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/learn')}>
            <Ionicons name="school-outline" size={20} color="#94a3b8" />
            <Text style={styles.navText}>학습하기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/translator')}>
            <Ionicons name="language-outline" size={20} color="#94a3b8" />
            <Text style={styles.navText}>통역기</Text>
          </Pressable>
          <Pressable style={styles.navItem}>
            <Ionicons name="person" size={20} color={PRIMARY} />
            <Text style={[styles.navText, styles.navTextActive]}>마이페이지</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f5f7',
  },
  root: {
    flex: 1,
    backgroundColor: '#f3f5f7',
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  headerIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 108,
  },
  profileCard: {
    marginTop: 8,
    marginBottom: 14,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef2f7',
    alignItems: 'center',
    paddingVertical: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 10,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: '#fff',
  },
  editBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  name: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    color: '#5b7ca0',
    fontWeight: '600',
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 10,
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9edf3',
    padding: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  statTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '700',
  },
  statValue: {
    fontSize: 44,
    color: '#111827',
    fontWeight: '800',
    lineHeight: 50,
  },
  statUnit: {
    fontSize: 24,
    color: '#6b7280',
    fontWeight: '700',
  },
  menuWrap: {
    gap: 10,
  },
  menuItem: {
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9edf3',
    paddingVertical: 15,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {
    fontSize: 17,
    color: '#111827',
    fontWeight: '700',
  },
  logoutBtn: {
    marginTop: 22,
    alignItems: 'center',
    paddingVertical: 10,
  },
  logoutText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 76,
    paddingBottom: 4,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 58,
  },
  navText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
  },
  navTextActive: {
    color: PRIMARY,
  },
});
