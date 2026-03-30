import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';
import {
  deleteTranslatorBookmark,
  fetchTranslatorBookmarks,
  TranslatorBookmarkItem,
} from '@/lib/api/translator-bookmarks';

const PRIMARY = '#137fec';

export default function BookmarkScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [query, setQuery] = useState('');
  const [bookmarks, setBookmarks] = useState<TranslatorBookmarkItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadBookmarks() {
      if (!user?.id) {
        setBookmarks([]);
        return;
      }

      try {
        setIsLoading(true);
        setErrorMessage(null);
        const data = await fetchTranslatorBookmarks(user.id);
        if (!mounted) return;
        setBookmarks(data ?? []);
      } catch (error) {
        if (!mounted) return;
        setErrorMessage(error instanceof Error ? error.message : '북마크를 불러오지 못했습니다.');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadBookmarks();

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!feedbackMessage) return;
    const timer = setTimeout(() => setFeedbackMessage(null), 1400);
    return () => clearTimeout(timer);
  }, [feedbackMessage]);

  function formatSavedDate(value: unknown): string {
    if (value && typeof value === 'object' && 'seconds' in value && typeof (value as { seconds?: unknown }).seconds === 'number') {
      const date = new Date(((value as { seconds: number }).seconds ?? 0) * 1000);
      return date.toISOString().slice(0, 10).replace(/-/g, '.');
    }
    return '-';
  }

  const filteredBookmarks = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return bookmarks;

    return bookmarks.filter((item) => {
      const questionText = item.questionText?.toLowerCase?.() ?? '';
      return questionText.includes(trimmed);
    });
  }, [bookmarks, query]);

  async function handleDeleteBookmark(bookmarkId: string) {
    if (!user?.id || deletingId) return;

    try {
      setDeletingId(bookmarkId);
      setErrorMessage(null);
      await deleteTranslatorBookmark(user.id, bookmarkId);
      setBookmarks((prev) => prev.filter((item) => item.quizId !== bookmarkId));
      setFeedbackMessage('삭제되었습니다.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '북마크 삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.headerButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </Pressable>
          <Text style={styles.headerTitle}>북마크</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color="#94a3b8" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="문장 검색"
            placeholderTextColor="#9ca3af"
            style={styles.searchInput}
          />
        </View>

        <ScrollView contentContainerStyle={styles.listWrap} showsVerticalScrollIndicator={false}>
          {feedbackMessage ? <Text style={styles.feedbackText}>{feedbackMessage}</Text> : null}
          {isLoading ? <Text style={styles.wordMeaning}>불러오는 중...</Text> : null}
          {!isLoading && errorMessage ? <Text style={styles.wordMeaning}>{errorMessage}</Text> : null}
          {!isLoading && !errorMessage && filteredBookmarks.length === 0 ? (
            <Text style={styles.wordMeaning}>저장된 문장이 없습니다.</Text>
          ) : null}

          {filteredBookmarks.map((item) => (
            <View key={item.quizId} style={styles.wordCard}>
              <View style={styles.wordLeft}>
                <Text style={styles.wordDate}>{formatSavedDate(item.savedAt)}</Text>
                <Text style={styles.sentenceText}>{item.questionText || '-'}</Text>
              </View>

              <Pressable
                style={[styles.deleteBtn, deletingId === item.quizId && styles.deleteBtnDisabled]}
                onPress={() => {
                  void handleDeleteBookmark(item.quizId);
                }}
                disabled={deletingId === item.quizId}>
                <Ionicons name="trash-outline" size={17} color="#ef4444" />
              </Pressable>
            </View>
          ))}
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
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  searchWrap: {
    marginTop: 4,
    marginHorizontal: 12,
    marginBottom: 8,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eceff4',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
  },
  listWrap: {
    paddingHorizontal: 12,
    paddingBottom: 110,
    gap: 10,
  },
  feedbackText: {
    textAlign: 'center',
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '700',
  },
  wordCard: {
    minHeight: 90,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9edf3',
    paddingHorizontal: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  wordLeft: {
    flex: 1,
    paddingRight: 8,
  },
  wordDate: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
    marginBottom: 2,
  },
  sentenceText: {
    fontSize: 18,
    color: '#111827',
    fontWeight: '600',
    lineHeight: 22,
  },
  wordMeaning: {
    marginTop: 2,
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  deleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff1f2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  deleteBtnDisabled: { opacity: 0.5 },
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
