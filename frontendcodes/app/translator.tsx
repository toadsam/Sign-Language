﻿import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useAuth } from '@/context/auth-context';
import { Fonts } from '@/constants/theme';
import { fetchTranslatorBookmarks, saveTranslatorBookmark, TranslatorBookmarkItem } from '@/lib/api/translator-bookmarks';
import { TranslateClip, TranslatePlaybackItem, TranslateResponse, translateText } from '@/lib/api/translate';

const PRIMARY = '#1f80e3';
const ACCENT = '#7c6cf2';
const FONT = Fonts.rounded;
const BOOKMARKS_KEY = 'translator.bookmarks.sentences.v2';
const MAX_BOOKMARKS = 20;
const PRELOAD_NEXT_SECONDS = 1.1;
const SWITCH_READY_SECONDS = 0.18;

export default function TranslatorScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
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
  const [webActiveSlot, setWebActiveSlot] = useState<0 | 1>(0);
  const [webVideoSources, setWebVideoSources] = useState<[string | null, string | null]>([null, null]);
  const [webVideoReady, setWebVideoReady] = useState<[boolean, boolean]>([false, false]);
  const [nativeActiveSlot, setNativeActiveSlot] = useState<0 | 1>(0);
  const [nativeVideoReady, setNativeVideoReady] = useState<[boolean, boolean]>([false, false]);
  const [transitionPreviousSlot, setTransitionPreviousSlot] = useState<0 | 1 | null>(null);

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
  const progressFraction = playbackItems.length > 0 ? (currentClipIndex + 1) / playbackItems.length : 0;

  const nativePlayerA = useVideoPlayer(null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.timeUpdateEventInterval = 0.08;
    // Web autoplay policy blocks programmatic play for unmuted media.
    // Sign clips do not require audio, so keep muted for seamless chaining.
    videoPlayer.muted = true;
  });
  const nativePlayerB = useVideoPlayer(null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.timeUpdateEventInterval = 0.08;
    videoPlayer.muted = true;
  });
  const replaceVersionRef = useRef(0);
  const pendingAutoplayVersionRef = useRef(0);
  const clipsLengthRef = useRef(0);
  const currentClipIndexRef = useRef(0);
  const webActiveSlotRef = useRef<0 | 1>(0);
  const nativeActiveSlotRef = useRef<0 | 1>(0);
  const lastAutoAdvancedIndexRef = useRef(-1);
  const WebVideoTag = 'video' as any;
  const webVideoRefA = useRef<any>(null);
  const webVideoRefB = useRef<any>(null);
  const webPendingSlotRef = useRef<0 | 1 | null>(null);
  const webLastQueuedTokenRef = useRef<string | null>(null);
  const webPreloadVideoRef = useRef<any>(null);
  const nativeSlotSourcesRef = useRef<[string | null, string | null]>([null, null]);
  const nativePreparedIndexRef = useRef<number | null>(null);
  const nativeReplacingTokenRef = useRef<[string | null, string | null]>([null, null]);
  const avatarOpacity = useRef(new Animated.Value(1)).current;
  const avatarScale = useRef(new Animated.Value(1)).current;
  const wordOpacity = useRef(new Animated.Value(1)).current;
  const wordTranslateY = useRef(new Animated.Value(0)).current;
  const wordTranslateX = useRef(new Animated.Value(0)).current;
  const translateButtonScale = useRef(new Animated.Value(1)).current;
  const loadingSpin = useRef(new Animated.Value(0)).current;
  const progressFill = useRef(new Animated.Value(0)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const feedbackTranslateY = useRef(new Animated.Value(8)).current;
  const bookmarkSheetAnim = useRef(new Animated.Value(0)).current;
  const resultSheetAnim = useRef(new Animated.Value(0)).current;
  const saveButtonScale = useRef(new Animated.Value(1)).current;
  const videoSlideAnim = useRef(new Animated.Value(1)).current;
  const avatarAnimationKey = `${currentClipIndex}:${currentPlaybackItem?.word ?? ''}:${currentClipUrl ?? 'text'}`;
  const avatarSlideWidth = Math.max(screenWidth - 16, 1);
  const spinRotation = loadingSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const progressWidth = progressFill.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const bookmarkSheetStyle = {
    opacity: bookmarkSheetAnim,
    transform: [
      {
        translateY: bookmarkSheetAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [24, 0],
        }),
      },
    ],
  };
  const resultSheetStyle = {
    opacity: resultSheetAnim,
    transform: [
      {
        translateY: resultSheetAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [28, 0],
        }),
      },
    ],
  };

  useEffect(() => {
    clipsLengthRef.current = playbackItems.length;
  }, [playbackItems.length]);

  useEffect(() => {
    currentClipIndexRef.current = currentClipIndex;
  }, [currentClipIndex]);

  useEffect(() => {
    webActiveSlotRef.current = webActiveSlot;
  }, [webActiveSlot]);

  useEffect(() => {
    nativeActiveSlotRef.current = nativeActiveSlot;
  }, [nativeActiveSlot]);

  const advanceClip = () => {
    if (clipsLengthRef.current <= 1) return;
    setCurrentClipIndex((prev) => Math.min(prev + 1, clipsLengthRef.current - 1));
  };

  function getNativePlayer(slot: 0 | 1) {
    return slot === 0 ? nativePlayerA : nativePlayerB;
  }

  function getPlaybackUrlAt(index: number) {
    const item = playbackItems[index];
    if (!item?.hasVideo) {
      return null;
    }
    return playbackUrlMap[item.url] ?? item.url;
  }

  function pauseNativeSlot(slot: 0 | 1) {
    try {
      getNativePlayer(slot).pause();
    } catch {
      // ignore pause race
    }
  }

  function runVideoSlideTransition(previousSlot: 0 | 1) {
    setTransitionPreviousSlot(previousSlot);
    videoSlideAnim.stopAnimation();
    videoSlideAnim.setValue(0);
    Animated.timing(videoSlideAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => setTransitionPreviousSlot(null));
  }

  async function replaceNativeSlot(slot: 0 | 1, url: string, autoPlay: boolean) {
    const token = `${slot}:${url}:${autoPlay ? 'play' : 'preload'}`;
    if (nativeReplacingTokenRef.current[slot] === token) {
      return;
    }
    nativeReplacingTokenRef.current[slot] = token;

    try {
      const player = getNativePlayer(slot);
      setNativeVideoReady((prev) => {
        const next: [boolean, boolean] = [prev[0], prev[1]];
        next[slot] = false;
        return next;
      });
      await player.replaceAsync(toVideoSource(url));
      if (nativeReplacingTokenRef.current[slot] !== token) {
        return;
      }
      nativeSlotSourcesRef.current[slot] = url;
      setNativeVideoReady((prev) => {
        const next: [boolean, boolean] = [prev[0], prev[1]];
        next[slot] = true;
        return next;
      });
      player.currentTime = 0;
      if (autoPlay) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      try {
        const player = getNativePlayer(slot);
        player.replace(toVideoSource(url), true);
        if (nativeReplacingTokenRef.current[slot] !== token) {
          return;
        }
        nativeSlotSourcesRef.current[slot] = url;
        setNativeVideoReady((prev) => {
          const next: [boolean, boolean] = [prev[0], prev[1]];
          next[slot] = true;
          return next;
        });
        player.currentTime = 0;
        if (autoPlay) {
          player.play();
        } else {
          player.pause();
        }
      } catch {
        setErrorMessage('영상 재생 준비 중 오류가 발생했습니다. 다시 시도해 주세요.');
      }
    } finally {
      if (nativeReplacingTokenRef.current[slot] === token) {
        nativeReplacingTokenRef.current[slot] = null;
      }
    }
  }

  function preloadNextNativeClip(fromIndex = currentClipIndexRef.current) {
    if (isWeb) {
      return;
    }
    const nextIndex = fromIndex + 1;
    const nextUrl = getPlaybackUrlAt(nextIndex);
    if (!nextUrl) {
      nativePreparedIndexRef.current = null;
      return;
    }

    const preloadSlot: 0 | 1 = nativeActiveSlotRef.current === 0 ? 1 : 0;
    if (nativePreparedIndexRef.current === nextIndex && nativeSlotSourcesRef.current[preloadSlot] === nextUrl) {
      return;
    }

    nativePreparedIndexRef.current = nextIndex;
    void replaceNativeSlot(preloadSlot, nextUrl, false);
  }

  function switchToPreparedNativeClip() {
    if (isWeb || clipsLengthRef.current <= 1) {
      return false;
    }
    const currentIndex = currentClipIndexRef.current;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= clipsLengthRef.current || lastAutoAdvancedIndexRef.current === currentIndex) {
      return false;
    }

    const nextSlot: 0 | 1 = nativeActiveSlotRef.current === 0 ? 1 : 0;
    const nextUrl = getPlaybackUrlAt(nextIndex);
    if (!nextUrl || nativePreparedIndexRef.current !== nextIndex || nativeSlotSourcesRef.current[nextSlot] !== nextUrl) {
      return false;
    }
    if (!nativeVideoReady[nextSlot]) {
      return false;
    }

    lastAutoAdvancedIndexRef.current = currentIndex;
    const previousSlot = nativeActiveSlotRef.current;
    pauseNativeSlot(previousSlot);
    runVideoSlideTransition(previousSlot);
    setNativeActiveSlot(nextSlot);
    nativeActiveSlotRef.current = nextSlot;
    try {
      const nextPlayer = getNativePlayer(nextSlot);
      nextPlayer.currentTime = 0;
      nextPlayer.play();
    } catch {
      // ignore play race
    }
    setCurrentClipIndex(nextIndex);
    return true;
  }

  function handleNativeTimeUpdate(slot: 0 | 1, currentTime: number) {
    if (isWeb || slot !== nativeActiveSlotRef.current || clipsLengthRef.current <= 1) {
      return;
    }

    const duration = getNativePlayer(slot).duration;
    if (!duration) {
      return;
    }

    const remaining = duration - currentTime;
    if (remaining <= PRELOAD_NEXT_SECONDS) {
      preloadNextNativeClip();
    }
    if (remaining <= SWITCH_READY_SECONDS) {
      switchToPreparedNativeClip();
    }
  }

  function handleNativePlayToEnd(slot: 0 | 1) {
    if (isWeb || slot !== nativeActiveSlotRef.current) {
      return;
    }
    if (!switchToPreparedNativeClip()) {
      advanceClip();
    }
  }

  useEventListener(nativePlayerA, 'playToEnd', () => handleNativePlayToEnd(0));
  useEventListener(nativePlayerB, 'playToEnd', () => handleNativePlayToEnd(1));

  useEventListener(nativePlayerA, 'timeUpdate', ({ currentTime }) => handleNativeTimeUpdate(0, currentTime));
  useEventListener(nativePlayerB, 'timeUpdate', ({ currentTime }) => handleNativeTimeUpdate(1, currentTime));

  useEffect(() => {
    if (isWeb) {
      pendingAutoplayVersionRef.current = 0;
      return;
    }

    if (!currentClipUrl) {
      pendingAutoplayVersionRef.current = 0;
      try {
        nativePlayerA.pause();
        nativePlayerB.pause();
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
      const activeSlot = nativeActiveSlotRef.current;
      if (nativeSlotSourcesRef.current[activeSlot] !== currentClipUrl) {
        await replaceNativeSlot(activeSlot, currentClipUrl, true);
      } else {
        try {
          const activePlayer = getNativePlayer(activeSlot);
          activePlayer.currentTime = 0;
          activePlayer.play();
          setNativeVideoReady((prev) => {
            const next: [boolean, boolean] = [prev[0], prev[1]];
            next[activeSlot] = true;
            return next;
          });
        } catch {
          // ignore play race
        }
      }
      if (cancelled || version !== replaceVersionRef.current) {
        return;
      }
      pendingAutoplayVersionRef.current = 0;
      preloadNextNativeClip(currentClipIndex);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentClipIndex, currentClipUrl, isWeb, nativePlayerA, nativePlayerB]);

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
    if (!isWeb) {
      return;
    }

    const nextUrl = getPlaybackUrlAt(currentClipIndex + 1);
    if (!nextUrl || typeof document === 'undefined') {
      return;
    }

    const preloadVideo = webPreloadVideoRef.current ?? document.createElement('video');
    webPreloadVideoRef.current = preloadVideo;
    preloadVideo.muted = true;
    preloadVideo.defaultMuted = true;
    preloadVideo.preload = 'auto';
    preloadVideo.playsInline = true;
    if (preloadVideo.src !== nextUrl) {
      preloadVideo.src = nextUrl;
      try {
        preloadVideo.load?.();
      } catch {
        // ignore browser preload differences
      }
    }
  }, [currentClipIndex, isWeb, playbackItems, playbackUrlMap]);

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
    if (!loading) {
      loadingSpin.stopAnimation();
      loadingSpin.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(loadingSpin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );
    loop.start();

    return () => loop.stop();
  }, [loading, loadingSpin]);

  useEffect(() => {
    avatarOpacity.setValue(0.35);
    avatarScale.setValue(0.985);
    wordOpacity.setValue(0);
    wordTranslateY.setValue(8);
    wordTranslateX.setValue(16);

    Animated.parallel([
      Animated.timing(avatarOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.spring(avatarScale, {
        toValue: 1,
        tension: 120,
        friction: 10,
        useNativeDriver: false,
      }),
      Animated.timing(wordOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.spring(wordTranslateY, {
        toValue: 0,
        tension: 115,
        friction: 9,
        useNativeDriver: false,
      }),
      Animated.spring(wordTranslateX, {
        toValue: 0,
        tension: 115,
        friction: 10,
        useNativeDriver: false,
      }),
    ]).start();
  }, [avatarAnimationKey, avatarOpacity, avatarScale, wordOpacity, wordTranslateX, wordTranslateY]);

  useEffect(() => {
    Animated.timing(progressFill, {
      toValue: progressFraction,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progressFill, progressFraction]);

  useEffect(() => {
    if (!bookmarksOpen) return;
    bookmarkSheetAnim.setValue(0);
    Animated.spring(bookmarkSheetAnim, {
      toValue: 1,
      tension: 120,
      friction: 11,
      useNativeDriver: false,
    }).start();
  }, [bookmarkSheetAnim, bookmarksOpen]);

  useEffect(() => {
    if (!resultOpen) return;
    resultSheetAnim.setValue(0);
    Animated.spring(resultSheetAnim, {
      toValue: 1,
      tension: 120,
      friction: 11,
      useNativeDriver: false,
    }).start();
  }, [resultOpen, resultSheetAnim]);

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
    const timer = setTimeout(() => setFeedbackMessage(null), 1600);
    return () => clearTimeout(timer);
  }, [feedbackMessage, feedbackOpacity, feedbackTranslateY]);

  function pressTranslateButton(active: boolean) {
    Animated.spring(translateButtonScale, {
      toValue: active ? 0.97 : 1,
      tension: 180,
      friction: 12,
      useNativeDriver: false,
    }).start();
  }

  function animateSavedFeedback() {
    saveButtonScale.setValue(0.9);
    Animated.spring(saveButtonScale, {
      toValue: 1,
      tension: 190,
      friction: 7,
      useNativeDriver: false,
    }).start();
  }

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
        setTransitionPreviousSlot(null);
        videoSlideAnim.setValue(1);
      } else {
        nativePreparedIndexRef.current = null;
        nativeSlotSourcesRef.current = [null, null];
        nativeReplacingTokenRef.current = [null, null];
        setNativeVideoReady([false, false]);
        setNativeActiveSlot(0);
        nativeActiveSlotRef.current = 0;
        setTransitionPreviousSlot(null);
        videoSlideAnim.setValue(1);
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
        setTransitionPreviousSlot(null);
        videoSlideAnim.setValue(1);
      } else {
        nativePreparedIndexRef.current = null;
        nativeSlotSourcesRef.current = [null, null];
        nativeReplacingTokenRef.current = [null, null];
        setNativeVideoReady([false, false]);
        setNativeActiveSlot(0);
        nativeActiveSlotRef.current = 0;
        setTransitionPreviousSlot(null);
        videoSlideAnim.setValue(1);
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
        animateSavedFeedback();
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
      animateSavedFeedback();
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

    runVideoSlideTransition(previousSlot);
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

        <Animated.View style={[styles.avatarCard, { opacity: avatarOpacity, transform: [{ scale: avatarScale }] }]}>
          {currentClipUrl ? (
            isWeb ? (
              <View style={styles.webVideoStack}>
                <Animated.View
                  style={getVideoSlotContainerStyle(0, webActiveSlot, webVideoReady, transitionPreviousSlot, videoSlideAnim, avatarSlideWidth)}>
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
                    style={styles.webVideoElement as any}
                  />
                </Animated.View>
                <Animated.View
                  style={getVideoSlotContainerStyle(1, webActiveSlot, webVideoReady, transitionPreviousSlot, videoSlideAnim, avatarSlideWidth)}>
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
                    style={styles.webVideoElement as any}
                  />
                </Animated.View>
              </View>
            ) : (
              <View style={styles.nativeVideoStack}>
                <Animated.View
                  style={getVideoSlotContainerStyle(0, nativeActiveSlot, nativeVideoReady, transitionPreviousSlot, videoSlideAnim, avatarSlideWidth)}>
                  <VideoView
                    style={styles.avatarVideo}
                    player={nativePlayerA}
                    nativeControls={nativeActiveSlot === 0}
                    contentFit="cover"
                    surfaceType="textureView"
                    useExoShutter={false}
                  />
                </Animated.View>
                <Animated.View
                  style={getVideoSlotContainerStyle(1, nativeActiveSlot, nativeVideoReady, transitionPreviousSlot, videoSlideAnim, avatarSlideWidth)}>
                  <VideoView
                    style={styles.avatarVideo}
                    player={nativePlayerB}
                    nativeControls={nativeActiveSlot === 1}
                    contentFit="cover"
                    surfaceType="textureView"
                    useExoShutter={false}
                  />
                </Animated.View>
              </View>
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
          {loading ? (
            <View style={styles.avatarLoadingOverlay} pointerEvents="none">
              <Animated.View style={[styles.avatarLoadingIcon, { transform: [{ rotate: spinRotation }] }]}>
                <Ionicons name="sync" size={18} color="#fff" />
              </Animated.View>
            </View>
          ) : null}
        </Animated.View>

        <View style={styles.detectWrap}>
          <Animated.Text
            style={[
              styles.detectTitle,
              {
                opacity: wordOpacity,
                transform: [{ translateX: wordTranslateX }, { translateY: wordTranslateY }],
              },
            ]}>
            {currentPlaybackItem?.word ?? '나 (I/Me)'}
          </Animated.Text>
          <Text style={styles.detectSub}>
            {playbackItems.length > 0 ? `${currentClipIndex + 1} / ${playbackItems.length}` : '0 / 0'} 인식된 수어 (Detected Gesture)
          </Text>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
        </View>

        <View style={styles.actionRow}>
          <View style={styles.actionItem}>
            <Animated.View style={{ transform: [{ scale: saveButtonScale }] }}>
              <Pressable style={styles.actionIconWrap} onPress={handleSaveSentence} accessibilityLabel="현재 문장 저장">
                <Ionicons name="bookmark" size={16} color="#111827" />
              </Pressable>
            </Animated.View>
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
        {bookmarksOpen && (
          <Animated.View style={[styles.bookmarkSheet, bookmarkSheetStyle]}>
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
          </Animated.View>
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

          <Animated.View style={{ transform: [{ scale: translateButtonScale }] }}>
            <Pressable
              style={[styles.translateButton, loading && styles.translateButtonDisabled]}
              onPress={() => void handleTranslate()}
              onPressIn={() => pressTranslateButton(true)}
              onPressOut={() => pressTranslateButton(false)}
              disabled={loading}>
              <Animated.View style={loading ? { transform: [{ rotate: spinRotation }] } : undefined}>
                <Ionicons name={loading ? 'sync' : 'language-outline'} size={18} color="#fff" />
              </Animated.View>
              <Text style={styles.translateButtonText}>
                {loading ? `번역중${'.'.repeat(loadingDotCount)}` : '번역하기 (Translate)'}
              </Text>
            </Pressable>
          </Animated.View>

          <Pressable style={styles.detailButton} onPress={() => setResultOpen(true)}>
            <Ionicons name="list-outline" size={16} color={ACCENT} />
            <Text style={styles.detailButtonText}>세부 결과</Text>
          </Pressable>
        </View>

        {resultOpen && (
          <Animated.View style={[styles.resultSheet, resultSheetStyle]}>
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
          </Animated.View>
        )}

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} onPress={() => router.push('/home')}>
            <View style={styles.navIconBubble}>
              <Ionicons name="home-outline" size={18} color="#94a3b8" />
            </View>
            <Text style={styles.navText}>홈</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/learn')}>
            <View style={styles.navIconBubble}>
              <Ionicons name="school-outline" size={18} color="#94a3b8" />
            </View>
            <Text style={styles.navText}>학습하기</Text>
          </Pressable>
          <Pressable style={styles.navItem}>
            <View style={[styles.navIconBubble, styles.navIconBubbleActive]}>
              <MaterialCommunityIcons name="sign-language" size={18} color={PRIMARY} />
            </View>
            <Text style={[styles.navText, styles.navTextActive]}>통역기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/mypage')}>
            <View style={styles.navIconBubble}>
              <Ionicons name="person-outline" size={18} color="#94a3b8" />
            </View>
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

function getVideoSlotContainerStyle(
  slot: 0 | 1,
  activeSlot: 0 | 1,
  ready: [boolean, boolean],
  previousSlot: 0 | 1 | null,
  slideAnim: Animated.Value,
  slideWidth: number
) {
  const isActive = slot === activeSlot && ready[slot];
  const isPrevious = previousSlot === slot;
  const translateX = isActive && previousSlot !== null
    ? slideAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [slideWidth, 0],
      })
    : isPrevious
    ? slideAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -slideWidth],
      })
    : isActive
    ? 0
    : slideWidth;

  return {
    ...StyleSheet.absoluteFillObject,
    opacity: isActive || isPrevious ? 1 : 0,
    transform: [{ translateX }],
    zIndex: isActive ? 2 : isPrevious ? 1 : 0,
  } as any;
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
  safeArea: { flex: 1, backgroundColor: '#f8f7ff' },
  root: { flex: 1, backgroundColor: '#f8f7ff', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 84 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: '#111827', fontFamily: FONT, fontSize: 20, fontWeight: '900' },
  avatarCard: {
    marginTop: 8,
    height: '39%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    position: 'relative',
    shadowColor: '#d5d7ec',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  avatarVideo: { width: '100%', height: '100%', backgroundColor: '#000' },
  webVideoElement: { width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#e5e7eb' } as any,
  webVideoStack: { width: '100%', height: '100%', position: 'relative', backgroundColor: '#e5e7eb' },
  nativeVideoStack: { width: '100%', height: '100%', position: 'relative', backgroundColor: '#000' },
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
    fontFamily: FONT,
    fontSize: 54,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptyAvatar: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef2f7', gap: 8, paddingHorizontal: 14 },
  emptyAvatarText: { color: '#64748b', fontFamily: FONT, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  avatarLoadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.2)',
  },
  avatarLoadingIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124, 108, 242, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
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
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ade80' },
  liveText: { color: '#fff', fontFamily: FONT, fontSize: 11, fontWeight: '700' },
  detectWrap: { alignItems: 'center', marginTop: 8 },
  detectTitle: { color: '#111827', fontFamily: FONT, fontSize: 34, fontWeight: '900' },
  detectSub: { marginTop: 2, color: '#64748b', fontFamily: FONT, fontSize: 13, fontWeight: '600' },
  progressTrack: {
    marginTop: 8,
    width: '54%',
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
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
  actionLabel: { color: '#64748b', fontFamily: FONT, fontSize: 11, fontWeight: '700' },
  feedbackToast: {
    alignSelf: 'center',
    marginTop: 2,
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
  feedbackText: { textAlign: 'center', color: '#1d4ed8', fontFamily: FONT, fontSize: 12, fontWeight: '700' },
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
  bookmarkTitle: { color: '#334155', fontFamily: FONT, fontSize: 15, fontWeight: '900' },
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
  bookmarkSearchInput: { flex: 1, color: '#0f172a', fontFamily: FONT, fontSize: 13, paddingVertical: 7 },
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
  bookmarkItemText: { flex: 1, color: '#0f172a', fontFamily: FONT, fontSize: 12, fontWeight: '600' },
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
  bookmarkEmpty: { color: '#94a3b8', fontFamily: FONT, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 12 },
  errorText: { marginTop: 6, textAlign: 'center', color: '#b91c1c', fontFamily: FONT, fontSize: 12, fontWeight: '700' },
  inputPanel: {
    marginTop: 'auto',
    marginBottom: 12,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 10,
    shadowColor: '#d8daee',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  inputWrap: {
    minHeight: 48,
    borderRadius: 18,
    backgroundColor: '#f8f9ff',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: { flex: 1, color: '#111827', fontFamily: FONT, fontSize: 14, paddingVertical: 10 },
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
    height: 54,
    borderRadius: 27,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    shadowColor: ACCENT,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  translateButtonDisabled: { opacity: 0.6 },
  translateButtonText: { color: '#fff', fontFamily: FONT, fontSize: 17, fontWeight: '900' },
  detailButton: {
    marginTop: 8,
    height: 40,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d8d2ff',
    backgroundColor: '#f5f3ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailButtonText: { color: ACCENT, fontFamily: FONT, fontSize: 14, fontWeight: '900' },
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
  sheetTitle: { color: '#111827', fontFamily: FONT, fontSize: 14, fontWeight: '800' },
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
  resultTitle: { color: '#334155', fontFamily: FONT, fontSize: 12, fontWeight: '800' },
  resultValue: { color: '#0f172a', fontFamily: FONT, fontSize: 14, fontWeight: '600' },
  tokenWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tokenChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tokenChipText: { color: '#1d4ed8', fontFamily: FONT, fontSize: 11, fontWeight: '700' },
  unknownChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  unknownChipText: { color: '#b91c1c', fontFamily: FONT, fontSize: 11, fontWeight: '700' },
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
  noVideoChipText: { color: '#b45309', fontFamily: FONT, fontSize: 11, fontWeight: '700' },
  resultSubTitle: { color: '#94a3b8', fontFamily: FONT, fontSize: 10, fontWeight: '500' },
  emptyText: { color: '#94a3b8', fontFamily: FONT, fontSize: 11, fontWeight: '600' },
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
    height: 70,
    paddingBottom: 4,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 20,
  },
  navItem: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 58 },
  navIconBubble: {
    width: 30,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconBubbleActive: {
    backgroundColor: '#e8f2ff',
  },
  navText: { fontFamily: FONT, fontSize: 10, color: '#94a3b8', fontWeight: '600' },
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

