﻿import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useAuth } from '@/context/auth-context';
import { fetchTranslatorBookmarks, saveTranslatorBookmark, TranslatorBookmarkItem } from '@/lib/api/translator-bookmarks';
import { TranslateClip, TranslatePlaybackItem, TranslateResponse, translateText } from '@/lib/api/translate';

const PRIMARY = '#2281ea';
const BOOKMARKS_KEY = 'translator.bookmarks.sentences.v2';
const MAX_BOOKMARKS = 20;

export default function TranslatorScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingDotCount, setLoadingDotCount] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarkQuery, setBookmarkQuery] = useState('');
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [playbackUrlMap, setPlaybackUrlMap] = useState<Record<string, string>>({});
  const [bookmarks, setBookmarks] = useState<TranslatorBookmarkItem[]>([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const isWeb = Platform.OS === 'web';
  const [webVideoSources, setWebVideoSources] = useState<[string | null, string | null]>([null, null]);
  const [webVideoReady, setWebVideoReady] = useState<[boolean, boolean]>([false, false]);
  const [webActiveSlot, setWebActiveSlot] = useState<0 | 1>(0);

  const clips = useMemo<TranslateClip[]>(() => result?.clips ?? [], [result]);
  const playbackItems = useMemo<TranslatePlaybackItem[]>(
    () => result?.items ?? clips.map((clip) => ({ ...clip, hasVideo: true })),
    [clips, result?.items]
  );
  const unknownTokens = useMemo<string[]>(() => result?.unknown ?? [], [result]);
  const noVideoWords = useMemo<string[]>(() => result?.noVideoWords ?? [], [result]);
  const normalizedTokens = useMemo<string[]>(() => result?.normalizedTokens ?? [], [result]);
  const filteredBookmarks = useMemo(() => {
    const q = bookmarkQuery.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter((item) => (item.questionText ?? '').toLowerCase().includes(q));
  }, [bookmarks, bookmarkQuery]);
  const currentPlaybackItem = playbackItems[currentClipIndex] ?? null;
  const currentClip = currentPlaybackItem?.hasVideo ? currentPlaybackItem : null;
  const currentClipUrl = currentClip ? playbackUrlMap[currentClip.url] ?? currentClip.url : null;

  const player = useVideoPlayer(null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.timeUpdateEventInterval = 0.25;
    // Web autoplay policy blocks programmatic play for unmuted media.
    // Sign clips do not require audio, so keep muted for seamless chaining.
    videoPlayer.muted = true;
  });
  const replaceVersionRef = useRef(0);
  const pendingAutoplayVersionRef = useRef(0);
  const clipsLengthRef = useRef(0);
  const currentClipIndexRef = useRef(0);
  const webActiveSlotRef = useRef<0 | 1>(0);
  const lastAutoAdvancedIndexRef = useRef(-1);
  const WebVideoTag = 'video' as any;
  const webVideoRefA = useRef<any>(null);
  const webVideoRefB = useRef<any>(null);
  const webPendingSlotRef = useRef<0 | 1 | null>(null);
  const webLastQueuedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    clipsLengthRef.current = playbackItems.length;
  }, [playbackItems.length]);

  useEffect(() => {
    currentClipIndexRef.current = currentClipIndex;
  }, [currentClipIndex]);

  useEffect(() => {
    webActiveSlotRef.current = webActiveSlot;
  }, [webActiveSlot]);

  const advanceClip = () => {
    if (clipsLengthRef.current <= 1) return;
    setCurrentClipIndex((prev) => Math.min(prev + 1, clipsLengthRef.current - 1));
  };

  useEventListener(player, 'sourceLoad', () => {
    const version = pendingAutoplayVersionRef.current;
    if (version <= 0 || version !== replaceVersionRef.current) {
      return;
    }

    try {
      player.currentTime = 0;
      player.play();
      pendingAutoplayVersionRef.current = 0;
    } catch {
      // ignore play race
    }
  });

  useEventListener(player, 'playToEnd', () => {
    if (isWeb) return;
    advanceClip();
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const duration = player.duration;
    if (isWeb || !duration || clipsLengthRef.current <= 1) {
      return;
    }

    if (duration - currentTime > 0.35 || lastAutoAdvancedIndexRef.current === currentClipIndexRef.current) {
      return;
    }

    lastAutoAdvancedIndexRef.current = currentClipIndexRef.current;
    advanceClip();
  });

  useEffect(() => {
    if (isWeb) {
      pendingAutoplayVersionRef.current = 0;
      return;
    }

    if (!currentClipUrl) {
      pendingAutoplayVersionRef.current = 0;
      try {
        player.pause();
      } catch {
        // ignore pause race
      }
      return;
    }

    lastAutoAdvancedIndexRef.current = -1;
    const version = ++replaceVersionRef.current;
    pendingAutoplayVersionRef.current = version;
    let cancelled = false;

    (async () => {
      try {
        await player.replaceAsync(toVideoSource(currentClipUrl));
        if (cancelled || version !== replaceVersionRef.current) {
          return;
        }
        // Fallback: some environments may not emit sourceLoad reliably.
        setTimeout(() => {
          if (cancelled || pendingAutoplayVersionRef.current !== version || version !== replaceVersionRef.current) {
            return;
          }
          try {
            player.currentTime = 0;
            player.play();
            pendingAutoplayVersionRef.current = 0;
          } catch {
            // ignore play race
          }
        }, 40);
      } catch {
        try {
          player.replace(toVideoSource(currentClipUrl), true);
          if (cancelled || version !== replaceVersionRef.current) {
            return;
          }
          setTimeout(() => {
            if (cancelled || pendingAutoplayVersionRef.current !== version || version !== replaceVersionRef.current) {
              return;
            }
            try {
              player.currentTime = 0;
              player.play();
              pendingAutoplayVersionRef.current = 0;
            } catch {
              // ignore play race
            }
          }, 40);
        } catch {
          // player replacement failure should not crash the screen
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentClipUrl, isWeb, player]);

  useEffect(() => {
    if (!isWeb) {
      return;
    }

    if (!currentClipUrl) {
      webLastQueuedTokenRef.current = null;
      return;
    }

    const token = `${currentClipIndex}:${currentClipUrl}`;
    if (webLastQueuedTokenRef.current === token) {
      return;
    }
    webLastQueuedTokenRef.current = token;

    const nextSlot: 0 | 1 = webActiveSlot === 0 ? 1 : 0;
    webPendingSlotRef.current = nextSlot;
    setWebVideoReady((prev) => {
      const next: [boolean, boolean] = [prev[0], prev[1]];
      next[nextSlot] = false;
      return next;
    });
    setWebVideoSources((prev) => {
      const next: [string | null, string | null] = [prev[0], prev[1]];
      next[nextSlot] = currentClipUrl;
      return next;
    });
  }, [isWeb, currentClipIndex, currentClipUrl, webActiveSlot]);

  useEffect(() => {
    if (!currentPlaybackItem || currentClipUrl) {
      return;
    }

    const timer = setTimeout(() => {
      if (currentClipIndexRef.current !== currentClipIndex) {
        return;
      }
      advanceClip();
    }, 4000);

    return () => clearTimeout(timer);
  }, [currentClipIndex, currentClipUrl, currentPlaybackItem]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (user?.id) {
          const stored = await fetchTranslatorBookmarks(user.id);
          if (mounted) {
            setBookmarks(stored.slice(0, MAX_BOOKMARKS));
          }
          return;
        }

        const localStored = await readBookmarks();
        if (mounted) {
          setBookmarks(localStored);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : '북마크를 불러오지 못했습니다.');
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id]);
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

  useEffect(() => {
    if (!feedbackMessage) return;
    const timer = setTimeout(() => setFeedbackMessage(null), 1600);
    return () => clearTimeout(timer);
  }, [feedbackMessage]);
  async function handleTranslate(overrideText?: string) {
    const text = (overrideText ?? inputText).trim();
    if (!text || loading) return;

    try {
      setLoading(true);
      setErrorMessage(null);
      if (overrideText) {
        setInputText(text);
      }
      const next = await translateText(text);
      if (isWeb) {
        webPendingSlotRef.current = null;
        webLastQueuedTokenRef.current = null;
        setWebVideoSources([null, null]);
        setWebVideoReady([false, false]);
        setWebActiveSlot(0);
      }
      const nextPlaybackUrlMap = buildPlaybackUrlMap((next.items ?? next.clips).map((item) => item.url));
      setPlaybackUrlMap(nextPlaybackUrlMap);
      setResult(next);
      setCurrentClipIndex(0);
      lastAutoAdvancedIndexRef.current = -1;
    } catch (error) {
      if (isWeb) {
        webPendingSlotRef.current = null;
        webLastQueuedTokenRef.current = null;
        setWebVideoSources([null, null]);
        setWebVideoReady([false, false]);
        setWebActiveSlot(0);
      }
      setResult(null);
      setPlaybackUrlMap({});
      setCurrentClipIndex(0);
      setErrorMessage(error instanceof Error ? error.message : '번역 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSentence() {
    const sentence = inputText.trim();
    if (!sentence) return;
    setErrorMessage(null);

    try {
      if (user?.id) {
        const saved = await saveTranslatorBookmark(user.id, {
          sentence,
          word: currentPlaybackItem?.word ?? '',
          videoUrl: currentPlaybackItem?.url ?? '',
        });
        const next = [saved, ...bookmarks.filter((item) => item.quizId !== saved.quizId)].slice(0, MAX_BOOKMARKS);
        setBookmarks(next);
        setFeedbackMessage('저장되었습니다!');
        return;
      }

      const fallbackItem: TranslatorBookmarkItem = {
        quizId: `local_${Date.now()}`,
        questionText: sentence,
        word: currentPlaybackItem?.word ?? '',
        videoUrl: currentPlaybackItem?.url ?? '',
        savedAt: new Date().toISOString(),
      };
      const next = [fallbackItem, ...bookmarks.filter((item) => item.questionText !== sentence)].slice(0, MAX_BOOKMARKS);
      setBookmarks(next);
      await writeBookmarks(next);
      setFeedbackMessage('저장되었습니다!');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '북마크 저장에 실패했습니다.');
    }
  }

  function handleToggleBookmarks() {
    setBookmarksOpen((prev) => {
      const next = !prev;
      if (!next) {
        setBookmarkQuery('');
      }
      setFeedbackMessage(next ? '북마크를 열었습니다.' : '북마크를 닫았습니다.');
      return next;
    });
  }

  function moveClip(step: -1 | 1) {
    if (playbackItems.length === 0) return;
    setCurrentClipIndex((prev) => {
      const next = prev + step;
      if (next < 0) return 0;
      if (next >= playbackItems.length) return playbackItems.length - 1;
      return next;
    });
  }

  function getWebVideoRef(slot: 0 | 1) {
    return slot === 0 ? webVideoRefA.current : webVideoRefB.current;
  }

  function handleWebSlotLoaded(slot: 0 | 1) {
    const videoEl = getWebVideoRef(slot);
    if (videoEl) {
      videoEl.defaultMuted = true;
      videoEl.muted = true;
      videoEl.volume = 0;
      tryPlayVideo(videoEl);
    }

    setWebVideoReady((prev) => {
      const next: [boolean, boolean] = [prev[0], prev[1]];
      next[slot] = true;
      return next;
    });
  }

  function handleWebSlotCanPlay(slot: 0 | 1) {
    const videoEl = getWebVideoRef(slot);
    if (!videoEl || !videoEl.paused) {
      return;
    }
    tryPlayVideo(videoEl);
  }

  function handleWebSlotError(slot: 0 | 1) {
    setErrorMessage('영상 재생 중 오류가 발생했습니다. 다시 시도해 주세요.');
    if (webPendingSlotRef.current === slot) {
      webPendingSlotRef.current = null;
    }
  }

  function handleWebSlotPlaying(slot: 0 | 1) {
    if (webPendingSlotRef.current !== slot) {
      return;
    }

    const previousSlot: 0 | 1 = slot === 0 ? 1 : 0;
    const previousVideo = getWebVideoRef(previousSlot);
    if (previousVideo) {
      try {
        previousVideo.pause?.();
      } catch {
        // ignore pause failure
      }
    }

    setWebActiveSlot(slot);
    webPendingSlotRef.current = null;
  }

  function handleWebSlotEnded(slot: 0 | 1) {
    if (slot !== webActiveSlotRef.current) {
      return;
    }
    advanceClip();
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
            isWeb ? (
              <View style={styles.webVideoStack}>
                <WebVideoTag
                  ref={webVideoRefA}
                  src={webVideoSources[0] || undefined}
                  muted
                  autoPlay
                  playsInline
                  controls={webActiveSlot === 0}
                  preload="auto"
                  onLoadedData={() => handleWebSlotLoaded(0)}
                  onCanPlay={() => handleWebSlotCanPlay(0)}
                  onPlaying={() => handleWebSlotPlaying(0)}
                  onError={() => handleWebSlotError(0)}
                  onEnded={() => handleWebSlotEnded(0)}
                  style={getWebVideoStyle(0, webActiveSlot, webVideoReady)}
                />
                <WebVideoTag
                  ref={webVideoRefB}
                  src={webVideoSources[1] || undefined}
                  muted
                  autoPlay
                  playsInline
                  controls={webActiveSlot === 1}
                  preload="auto"
                  onLoadedData={() => handleWebSlotLoaded(1)}
                  onCanPlay={() => handleWebSlotCanPlay(1)}
                  onPlaying={() => handleWebSlotPlaying(1)}
                  onError={() => handleWebSlotError(1)}
                  onEnded={() => handleWebSlotEnded(1)}
                  style={getWebVideoStyle(1, webActiveSlot, webVideoReady)}
                />
              </View>
            ) : (
              <VideoView style={styles.avatarVideo} player={player} nativeControls contentFit="cover" useExoShutter={false} />
            )
          ) : currentPlaybackItem ? (
            <View style={styles.textAvatar}>
              <Text style={styles.textAvatarWord} adjustsFontSizeToFit numberOfLines={1}>
                {currentPlaybackItem.word}
              </Text>
            </View>
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
          <Text style={styles.detectTitle}>{currentPlaybackItem?.word ?? '나 (I/Me)'}</Text>
          <Text style={styles.detectSub}>
            {playbackItems.length > 0 ? `${currentClipIndex + 1} / ${playbackItems.length}` : '0 / 0'} 인식된 수어 (Detected Gesture)
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
              style={[styles.actionIconWrap, bookmarksOpen && styles.actionIconWrapActive]}
              onPress={handleToggleBookmarks}
              accessibilityLabel="북마크 보기">
              <Ionicons name="bookmarks-outline" size={16} color={bookmarksOpen ? PRIMARY : '#111827'} />
            </Pressable>
            <Text style={styles.actionLabel}>북마크</Text>
          </View>
        </View>

        {feedbackMessage ? <Text style={styles.feedbackText}>{feedbackMessage}</Text> : null}
        {bookmarksOpen && (
          <View style={styles.bookmarkSheet}>
            <View style={styles.bookmarkSheetHeader}>
              <Text style={styles.bookmarkTitle}>내 북마크 문장</Text>
              <Pressable style={styles.bookmarkCloseBtn} onPress={handleToggleBookmarks}>
                <Ionicons name="close" size={16} color="#64748b" />
              </Pressable>
            </View>
            <View style={styles.bookmarkSearchWrap}>
              <Ionicons name="search" size={16} color="#94a3b8" />
              <TextInput
                value={bookmarkQuery}
                onChangeText={setBookmarkQuery}
                placeholder="문장 검색"
                placeholderTextColor="#94a3b8"
                style={styles.bookmarkSearchInput}
              />
            </View>
            <ScrollView style={styles.bookmarkList} contentContainerStyle={styles.bookmarkListContent} showsVerticalScrollIndicator={false}>
              {filteredBookmarks.length === 0 ? (
                <Text style={styles.bookmarkEmpty}>저장된 문장이 없습니다.</Text>
              ) : (
                filteredBookmarks.map((item) => (
                  <View key={item.quizId} style={styles.bookmarkItemRow}>
                    <Text style={styles.bookmarkItemText} numberOfLines={2}>
                      {item.questionText || '-'}
                    </Text>
                    <Pressable
                      style={styles.bookmarkPlayButton}
                      onPress={() => {
                        void handleTranslate(item.questionText);
                        setBookmarksOpen(false);
                        setBookmarkQuery('');
                        setFeedbackMessage('북마크 문장을 재생합니다.');
                      }}>
                      <Ionicons name="play" size={14} color={PRIMARY} />
                    </Pressable>
                  </View>
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
              style={[styles.smallControlButton, currentClipIndex >= playbackItems.length - 1 && styles.smallControlButtonDisabled]}
              onPress={() => moveClip(1)}
              disabled={currentClipIndex >= playbackItems.length - 1}>
              <Ionicons name="play-forward" size={14} color="#334155" />
            </Pressable>
          </View>

          <Pressable style={[styles.translateButton, loading && styles.translateButtonDisabled]} onPress={() => void handleTranslate()} disabled={loading}>
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
              <View style={styles.resultCard}>
                <Text style={styles.resultTitle}>영상이 없는 단어</Text>
                <Text style={styles.resultSubTitle}>사전에는 있지만 수어 영상이 준비되지 않은 단어입니다.</Text>
                <View style={styles.tokenWrap}>
                  {noVideoWords.length === 0 ? (
                    <Text style={styles.emptyText}>없음</Text>
                  ) : (
                    noVideoWords.map((token, index) => (
                      <View key={`${token}-${index}`} style={styles.noVideoChip}>
                        <Ionicons name="videocam-off-outline" size={12} color="#b45309" />
                        <Text style={styles.noVideoChipText}>{token}</Text>
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

function buildPlaybackUrlMap(sourceUrls: string[]): Record<string, string> {
  const uniqueUrls = Array.from(new Set(sourceUrls.filter((url) => !!url)));
  return Object.fromEntries(uniqueUrls.map((url) => [url, url]));
}

function toVideoSource(uri: string): { uri: string; useCaching?: boolean } {
  const trimmed = uri.trim();
  if (trimmed.startsWith('file://')) {
    return { uri: trimmed };
  }
  return { uri: trimmed, useCaching: true };
}

function getWebVideoStyle(
  slot: 0 | 1,
  activeSlot: 0 | 1,
  ready: [boolean, boolean]
) {
  const visible = slot === activeSlot && ready[slot];
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    backgroundColor: '#e5e7eb',
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
  } as any;
}

function tryPlayVideo(videoEl: any) {
  try {
    const promise = videoEl.play?.();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        // ignore autoplay race; user can still tap play manually.
      });
    }
  } catch {
    // ignore autoplay race
  }
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
  webVideoStack: { width: '100%', height: '100%', position: 'relative', backgroundColor: '#e5e7eb' },
  textAvatar: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 28,
  },
  textAvatarWord: {
    width: '100%',
    color: '#0f172a',
    fontSize: 54,
    fontWeight: '900',
    textAlign: 'center',
  },
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
  actionIconWrapActive: {
    backgroundColor: '#e8f1ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  actionLabel: { color: '#64748b', fontSize: 11, fontWeight: '600' },
  feedbackText: { marginTop: 2, textAlign: 'center', color: '#1d4ed8', fontSize: 12, fontWeight: '700' },
  bookmarkSheet: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 74,
    height: 290,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    zIndex: 35,
  },
  bookmarkSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bookmarkTitle: { color: '#334155', fontSize: 15, fontWeight: '900' },
  bookmarkCloseBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkSearchWrap: {
    marginTop: 8,
    marginBottom: 8,
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bookmarkSearchInput: { flex: 1, color: '#0f172a', fontSize: 13, paddingVertical: 7 },
  bookmarkList: { flex: 1 },
  bookmarkListContent: { gap: 8, paddingBottom: 4 },
  bookmarkItemRow: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bookmarkItemText: { flex: 1, color: '#0f172a', fontSize: 12, fontWeight: '600' },
  bookmarkPlayButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkEmpty: { color: '#94a3b8', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 12 },
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
  noVideoChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  noVideoChipText: { color: '#b45309', fontSize: 11, fontWeight: '700' },
  resultSubTitle: { color: '#94a3b8', fontSize: 10, fontWeight: '500' },
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

async function readBookmarks(): Promise<TranslatorBookmarkItem[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = window.localStorage.getItem(BOOKMARKS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isTranslatorBookmarkItem) : [];
    }
    const raw = await SecureStore.getItemAsync(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTranslatorBookmarkItem) : [];
  } catch {
    return [];
  }
}

async function writeBookmarks(bookmarks: TranslatorBookmarkItem[]): Promise<void> {
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

function isTranslatorBookmarkItem(value: unknown): value is TranslatorBookmarkItem {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<TranslatorBookmarkItem>;
  return (
    typeof item.quizId === 'string'
    && typeof item.questionText === 'string'
    && typeof item.word === 'string'
    && typeof item.videoUrl === 'string'
  );
}

