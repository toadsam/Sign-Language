import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#137fec';

const BOOKMARKS = [
  { date: '2023.10.24', ko: '안녕하세요', en: 'Hello / Hi' },
  { date: '2023.10.24', ko: '고마워요', en: 'Thank you' },
  { date: '2023.10.25', ko: '만나서 반가워요', en: 'Nice to meet you' },
  { date: '2023.10.25', ko: '잘 지내요?', en: 'How are you?' },
  { date: '2023.10.26', ko: '좋은 아침이에요', en: 'Good morning' },
  { date: '2023.10.26', ko: '다음에 봐요', en: 'See you next time' },
];

export default function TranslatorScreen() {
  const router = useRouter();
  const [savedVisible, setSavedVisible] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!savedVisible) return;
    const timer = setTimeout(() => setSavedVisible(false), 1200);
    return () => clearTimeout(timer);
  }, [savedVisible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) {
            dragY.setValue(gesture.dy);
          }
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 90) {
            setBookmarkOpen(false);
            dragY.setValue(0);
            return;
          }
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
      }),
    [dragY]
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.headerIcon} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </Pressable>
          <Text style={styles.headerTitle}>번역 모드 (Translation)</Text>
          <Pressable style={styles.headerIcon} onPress={() => setBookmarkOpen(true)}>
            <Ionicons name="bookmarks" size={20} color="#111827" />
          </Pressable>
        </View>

        <View style={styles.avatarCard}>
          <Image
            source={{
              uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBL3I2WFW5Xq3Xbmp0Pi84_-rKAZVAhnn0iz8_HC6cIwAqU1Lq6ubMWG6YGnSqnib5maNhZCQvrrPsHwLstWwnMt7OsSgt-ssJ1KVsHorbjtmhzItLumBZCmMV6m_wBMcxE5s5xaalIa-IRKFG0PFiEtmmlDclYryEj1r_a_be8Vr0YDp6mao8UfYR_mmDUCgI9Dfiv4vkZc4g8zms8VdvuiwHBFdvKrpCSZQu6YdTYHWsRasG8CEZnxngDIFJhnhEDhiqNCsOh8A',
            }}
            contentFit="cover"
            style={styles.avatarImage}
          />
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        </View>

        <View style={styles.detectWrap}>
          <Text style={styles.detectTitle}>나 (I/Me)</Text>
          <Text style={styles.detectSub}>인식된 수어 (Detected Gesture)</Text>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.actionItem} onPress={() => setSavedVisible(true)}>
            <View style={styles.actionIconWrap}>
              <Ionicons name="bookmark-outline" size={22} color="#111827" />
            </View>
            <Text style={styles.actionLabel}>단어장에 저장</Text>
          </Pressable>
          <Pressable style={styles.actionItem}>
            <View style={styles.actionIconWrap}>
              <Ionicons name="volume-high-outline" size={22} color="#111827" />
            </View>
            <Text style={styles.actionLabel}>듣기</Text>
          </Pressable>
        </View>

        {savedVisible && <Text style={styles.savedText}>저장되었습니다</Text>}

        {!bookmarkOpen && (
          <View style={styles.inputPanel}>
            <View style={styles.inputWrap}>
              <Ionicons name="keypad-outline" size={18} color="#94a3b8" />
              <TextInput
                style={styles.input}
                placeholder="번역할 내용을 입력하세요"
                placeholderTextColor="#94a3b8"
              />
              <Pressable onPress={() => setBookmarkOpen(true)}>
                <Ionicons name="bookmarks" size={18} color={PRIMARY} />
              </Pressable>
            </View>

            <Pressable style={styles.translateButton}>
              <Ionicons name="language-outline" size={18} color="#fff" />
              <Text style={styles.translateButtonText}>번역하기 (Translate)</Text>
            </Pressable>
          </View>
        )}

        {bookmarkOpen && (
          <Animated.View style={[styles.bookmarkSheet, { transform: [{ translateY: dragY }] }]}>
            <View style={styles.handleArea} {...panResponder.panHandlers}>
              <View style={styles.handle} />
            </View>

            <ScrollView
              style={styles.sheetList}
              contentContainerStyle={styles.sheetListContent}
              showsVerticalScrollIndicator={false}>
              {BOOKMARKS.map((item) => (
                <View key={`${item.date}-${item.ko}`} style={styles.bookmarkItem}>
                  <View>
                    <Text style={styles.bookmarkDate}>{item.date}</Text>
                    <Text style={styles.bookmarkKo}>{item.ko}</Text>
                    <Text style={styles.bookmarkEn}>{item.en}</Text>
                  </View>
                  <Pressable style={styles.playButton}>
                    <Ionicons name="play" size={14} color={PRIMARY} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <View style={styles.sheetBottom}>
              <Pressable style={styles.translateButton}>
                <Ionicons name="language-outline" size={18} color="#fff" />
                <Text style={styles.translateButtonText}>번역하기 (Translate)</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} onPress={() => router.push('/home')}>
            <Ionicons name="home-outline" size={18} color="#94a3b8" />
            <Text style={styles.navText}>홈</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/learn')}>
            <Ionicons name="school-outline" size={18} color="#94a3b8" />
            <Text style={styles.navText}>학습하기</Text>
          </Pressable>
          <Pressable style={styles.navItem}>
            <Ionicons name="language" size={18} color={PRIMARY} />
            <Text style={[styles.navText, styles.navTextActive]}>통역기</Text>
          </Pressable>
          <Pressable style={styles.navItem}>
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
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
  },
  avatarCard: {
    marginTop: 6,
    height: '48%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#e5e7eb',
    position: 'relative',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  liveBadge: {
    position: 'absolute',
    right: 12,
    top: 10,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#4ade80',
  },
  liveText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  detectWrap: {
    alignItems: 'center',
    marginTop: 8,
  },
  detectTitle: {
    color: '#111827',
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  detectSub: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 14,
    fontWeight: '500',
  },
  actionRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 48,
  },
  actionItem: {
    alignItems: 'center',
    gap: 6,
  },
  actionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#eef2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  savedText: {
    marginTop: 8,
    textAlign: 'center',
    color: '#16a34a',
    fontSize: 12,
    fontWeight: '700',
  },
  inputPanel: {
    marginTop: 'auto',
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 8,
  },
  inputWrap: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    color: '#111827',
    fontSize: 14,
  },
  translateButton: {
    marginTop: 8,
    height: 50,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 3,
  },
  translateButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  bookmarkSheet: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 74,
    height: 300,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
    overflow: 'hidden',
    zIndex: 40,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
  },
  sheetList: {
    flex: 1,
  },
  sheetListContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 8,
  },
  bookmarkItem: {
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bookmarkDate: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },
  bookmarkKo: {
    marginTop: 1,
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  bookmarkEn: {
    marginTop: 1,
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
  },
  playButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBottom: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  bottomNav: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 68,
    paddingBottom: 4,
    zIndex: 20,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 58,
  },
  navText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  navTextActive: {
    color: PRIMARY,
  },
});
