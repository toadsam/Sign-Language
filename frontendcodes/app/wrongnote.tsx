import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#137fec';

const wrongWords = [
  { word: '사랑합니다', date: '2023.10.24' },
  { word: '친구', date: '2023.10.23' },
  { word: '안녕하세요', date: '2023.10.20' },
  { word: '감사합니다', date: '2023.10.18' },
];

export default function WrongNoteScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.headerIcon} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </Pressable>
          <Text style={styles.headerTitle}>오답 노트 (단어장)</Text>
          <View style={styles.headerIcon} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.dotLayer} />

            <Pressable style={styles.replayBtn}>
              <Ionicons name="refresh" size={16} color="#475569" />
              <Text style={styles.replayText}>다시 보기</Text>
            </Pressable>

            <Image
              source={{
                uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA9xzg_QHvuUbnQVvId25kc3DxT6xgZYv7hdXVPBleZEWUHktwcMlvQG1wx-vXuT53_Ah-AQVmTIBVym4_hT8xWPSd9Fp9rCWpXdIQWWr4REC3xvNLAjTBVl8BvaBCZCW1WZwNkrA8zFK28kgB3birhCN3AX21RhyN83PJDnB3HbWsnyYI8ZfOJHO7DL3LhPpwUIZoxWLeddmWQP9xoPrqcGe2WLR9OI25acRea0Px0vbWqG8RvtJow0X1bCQXGv6hckv7Zn9rsyA',
              }}
              contentFit="cover"
              style={styles.heroImage}
            />

            <View style={styles.wordPanel}>
              <Text style={styles.wordLabel}>선택된 단어</Text>
              <View style={styles.wordRow}>
                <Text style={styles.wordText}>수어지교</Text>
                <Ionicons name="volume-high" size={16} color={PRIMARY} />
              </View>
            </View>
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>틀린 단어 목록</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>12개 복습 필요</Text>
            </View>
          </View>

          <View style={styles.listWrap}>
            {wrongWords.map((item) => (
              <Pressable key={item.word} style={styles.wordItem}>
                <View>
                  <Text style={styles.itemWord}>{item.word}</Text>
                  <View style={styles.dateRow}>
                    <Ionicons name="calendar-outline" size={12} color="#94a3b8" />
                    <Text style={styles.itemDate}>{item.date}</Text>
                  </View>
                </View>

                <View style={styles.playBtn}>
                  <Ionicons name="play" size={18} color={PRIMARY} />
                </View>
              </Pressable>
            ))}
          </View>
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
          <Pressable style={styles.navItem} onPress={() => router.push('/mypage')}>
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
    paddingHorizontal: 12,
    paddingBottom: 108,
  },
  heroCard: {
    marginTop: 4,
    borderRadius: 16,
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#c7ddfc',
    overflow: 'hidden',
    position: 'relative',
  },
  dotLayer: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.4,
    backgroundColor: 'transparent',
  },
  replayBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffffffcc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  replayText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '700',
  },
  heroImage: {
    alignSelf: 'center',
    width: 154,
    height: 154,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
  },
  wordPanel: {
    borderTopWidth: 1,
    borderTopColor: '#cfe0f8',
    backgroundColor: '#f8fbff',
    paddingTop: 10,
    paddingBottom: 12,
    alignItems: 'center',
  },
  wordLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginBottom: 4,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wordText: {
    fontSize: 30,
    color: PRIMARY,
    fontWeight: '800',
  },
  listHeader: {
    marginTop: 20,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  badge: {
    backgroundColor: '#fee2e2',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '700',
  },
  listWrap: {
    gap: 10,
  },
  wordItem: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9edf3',
    borderRadius: 18,
    minHeight: 90,
    paddingVertical: 16,
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
  itemWord: {
    fontSize: 18,
    color: '#111827',
    fontWeight: '800',
  },
  dateRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  itemDate: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8f1ff',
    alignItems: 'center',
    justifyContent: 'center',
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
