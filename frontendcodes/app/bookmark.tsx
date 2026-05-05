import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  const searchReveal = useRef(new Animated.Value(0)).current;
  const listRevealAnims = useRef(Array.from({ length: 40 }, () => new Animated.Value(0))).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const feedbackTranslateY = useRef(new Animated.Value(8)).current;
  const deleteSpin = useRef(new Animated.Value(0)).current;
  const emptyPulse = useRef(new Animated.Value(1)).current;
  const topStretch = useRef(new Animated.Value(0)).current;
  const topStretchValueRef = useRef(0);
  const isTopStretchingRef = useRef(false);
  const bottomStretch = useRef(new Animated.Value(0)).current;
  const bottomStretchValueRef = useRef(0);
  const isBottomStretchingRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollMetricsRef = useRef({ contentHeight: 0, viewportHeight: 0, offsetY: 0 });
  const stretchTouchStartYRef = useRef<number | null>(null);
  const wheelReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteRotation = deleteSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const topStretchHeight = topStretch.interpolate({
    inputRange: [0, 220],
    outputRange: [0, 220],
    extrapolate: 'clamp',
  });
  const bottomStretchHeight = bottomStretch.interpolate({
    inputRange: [0, 220],
    outputRange: [0, 220],
    extrapolate: 'clamp',
  });

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
    Animated.spring(searchReveal, {
      toValue: 1,
      tension: 115,
      friction: 11,
      useNativeDriver: false,
    }).start();
  }, [searchReveal]);

  useEffect(() => {
    if (!feedbackMessage) return;
    feedbackOpacity.setValue(0);
    feedbackTranslateY.setValue(8);
    Animated.parallel([
      Animated.timing(feedbackOpacity, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.spring(feedbackTranslateY, {
        toValue: 0,
        tension: 130,
        friction: 10,
        useNativeDriver: false,
      }),
    ]).start();
    const timer = setTimeout(() => setFeedbackMessage(null), 1400);
    return () => clearTimeout(timer);
  }, [feedbackMessage, feedbackOpacity, feedbackTranslateY]);

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

  useEffect(() => {
    listRevealAnims.forEach((anim) => anim.setValue(0));
    Animated.stagger(
      55,
      filteredBookmarks.slice(0, listRevealAnims.length).map((_, index) =>
        Animated.timing(listRevealAnims[index], {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        })
      )
    ).start();
  }, [filteredBookmarks, listRevealAnims]);

  useEffect(() => {
    if (!deletingId) {
      deleteSpin.stopAnimation();
      deleteSpin.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(deleteSpin, {
        toValue: 1,
        duration: 780,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [deleteSpin, deletingId]);

  useEffect(() => {
    if (isLoading || filteredBookmarks.length > 0) {
      emptyPulse.stopAnimation();
      emptyPulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(emptyPulse, {
          toValue: 1.08,
          duration: 760,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(emptyPulse, {
          toValue: 1,
          duration: 760,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [emptyPulse, filteredBookmarks.length, isLoading]);

  function listItemAppearStyle(index: number) {
    const anim = listRevealAnims[index] ?? listRevealAnims[listRevealAnims.length - 1];
    return {
      opacity: anim,
      transform: [
        {
          translateY: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [10, 0],
          }),
        },
      ],
    };
  }

  function handleScrollStretch(event: any) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollMetricsRef.current = {
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
      offsetY: contentOffset.y,
    };
    if (isTopStretchingRef.current || isBottomStretchingRef.current) {
      return;
    }
    setTopStretchValue(Math.min(Math.max(0, -contentOffset.y), 220));
    const overscroll = Math.max(0, contentOffset.y + layoutMeasurement.height - contentSize.height);
    setBottomStretchValue(Math.min(overscroll, 220));
  }

  function setTopStretchValue(value: number) {
    const next = Math.max(0, Math.min(value, 220));
    topStretchValueRef.current = next;
    topStretch.setValue(next);
  }

  function setBottomStretchValue(value: number) {
    const next = Math.max(0, Math.min(value, 220));
    bottomStretchValueRef.current = next;
    bottomStretch.setValue(next);
  }

  function scrollToStretchEnd() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
  }

  function isScrollAtBottom() {
    const { contentHeight, viewportHeight, offsetY } = scrollMetricsRef.current;
    return contentHeight <= viewportHeight || offsetY + viewportHeight >= contentHeight - 2;
  }

  function isScrollAtTop() {
    return scrollMetricsRef.current.offsetY <= 2;
  }

  function handleStretchTouchStart(event: any) {
    stretchTouchStartYRef.current = event.nativeEvent.pageY ?? null;
  }

  function handleStretchTouchMove(event: any) {
    if (stretchTouchStartYRef.current == null) return;
    const currentY = event.nativeEvent.pageY ?? stretchTouchStartYRef.current;
    const topPullDistance = Math.max(0, currentY - stretchTouchStartYRef.current);
    if (isScrollAtTop() && topPullDistance > 0) {
      isTopStretchingRef.current = true;
      setTopStretchValue(topPullDistance * 0.95);
      return;
    }
    const bottomPullDistance = Math.max(0, stretchTouchStartYRef.current - currentY);
    if (isScrollAtBottom() && bottomPullDistance > 0) {
      isBottomStretchingRef.current = true;
      setBottomStretchValue(bottomPullDistance * 0.95);
      scrollToStretchEnd();
    }
  }

  function handleStretchWheel(event: any) {
    const deltaY = event.nativeEvent?.deltaY ?? event.deltaY ?? 0;
    if (deltaY < 0 && isScrollAtTop()) {
      isTopStretchingRef.current = true;
      setTopStretchValue(topStretchValueRef.current + Math.abs(deltaY) * 0.62);
    } else if (deltaY > 0 && isScrollAtBottom()) {
      isBottomStretchingRef.current = true;
      setBottomStretchValue(bottomStretchValueRef.current + deltaY * 0.62);
      scrollToStretchEnd();
    } else {
      return;
    }
    if (wheelReleaseTimerRef.current) {
      clearTimeout(wheelReleaseTimerRef.current);
    }
    wheelReleaseTimerRef.current = setTimeout(releaseScrollStretch, 120);
  }

  function releaseScrollStretch() {
    topStretchValueRef.current = 0;
    bottomStretchValueRef.current = 0;
    Animated.parallel([
      Animated.spring(topStretch, {
        toValue: 0,
        tension: 120,
        friction: 12,
        useNativeDriver: false,
      }),
      Animated.spring(bottomStretch, {
        toValue: 0,
        tension: 120,
        friction: 12,
        useNativeDriver: false,
      }),
    ]).start(() => {
      isTopStretchingRef.current = false;
      isBottomStretchingRef.current = false;
    });
  }

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

        <Animated.View
          style={[
            styles.searchWrap,
            {
              opacity: searchReveal,
              transform: [
                {
                  translateY: searchReveal.interpolate({
                    inputRange: [0, 1],
                    outputRange: [12, 0],
                  }),
                },
              ],
            },
          ]}>
          <Ionicons name="search" size={18} color="#94a3b8" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="문장 검색"
            placeholderTextColor="#9ca3af"
            style={styles.searchInput}
          />
        </Animated.View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.listWrap}
          showsVerticalScrollIndicator={false}
          onScroll={handleScrollStretch}
          onTouchStart={handleStretchTouchStart}
          onTouchMove={handleStretchTouchMove}
          onTouchEnd={releaseScrollStretch}
          {...({ onWheel: handleStretchWheel } as any)}
          onScrollEndDrag={releaseScrollStretch}
          onMomentumScrollEnd={releaseScrollStretch}
          scrollEventThrottle={16}>
          <Animated.View pointerEvents="none" style={[styles.bottomStretch, styles.topStretch, { height: topStretchHeight }]}>
            <View style={styles.topStretchHandle} />
          </Animated.View>
          {feedbackMessage ? (
            <Animated.View
              style={[
                styles.feedbackToast,
                {
                  opacity: feedbackOpacity,
                  transform: [{ translateY: feedbackTranslateY }],
                },
              ]}>
              <Ionicons name="checkmark-circle" size={14} color="#1d4ed8" />
              <Text style={styles.feedbackText}>{feedbackMessage}</Text>
            </Animated.View>
          ) : null}
          {isLoading ? <Text style={styles.wordMeaning}>불러오는 중...</Text> : null}
          {!isLoading && errorMessage ? <Text style={styles.wordMeaning}>{errorMessage}</Text> : null}
          {!isLoading && !errorMessage && filteredBookmarks.length === 0 ? (
            <Animated.View style={[styles.emptyState, { transform: [{ scale: emptyPulse }] }]}>
              <Ionicons name="bookmark-outline" size={28} color="#94a3b8" />
              <Text style={styles.wordMeaning}>저장된 문장이 없습니다.</Text>
            </Animated.View>
          ) : null}

          {filteredBookmarks.map((item, index) => (
            <Animated.View
              key={item.quizId}
              style={[
                styles.wordCard,
                listItemAppearStyle(index),
                deletingId === item.quizId && styles.wordCardDeleting,
              ]}>
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
                <Animated.View style={deletingId === item.quizId ? { transform: [{ rotate: deleteRotation }] } : undefined}>
                  <Ionicons name={deletingId === item.quizId ? 'sync' : 'trash-outline'} size={17} color="#ef4444" />
                </Animated.View>
              </Pressable>
            </Animated.View>
          ))}
          <Animated.View pointerEvents="none" style={[styles.bottomStretch, { height: bottomStretchHeight }]}>
            <View style={styles.bottomStretchHandle} />
          </Animated.View>
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
  feedbackToast: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
  wordCardDeleting: {
    opacity: 0.52,
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
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    gap: 6,
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
  bottomStretch: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  topStretch: {
    justifyContent: 'flex-start',
  },
  topStretchHandle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    opacity: 0.7,
    marginTop: 10,
  },
  bottomStretchHandle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    opacity: 0.7,
    marginBottom: 10,
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
