import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useAuth } from '@/context/auth-context';
import { Paint, Size } from '@/constants/paint';
import {
  WrongNoteSavedItem,
  deleteSavedWrongNote,
  fetchSavedWrongNotes,
} from '@/lib/api/wrong-note-saved';
import { MeHeader } from '@/components/paint/me-parts';
import { BodyText, Mark, PaintButton, PaintIcon, PaintTabBar, PaperScreen, RoughBox, StoryText } from '@/components/paint/paint-ui';
import { EmptyState, errorKind } from '@/components/paint/empty-state';
import { PenLoader } from '@/components/paint/pen-loader';
import { usePaintNav } from '@/components/paint/transition';

export default function WrongNoteScreen() {
  const nav = usePaintNav();
  const { user } = useAuth();

  const [wrongNotes, setWrongNotes] = useState<WrongNoteSavedItem[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingQuizId, setDeletingQuizId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadWrongNotes() {
      if (!user?.id) {
        setWrongNotes([]);
        setSelectedQuizId(null);
        return;
      }

      try {
        setIsLoading(true);
        setErrorMessage(null);
        const data = await fetchSavedWrongNotes(user.id);
        if (!mounted) return;

        const list = data ?? [];
        setWrongNotes(list);
        setSelectedQuizId(list[0]?.quizId ?? null);
      } catch (error) {
        if (!mounted) return;
        setErrorMessage(error instanceof Error ? error.message : '오답노트를 불러오지 못했습니다.');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadWrongNotes();

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const selectedItem = useMemo(
    () => wrongNotes.find((item) => item.quizId === selectedQuizId) ?? wrongNotes[0] ?? null,
    [wrongNotes, selectedQuizId]
  );

  const player = useVideoPlayer(selectedItem?.videoUrl ?? null, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.play();
  });

  function handlePlay(quizId: string) {
    setSelectedQuizId(quizId);
    try {
      player.replay();
      player.play();
    } catch {
      // 영상이 아직 준비 안 됐으면 선택만 바꾼다
    }
  }

  async function handleDelete(quizId: string) {
    if (!user?.id || deletingQuizId === quizId) return;
    try {
      setDeletingQuizId(quizId);
      setErrorMessage(null);
      await deleteSavedWrongNote(user.id, quizId);
      setWrongNotes((prev) => {
        const next = prev.filter((item) => item.quizId !== quizId);
        if (selectedQuizId === quizId) {
          setSelectedQuizId(next[0]?.quizId ?? null);
        }
        return next;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '오답노트 숨기기에 실패했습니다.');
    } finally {
      setDeletingQuizId(null);
    }
  }

  function formatWrongDate(value: unknown): string {
    if (value && typeof value === 'object' && 'seconds' in value) {
      const raw = (value as { seconds?: unknown }).seconds;
      if (typeof raw === 'number') {
        return new Date(raw * 1000).toISOString().slice(0, 10).replace(/-/g, '.');
      }
    }
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10).replace(/-/g, '.');
      }
    }
    return '-';
  }

  const isEmpty = !isLoading && !errorMessage && wrongNotes.length === 0;

  return (
    <PaperScreen>
      <MeHeader
        title="오답 노트"
        sub={wrongNotes.length > 0 ? `다시 볼 단어 ${wrongNotes.length}개` : undefined}
        onBack={(p) => void nav.back(p)}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 고른 단어의 수어 영상 */}
        <Animated.View entering={FadeInDown.duration(320)}>
          <RoughBox seed={41} style={styles.hero}>
            <View style={styles.videoWrap}>
              {selectedItem?.videoUrl ? (
                <VideoView style={styles.video} player={player} nativeControls contentFit="cover" />
              ) : (
                <View style={styles.placeholder}>
                  <PaintIcon name="note" size={44} color={Paint.inkSoft} />
                </View>
              )}
            </View>
            <View style={styles.wordPanel}>
              <BodyText soft size={Size.caption}>고른 단어</BodyText>
              <Animated.View key={selectedItem?.quizId ?? 'none'} entering={FadeIn.duration(200)} style={{ alignItems: 'center' }}>
                <StoryText size={Size.display}>
                  <Mark color={Paint.wrongSoft}>{selectedItem?.word || '-'}</Mark>
                </StoryText>
                <BodyText soft size={Size.small} style={{ textAlign: 'center' }}>
                  {selectedItem?.questionText || '틀린 단어를 골라 보세요.'}
                </BodyText>
              </Animated.View>
            </View>
          </RoughBox>
        </Animated.View>

        {wrongNotes.length > 0 ? (
          <PaintButton
            label="틀린 단어 다시 풀기"
            color={Paint.coral}
            icon={<PaintIcon name="play" size={22} />}
            style={styles.retry}
            onPress={(p) => void nav.go({ pathname: '/quiz', params: { mode: 'wrong', title: '오답 복습 퀴즈' } }, p)}
          />
        ) : null}

        <StoryText size={Size.lead} style={styles.sub}>틀린 단어 목록</StoryText>

        {isLoading ? <PenLoader label="오답 노트를 펼치는 중이에요" size={84} style={{ marginTop: 24 }} /> : null}
        {!isLoading && errorMessage ? (
          <EmptyState kind={errorKind(errorMessage)} compact style={{ marginTop: 16 }} />
        ) : null}
        {isEmpty ? (
          <EmptyState
            kind="empty-note"
            compact
            style={{ marginTop: 16 }}
            actionLabel="오늘의 퀴즈 풀러 가기"
            onAction={(p) => void nav.go('/quiz', p)}
          />
        ) : null}

        <View style={styles.list}>
          {wrongNotes.map((item, index) => {
            const isSelected = (selectedItem?.quizId ?? null) === item.quizId;
            const isDeleting = deletingQuizId === item.quizId;
            return (
              <Animated.View
                key={item.quizId}
                entering={FadeInDown.delay(Math.min(index, 12) * 55).duration(280)}
                style={isDeleting && { opacity: 0.45 }}
              >
                <RoughBox
                  seed={50 + index}
                  wash={isSelected ? Paint.wrongSoft : undefined}
                  stroke={isSelected ? Paint.ink : Paint.inkSoft}
                  strokeWidth={isSelected ? 2.2 : 1.8}
                  style={styles.card}
                >
                  <Pressable
                    style={styles.cardMain}
                    onPress={() => setSelectedQuizId(item.quizId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.word || '단어'} 고르기`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <StoryText size={Size.title}>{item.word || '-'}</StoryText>
                    <BodyText soft size={Size.caption}>{formatWrongDate(item.savedAt ?? item.wrongAt)}에 틀림</BodyText>
                  </Pressable>

                  <View style={styles.actions}>
                    <Pressable
                      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
                      onPress={() => handlePlay(item.quizId)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.word || '단어'} 영상 처음부터 보기`}
                    >
                      <PaintIcon name="play" size={24} fill={isSelected ? Paint.coral : 'none'} />
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
                      onPress={() => void handleDelete(item.quizId)}
                      disabled={isDeleting}
                      accessibilityRole="button"
                      accessibilityLabel="오답노트 숨기기"
                      accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
                    >
                      <PaintIcon name="close" size={22} color={isDeleting ? Paint.inkFaint : Paint.ink} />
                    </Pressable>
                  </View>
                </RoughBox>
              </Animated.View>
            );
          })}
        </View>
      </ScrollView>

      <PaintTabBar current="mypage" />
    </PaperScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  hero: { marginTop: 6, padding: 8 },
  videoWrap: { borderRadius: 12, overflow: 'hidden' },
  video: { width: '100%', height: 240, backgroundColor: Paint.ink },
  placeholder: { width: '100%', height: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: Paint.paperDeep },
  wordPanel: { alignItems: 'center', paddingTop: 10, paddingBottom: 6, gap: 2 },
  retry: { marginTop: 16 },
  sub: { marginTop: 22, marginBottom: 10 },
  helper: { textAlign: 'center', marginVertical: 8 },
  emptyBox: { alignItems: 'center', gap: 6, paddingVertical: 22 },
  list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, minHeight: 76 },
  cardMain: { flex: 1, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
