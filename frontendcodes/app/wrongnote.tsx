import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useAuth } from '@/context/auth-context';
import {
  WrongNoteSavedItem,
  deleteSavedWrongNote,
  fetchSavedWrongNotes,
} from '@/lib/api/wrong-note-saved';

const PRIMARY = '#137fec';

export default function WrongNoteScreen() {
  const router = useRouter();
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
      // Ignore player readiness errors and rely on selected item update.
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
      setErrorMessage(error instanceof Error ? error.message : '오답노트 삭제에 실패했습니다.');
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
            {selectedItem?.videoUrl ? (
              <VideoView style={styles.heroVideo} player={player} nativeControls contentFit="cover" />
            ) : (
              <View style={styles.heroImagePlaceholder}>
                <Ionicons name="bookmark" size={42} color={PRIMARY} />
              </View>
            )}

            <View style={styles.wordPanel}>
              <Text style={styles.wordLabel}>선택된 단어</Text>
              <View style={styles.wordRow}>
                <Text style={styles.wordText}>{selectedItem?.word || '-'}</Text>
                <Ionicons name="volume-high" size={16} color={PRIMARY} />
              </View>
              <Text style={styles.questionText}>{selectedItem?.questionText || '틀린 단어를 선택하세요.'}</Text>
            </View>
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>틀린 단어 목록</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{wrongNotes.length}개 복습 필요</Text>
            </View>
          </View>

          <View style={styles.listWrap}>
            {isLoading ? <Text style={styles.helperText}>불러오는 중...</Text> : null}
            {!isLoading && errorMessage ? <Text style={styles.helperText}>{errorMessage}</Text> : null}
            {!isLoading && !errorMessage && wrongNotes.length === 0 ? (
              <Text style={styles.helperText}>저장된 오답이 없습니다.</Text>
            ) : null}

            {wrongNotes.map((item) => {
              const isSelected = (selectedItem?.quizId ?? null) === item.quizId;
              return (
                <Pressable
                  key={item.quizId}
                  style={[styles.wordItem, isSelected && styles.wordItemSelected]}
                  onPress={() => setSelectedQuizId(item.quizId)}>
                  <View>
                    <Text style={styles.itemWord}>{item.word || '-'}</Text>
                    <View style={styles.dateRow}>
                      <Ionicons name="calendar-outline" size={12} color="#94a3b8" />
                      <Text style={styles.itemDate}>{formatWrongDate(item.savedAt ?? item.wrongAt)}</Text>
                    </View>
                  </View>

                  <View style={styles.actionsRow}>
                    <Pressable
                      style={styles.playBtn}
                      onPress={(e) => {
                        (e as any)?.stopPropagation?.();
                        handlePlay(item.quizId);
                      }}>
                      <Ionicons name="play" size={18} color={PRIMARY} />
                    </Pressable>
                    <Pressable
                      style={styles.deleteBtn}
                      onPress={(e) => {
                        (e as any)?.stopPropagation?.();
                        void handleDelete(item.quizId);
                      }}
                      disabled={deletingQuizId === item.quizId}>
                      <Ionicons
                        name={deletingQuizId === item.quizId ? 'time-outline' : 'trash-outline'}
                        size={18}
                        color="#ef4444"
                      />
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
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
  },
  heroImagePlaceholder: {
    width: '100%',
    height: 260,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroVideo: {
    width: '100%',
    height: 260,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  wordPanel: {
    borderTopWidth: 1,
    borderTopColor: '#cfe0f8',
    backgroundColor: '#f8fbff',
    paddingTop: 10,
    paddingBottom: 12,
    alignItems: 'center',
    paddingHorizontal: 12,
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
  questionText: {
    marginTop: 4,
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
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
  helperText: {
    textAlign: 'center',
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
    marginVertical: 8,
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
  wordItemSelected: {
    borderColor: '#93c5fd',
    backgroundColor: '#f8fbff',
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
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8f1ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fee2e2',
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
