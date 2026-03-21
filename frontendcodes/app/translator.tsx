import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import { TranslateClip, TranslateResponse, translateText } from '@/lib/api/translate';

const PRIMARY = '#2281ea';
const BOOKMARKS_KEY = 'translator.bookmarks.sentences.v1';
const MAX_BOOKMARKS = 20;

export default function TranslatorScreen() {
  const router = useRouter();
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingDotCount, setLoadingDotCount] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);

  const clips = useMemo<TranslateClip[]>(() => result?.clips ?? [], [result]);
  const unknownTokens = useMemo<string[]>(() => result?.unknown ?? [], [result]);
  const normalizedTokens = useMemo<string[]>(() => result?.normalizedTokens ?? [], [result]);
  const currentClip = clips[currentClipIndex] ?? null;
  const currentClipUrl = currentClip?.url ?? null;

  const player = useVideoPlayer(currentClipUrl, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.play();
  });

  useEventListener(player, 'playToEnd', () => {
    if (clips.length <= 1) return;
    setCurrentClipIndex((prev) => Math.min(prev + 1, clips.length - 1));
  });

  useEffect(() => {
    if (!currentClip) return;
    try {
      player.replay();
      player.play();
    } catch {
      // player readiness race
    }
  }, [currentClip, player]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const stored = await readBookmarks();
      if (mounted) setBookmarks(stored);
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!loading) {
      setLoadingDotCount(1);
      return;
    }

    const timer = setInterval(() => {
      setLoadingDotCount((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 350);

    return () => clearInterval(timer);
  }, [loading]);
  async function handleTranslate() {
    const text = inputText.trim();
    if (!text || loading) return;

    try {
      setLoading(true);
      setErrorMessage(null);
      const next = await translateText(text);
      setResult(next);
      setCurrentClipIndex(0);
    } catch (error) {
      setResult(null);
      setCurrentClipIndex(0);
      setErrorMessage(error instanceof Error ? error.message : '번역 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSentence() {
    const sentence = inputText.trim();
    if (!sentence) return;

    const next = [sentence, ...bookmarks.filter((item) => item !== sentence)].slice(0, MAX_BOOKMARKS);
    setBookmarks(next);
    await writeBookmarks(next);
  }

  function moveClip(step: -1 | 1) {
    if (clips.length === 0) return;
    setCurrentClipIndex((prev) => {
      const next = prev + step;
      if (next < 0) return 0;
      if (next >= clips.length) return clips.length - 1;
      return next;
    });
  }

  function replayCurrentClip() {
    if (!currentClip) return;
    try {
      player.replay();
      player.play();
    } catch {
      // noop
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.headerIcon} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </Pressable>
          <Text style={styles.headerTitle}>번역 모드 (Translation)</Text>
          <View style={styles.headerIcon} />
        </View>

        <View style={styles.avatarCard}>
          {currentClipUrl ? (
            <VideoView style={styles.avatarVideo} player={player} nativeControls contentFit="cover" />
          ) : (
            <View style={styles.emptyAvatar}>
              <Ionicons name="chatbubble-ellipses-outline" size={30} color="#94a3b8" />
              <Text style={styles.emptyAvatarText}>문장을 입력하면 아바타가 표시됩니다</Text>
            </View>
          )}
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        </View>

        <View style={styles.detectWrap}>
          <Text style={styles.detectTitle}>{currentClip?.word ?? '나 (I/Me)'}</Text>
          <Text style={styles.detectSub}>
            {clips.length > 0 ? `${currentClipIndex + 1} / ${clips.length}` : '0 / 0'} 인식된 수어 (Detected Gesture)
          </Text>
        </View>

        <View style={styles.actionRow}>
          <View style={styles.actionItem}>
            <Pressable style={styles.actionIconWrap} onPress={handleSaveSentence} accessibilityLabel="현재 문장 저장">
              <Ionicons name="bookmark" size={16} color="#111827" />
            </Pressable>
            <Text style={styles.actionLabel}>저장</Text>
          </View>
          <View style={styles.actionItem}>
            <Pressable
              style={styles.actionIconWrap}
              onPress={() => setBookmarksOpen((prev) => !prev)}
              accessibilityLabel="북마크 보기">
              <Ionicons name="bookmarks-outline" size={16} color="#111827" />
            </Pressable>
            <Text style={styles.actionLabel}>북마크</Text>
          </View>
        </View>

        {bookmarksOpen && (
          <View style={styles.bookmarkPanel}>
            <Text style={styles.bookmarkTitle}>내 북마크 문장</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bookmarkList}>
              {bookmarks.length === 0 ? (
                <Text style={styles.bookmarkEmpty}>저장된 문장이 없습니다.</Text>
              ) : (
                bookmarks.map((sentence, index) => (
                  <Pressable key={`${sentence}-${index}`} style={styles.bookmarkChip} onPress={() => setInputText(sentence)}>
                    <Text style={styles.bookmarkChipText} numberOfLines={1}>
                      {sentence}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        )}

        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        <View style={styles.inputPanel}>
          <View style={styles.inputWrap}>
            <Ionicons name="keypad-outline" size={18} color="#94a3b8" />
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="번역할 내용을 입력하세요"
              placeholderTextColor="#94a3b8"
              multiline
            />
          </View>

          <View style={styles.clipControlRow}>
            <Pressable
              style={[styles.smallControlButton, currentClipIndex <= 0 && styles.smallControlButtonDisabled]}
              onPress={() => moveClip(-1)}
              disabled={currentClipIndex <= 0}>
              <Ionicons name="play-back" size={14} color="#334155" />
            </Pressable>
            <Pressable
              style={[styles.smallControlButton, currentClipIndex >= clips.length - 1 && styles.smallControlButtonDisabled]}
              onPress={() => moveClip(1)}
              disabled={currentClipIndex >= clips.length - 1}>
              <Ionicons name="play-forward" size={14} color="#334155" />
            </Pressable>
          </View>

          <Pressable style={[styles.translateButton, loading && styles.translateButtonDisabled]} onPress={handleTranslate} disabled={loading}>
            <Ionicons name="language-outline" size={18} color="#fff" />
            <Text style={styles.translateButtonText}>
              {loading ? `번역중${'.'.repeat(loadingDotCount)}` : '번역하기 (Translate)'}
            </Text>
          </Pressable>

          <Pressable style={styles.detailButton} onPress={() => setResultOpen(true)}>
            <Ionicons name="list-outline" size={16} color={PRIMARY} />
            <Text style={styles.detailButtonText}>세부 결과</Text>
          </Pressable>
        </View>

        {resultOpen && (
          <View style={styles.resultSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>번역 결과</Text>
              <Pressable onPress={() => setResultOpen(false)}>
                <Ionicons name="close" size={18} color="#64748b" />
              </Pressable>
            </View>
            <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetBodyContent} showsVerticalScrollIndicator={false}>
              <View style={styles.resultCard}>
                <Text style={styles.resultTitle}>수어용 변환 문장</Text>
                <Text style={styles.resultValue}>{result?.simplifiedSentence || '-'}</Text>
              </View>
              <View style={styles.resultCard}>
                <Text style={styles.resultTitle}>매칭된 토큰</Text>
                <View style={styles.tokenWrap}>
                  {normalizedTokens.length === 0 ? (
                    <Text style={styles.emptyText}>-</Text>
                  ) : (
                    normalizedTokens.map((token, index) => (
                      <View key={`${token}-${index}`} style={styles.tokenChip}>
                        <Text style={styles.tokenChipText}>{token}</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
              <View style={styles.resultCard}>
                <Text style={styles.resultTitle}>사전에 없는 토큰</Text>
                <View style={styles.tokenWrap}>
                  {unknownTokens.length === 0 ? (
                    <Text style={styles.emptyText}>없음</Text>
                  ) : (
                    unknownTokens.map((token, index) => (
                      <View key={`${token}-${index}`} style={styles.unknownChip}>
                        <Text style={styles.unknownChipText}>{token}</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
            </ScrollView>
          </View>
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
  safeArea: { flex: 1, backgroundColor: '#f5f7fb' },
  root: { flex: 1, backgroundColor: '#f5f7fb', paddingHorizontal: 8, paddingTop: 4 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: '#111827', fontSize: 20, fontWeight: '800' },
  avatarCard: {
    marginTop: 6,
    height: '39%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#e5e7eb',
    position: 'relative',
  },
  avatarVideo: { width: '100%', height: '100%', backgroundColor: '#000' },
  emptyAvatar: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef2f7', gap: 8, paddingHorizontal: 14 },
  emptyAvatarText: { color: '#64748b', fontSize: 13, fontWeight: '700', textAlign: 'center' },
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
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ade80' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  detectWrap: { alignItems: 'center', marginTop: 8 },
  detectTitle: { color: '#111827', fontSize: 34, fontWeight: '800', letterSpacing: -0.3 },
  detectSub: { marginTop: 2, color: '#64748b', fontSize: 13, fontWeight: '500' },
  actionRow: { marginTop: 28, marginBottom: 6, flexDirection: 'row', justifyContent: 'center', gap: 52 },
  actionItem: { alignItems: 'center', gap: 6 },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eef2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { color: '#64748b', fontSize: 11, fontWeight: '600' },
  bookmarkPanel: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe4f3',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  bookmarkTitle: { color: '#334155', fontSize: 12, fontWeight: '800' },
  bookmarkList: { gap: 8, minHeight: 30, alignItems: 'center' },
  bookmarkChip: {
    maxWidth: 250,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dbe4f3',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bookmarkChipText: { color: '#0f172a', fontSize: 12, fontWeight: '600' },
  bookmarkEmpty: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  errorText: { marginTop: 6, textAlign: 'center', color: '#b91c1c', fontSize: 12, fontWeight: '700' },
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
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: { flex: 1, color: '#111827', fontSize: 14, paddingVertical: 10 },
  clipControlRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  smallControlButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#dbe4f3',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  smallControlButtonDisabled: { opacity: 0.45 },
  translateButton: {
    marginTop: 8,
    height: 50,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  translateButtonDisabled: { opacity: 0.6 },
  translateButtonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  detailButton: {
    marginTop: 8,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailButtonText: { color: PRIMARY, fontSize: 14, fontWeight: '800' },
  resultSheet: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 74,
    height: 320,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
    zIndex: 40,
    overflow: 'hidden',
  },
  sheetHeader: {
    height: 42,
    borderBottomWidth: 1,
    borderBottomColor: '#edf1f6',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { color: '#111827', fontSize: 14, fontWeight: '800' },
  sheetBody: { flex: 1 },
  sheetBodyContent: { padding: 10, gap: 8 },
  resultCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6edf8',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  resultTitle: { color: '#334155', fontSize: 12, fontWeight: '800' },
  resultValue: { color: '#0f172a', fontSize: 14, fontWeight: '600' },
  tokenWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tokenChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tokenChipText: { color: '#1d4ed8', fontSize: 11, fontWeight: '700' },
  unknownChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  unknownChipText: { color: '#b91c1c', fontSize: 11, fontWeight: '700' },
  emptyText: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
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
  navItem: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 58 },
  navText: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
  navTextActive: { color: PRIMARY },
});

async function readBookmarks(): Promise<string[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = window.localStorage.getItem(BOOKMARKS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    }
    const raw = await SecureStore.getItemAsync(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function writeBookmarks(bookmarks: string[]): Promise<void> {
  const serialized = JSON.stringify(bookmarks);
  try {
    if (Platform.OS === 'web') {
      window.localStorage.setItem(BOOKMARKS_KEY, serialized);
      return;
    }
    await SecureStore.setItemAsync(BOOKMARKS_KEY, serialized);
  } catch {
    // ignore storage failures
  }
}

