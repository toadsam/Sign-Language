/**
 * 북마크: 통역에서 저장한 문장 모음. 표현 탭과 같은 종이 · 손그림 카드.
 * 찾기, 지우기, 불러오기 실패 안내는 예전 그대로.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { Bee } from '@/components/paint/bee';
import { LearnHeader, LearnIconButton } from '@/components/paint/learn-parts';
import { BodyText, PaintIcon, PaintTabBar, PaperScreen, RoughBox, StoryText } from '@/components/paint/paint-ui';
import { usePaintNav } from '@/components/paint/transition';
import { Font, Paint, Size } from '@/constants/paint';
import { useAuth } from '@/context/auth-context';
import {
  deleteTranslatorBookmark,
  fetchTranslatorBookmarks,
  TranslatorBookmarkItem,
} from '@/lib/api/translator-bookmarks';

export default function BookmarkScreen() {
  const nav = usePaintNav();
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

  // 지운 뒤 안내는 잠깐만 보인다
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

  const sub = user?.id ? `저장한 문장 ${bookmarks.length}개` : '로그인하면 저장한 문장이 보여요';

  return (
    <PaperScreen>
      <View style={{ flex: 1 }}>
        <Animated.View entering={FadeInDown.duration(320)}>
          <LearnHeader title="북마크" sub={sub} onBack={(p) => nav.back(p)} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(70).duration(320)} style={styles.searchOuter}>
          <RoughBox seed={91} radius={14} strokeWidth={1.8} style={styles.search}>
            <PaintIcon name="note" size={22} color={Paint.inkSoft} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="문장 검색"
              placeholderTextColor={Paint.inkFaint}
              accessibilityLabel="저장한 문장 검색"
              style={styles.searchInput}
            />
          </RoughBox>
        </Animated.View>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {feedbackMessage ? (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ alignSelf: 'center' }} accessibilityLiveRegion="polite">
              <RoughBox seed={92} radius={14} strokeWidth={1.6} wash={Paint.mint} washOpacity={0.55} style={styles.toast}>
                <PaintIcon name="check" size={18} />
                <BodyText size={Size.small}>{feedbackMessage}</BodyText>
              </RoughBox>
            </Animated.View>
          ) : null}

          {isLoading ? <BodyText soft style={styles.center}>불러오는 중...</BodyText> : null}
          {!isLoading && errorMessage ? (
            <RoughBox seed={93} wash={Paint.wrongSoft} style={styles.notice}>
              <BodyText style={styles.center} accessibilityRole="alert">{errorMessage}</BodyText>
            </RoughBox>
          ) : null}
          {!isLoading && !errorMessage && filteredBookmarks.length === 0 ? (
            <View style={styles.empty}>
              <Bee size={64} />
              <BodyText soft style={styles.center}>저장된 문장이 없습니다.</BodyText>
            </View>
          ) : null}

          {filteredBookmarks.map((item, index) => {
            const busy = deletingId === item.quizId;
            return (
              <Animated.View key={item.quizId} entering={FadeInDown.delay(Math.min(index, 12) * 55).duration(280)} style={busy ? { opacity: 0.52 } : undefined}>
                <RoughBox seed={100 + index} style={styles.card}>
                  <View style={styles.bar} pointerEvents="none">
                    <PaintIcon name="bookmark" size={22} fill={Paint.yellowSoft} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <BodyText soft size={Size.caption}>{formatSavedDate(item.savedAt)}</BodyText>
                    <StoryText size={Size.lead}>{item.questionText || '-'}</StoryText>
                  </View>
                  <LearnIconButton
                    label={busy ? '지우는 중' : `${item.questionText || '문장'} 북마크 지우기`}
                    disabled={busy}
                    onPress={() => {
                      void handleDeleteBookmark(item.quizId);
                    }}
                  >
                    {busy ? <BodyText size={Size.caption}>...</BodyText> : <PaintIcon name="close" size={20} color={Paint.ink} />}
                  </LearnIconButton>
                </RoughBox>
              </Animated.View>
            );
          })}
        </ScrollView>
      </View>
      <PaintTabBar current="learn" />
    </PaperScreen>
  );
}

const styles = StyleSheet.create({
  searchOuter: { paddingHorizontal: 20, marginTop: 10, marginBottom: 8 },
  search: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 46, fontFamily: Font.body, fontSize: Size.body, color: Paint.ink },
  list: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 28, gap: 10 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6 },
  notice: { padding: 14 },
  center: { textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  card: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 12, paddingRight: 10 },
  bar: { width: 26, alignItems: 'center' },
});
