/**
 * 통역 화면 (색칠 마을).
 * 문장을 쓰면 서버가 수어 순서로 바꾸고, 낱말 조각에서 조사·어미가 떨어진 뒤
 * 손짓하는 낱말 조각이 차례로 노랗게 칠해진다.
 * AI 동작(/generate)이 오면 펜 선 아바타로, 없으면 1학기 영상을 그대로 이어 튼다.
 * 결과 글자(수어 순서 조각, 바꾼 문장, 지금 낱말)는 펜으로 한 자씩 쓰듯 나타난다.
 */
import { useEventListener } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';

import { EmptyState, errorKind } from '@/components/paint/empty-state';
import { Handwrite } from '@/components/paint/handwrite';
import { BodyText, PaintButton, PaintHeader, PaintIcon, PaintTabBar, PaperScreen, RoughBox, StoryText, Wash, type PaintIconName } from '@/components/paint/paint-ui';
import { PenAvatar } from '@/components/paint/pen-avatar';
import { PenLoader } from '@/components/paint/pen-loader';
import { TalkChain } from '@/components/paint/talk-chain';
import { usePaintNav } from '@/components/paint/transition';
import { Font, Paint, Size } from '@/constants/paint';
import { useAuth } from '@/context/auth-context';
import { generateMotion, type Motion } from '@/lib/api/generate';
import { fetchTranslatorBookmarks, saveTranslatorBookmark, TranslatorBookmarkItem } from '@/lib/api/translator-bookmarks';
import { TranslateClip, TranslatePlaybackItem, TranslateResponse, translateText } from '@/lib/api/translate';

const BOOKMARKS_KEY = 'translator.bookmarks.sentences.v2';
const MAX_BOOKMARKS = 20;
const PRELOAD_NEXT_SECONDS = 1.1;
const SWITCH_READY_SECONDS = 0.18;
// 눌러서 바로 해 보는 예문
const PRESETS = ['카페에서 커피 주세요', '화장실이 어디예요?', '고마워요'];

export default function TranslatorScreen() {
  const router = useRouter();
  const nav = usePaintNav();
  const reduce = useReducedMotion();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 오류가 났을 때 「다시 해 보기」로 다시 바꿔 볼 문장 (다시 할 게 없는 오류면 null)
  const [retryText, setRetryText] = useState<string | null>(null);
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

  // AI 동작: 있으면 아바타, 없으면 영상
  const [motion, setMotion] = useState<Motion | null>(null);
  const [motionSeg, setMotionSeg] = useState(-1);
  const [motionDone, setMotionDone] = useState(false);
  const [motionPlayKey, setMotionPlayKey] = useState(0);
  const motionRunRef = useRef(0);
  const motionSegRef = useRef(-1);
  // 낱말 줄을 처음부터 다시 보여 줄 때 바꾸는 값
  const [chainRunKey, setChainRunKey] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const chainYRef = useRef(0);

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

  // 낱말 줄에 보여 줄 것: 쓴 낱말, 수어 순서 조각, 지금 조각
  const chainWords = useMemo(() => (result?.input || inputText).trim().split(/\s+/).filter(Boolean), [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const motionGloss = useMemo(
    () => (motion ? (motion.segments.length > 0 ? motion.segments.map((s) => s.gloss) : normalizedTokens) : []),
    [motion, normalizedTokens]
  );
  const chainGloss = motion ? motionGloss : playbackItems.map((item) => item.word);
  const chainMuted = motion ? undefined : playbackItems.map((item) => !item.hasVideo);
  const chainActive = motion ? motionSeg : playbackItems.length > 0 ? currentClipIndex : -1;
  const caption = motion
    ? motionSeg >= 0
      ? motionGloss[motionSeg] ?? ''
      : motionDone
      ? motionGloss.join(' · ')
      : ''
    : currentPlaybackItem?.word ?? '';
  const stepTotal = motion ? motionGloss.length : playbackItems.length;
  const stepNow = motion ? (motionDone ? stepTotal : motionSeg + 1) : playbackItems.length > 0 ? currentClipIndex + 1 : 0;
  const shownProgress = motion ? (stepTotal > 0 ? Math.max(stepNow, 0) / stepTotal : 0) : progressFraction;

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
  const progressFill = useRef(new Animated.Value(0)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const feedbackTranslateY = useRef(new Animated.Value(8)).current;
  const bookmarkSheetAnim = useRef(new Animated.Value(0)).current;
  const resultSheetAnim = useRef(new Animated.Value(0)).current;
  const saveButtonScale = useRef(new Animated.Value(1)).current;
  const videoSlideAnim = useRef(new Animated.Value(1)).current;
  const avatarAnimationKey = `${currentClipIndex}:${currentPlaybackItem?.word ?? ''}:${currentClipUrl ?? 'text'}`;
  // 손짓 액자 크기. 영상이 옆으로 밀려 들어오는 거리도 이 너비
  const frameWidth = Math.max(Math.min(screenWidth - 40, 520), 1);
  const frameHeight = Math.round(frameWidth * 0.78);
  const avatarSlideWidth = frameWidth;
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
      duration: reduce ? 0 : 220,
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
        setRetryText(inputText.trim() || null);
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
    // AI 동작을 보여 줄 때는 영상을 틀지 않는다
    if (motion) return;
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
  }, [currentClipIndex, currentClipUrl, isWeb, nativePlayerA, nativePlayerB, motion]);

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
    if (motion || !currentPlaybackItem || currentClipUrl) {
      return;
    }

    const timer = setTimeout(() => {
      if (currentClipIndexRef.current !== currentClipIndex) {
        return;
      }
      advanceClip();
    }, 4000);

    return () => clearTimeout(timer);
  }, [currentClipIndex, currentClipUrl, currentPlaybackItem, motion]);

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
          setRetryText(null);
          setErrorMessage(error instanceof Error ? error.message : '북마크를 불러오지 못했습니다.');
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id]);
  useEffect(() => {
    // 움직임 줄이기: 바로 제자리
    if (reduce) {
      avatarOpacity.setValue(1);
      avatarScale.setValue(1);
      wordOpacity.setValue(1);
      wordTranslateY.setValue(0);
      wordTranslateX.setValue(0);
      return;
    }
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
  }, [avatarAnimationKey, avatarOpacity, avatarScale, wordOpacity, wordTranslateX, wordTranslateY, reduce]);

  useEffect(() => {
    Animated.timing(progressFill, {
      toValue: shownProgress,
      duration: reduce ? 0 : 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progressFill, shownProgress, reduce]);

  useEffect(() => {
    if (!bookmarksOpen) return;
    if (reduce) {
      bookmarkSheetAnim.setValue(1);
      return;
    }
    bookmarkSheetAnim.setValue(0);
    Animated.spring(bookmarkSheetAnim, {
      toValue: 1,
      tension: 120,
      friction: 11,
      useNativeDriver: false,
    }).start();
  }, [bookmarkSheetAnim, bookmarksOpen, reduce]);

  useEffect(() => {
    if (!resultOpen) return;
    if (reduce) {
      resultSheetAnim.setValue(1);
      return;
    }
    resultSheetAnim.setValue(0);
    Animated.spring(resultSheetAnim, {
      toValue: 1,
      tension: 120,
      friction: 11,
      useNativeDriver: false,
    }).start();
  }, [resultOpen, resultSheetAnim, reduce]);

  useEffect(() => {
    if (!feedbackMessage) return;
    feedbackOpacity.setValue(reduce ? 1 : 0);
    feedbackTranslateY.setValue(reduce ? 0 : 8);
    if (!reduce) Animated.parallel([
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
  }, [feedbackMessage, feedbackOpacity, feedbackTranslateY, reduce]);

  function animateSavedFeedback() {
    if (reduce) return;
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
      setRetryText(null);
      if (overrideText) {
        setInputText(text);
      }
      // 전 문장의 AI 동작은 지운다
      const motionRun = ++motionRunRef.current;
      setMotion(null);
      motionSegRef.current = -1;
      setMotionSeg(-1);
      setMotionDone(false);
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
      setChainRunKey((k) => k + 1);
      // AI 동작을 물어본다. 없으면(null) 영상 그대로
      void generateMotion(next.normalizedTokens ?? []).then((m) => {
        if (m && motionRun === motionRunRef.current) setMotion(m);
      });
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
      setRetryText(text);
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
      setRetryText(null);
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
    setRetryText(inputText.trim() || null);
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

  // AI 동작이 오면 숨은 영상은 멈춘다 (영상 경로는 motion이 없을 때 그대로)
  useEffect(() => {
    if (!motion) return;
    try {
      nativePlayerA.pause();
      nativePlayerB.pause();
    } catch {
      // ignore pause race
    }
  }, [motion, nativePlayerA, nativePlayerB]);

  // 번역이 끝나면 낱말 줄이 보이게 내려 준다
  useEffect(() => {
    if (!chainRunKey) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(chainYRef.current - 12, 0), animated: !reduce });
    }, 60);
    return () => clearTimeout(timer);
  }, [chainRunKey, reduce]);

  // 아바타 프레임마다 지금 낱말 조각을 찾는다
  const handleMotionFrame = useCallback(
    (frame: number) => {
      const segs = motion?.segments ?? [];
      const index = segs.findIndex((s) => frame >= s.start && frame < s.end);
      if (index !== motionSegRef.current) {
        motionSegRef.current = index;
        setMotionSeg(index);
      }
    },
    [motion]
  );
  const handleMotionEnd = useCallback(() => {
    motionSegRef.current = -1;
    setMotionSeg(-1);
    setMotionDone(true);
  }, []);
  function replayMotion() {
    motionSegRef.current = -1;
    setMotionSeg(-1);
    setMotionDone(false);
    setMotionPlayKey((k) => k + 1);
  }

  const signer = motion ? (
    <PenAvatar
      key={motionPlayKey}
      motion={motion}
      playing
      loop={false}
      onFrame={handleMotionFrame}
      onEnd={handleMotionEnd}
      style={styles.penAvatar}
    />
  ) : currentClipUrl ? (
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
    // 영상이 없는 낱말은 글씨로 보여 준다
    <View style={styles.textAvatar}>
      <Wash color={Paint.sky} opacity={0.45} seed={currentClipIndex + 2} inset={24} />
      <StoryText size={50} style={styles.textAvatarWord} adjustsFontSizeToFit numberOfLines={1}>
        {currentPlaybackItem.word}
      </StoryText>
      <BodyText soft size={Size.small}>이 낱말은 아직 영상이 없어요</BodyText>
    </View>
  ) : (
    <View style={styles.emptyAvatar}>
      <PaintIcon name="translator" size={40} color={Paint.inkSoft} />
      <BodyText soft size={Size.small} style={{ textAlign: 'center' }}>
        문장을 입력하면 아바타가 표시됩니다
      </BodyText>
    </View>
  );

  return (
    <PaperScreen edges={['top']}>
      <View style={styles.root}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <PaintHeader
            title="통역"
            sub="문장을 쓰면 수어 순서로 바꿔서 손짓으로 보여 줘요."
            onBack={router.canGoBack() ? () => void nav.back() : undefined}
          />

          {/* 문장 상자 + 예문 */}
          <RoughBox seed={4} radius={16} style={styles.inputBox}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="번역할 내용을 입력하세요"
              placeholderTextColor={Paint.inkFaint}
              accessibilityLabel="바꿀 문장"
              multiline
            />
            <View style={styles.presets}>
              {PRESETS.map((preset, i) => (
                <Pressable
                  key={preset}
                  onPress={() => void handleTranslate(preset)}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel={`예문 ${preset} 수어로 보기`}
                  style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
                  <RoughBox seed={40 + i} radius={12} strokeWidth={1.4} stroke={Paint.inkSoft} style={styles.presetChip}>
                    <BodyText soft size={Size.small}>{preset}</BodyText>
                  </RoughBox>
                </Pressable>
              ))}
            </View>
          </RoughBox>

          <PaintButton
            label={loading ? '바꾸는 중' : '수어로 보기'}
            accessibilityLabel={loading ? '번역 중' : '수어로 보기'}
            color={Paint.sky}
            onPress={() => void handleTranslate()}
            disabled={loading}
            style={styles.goButton}
          />

          {/* 오류: 그림 + 한 줄 말. 다시 바꿔 볼 문장이 있으면 「다시 해 보기」 */}
          {errorMessage ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              {retryText ? (
                <EmptyState
                  kind={errorKind(errorMessage)}
                  compact
                  actionLabel="다시 해 보기"
                  onAction={() => void handleTranslate(retryText)}
                />
              ) : (
                <EmptyState kind={errorKind(errorMessage)} compact sub={errorMessage} />
              )}
            </View>
          ) : null}

          {/* 낱말 줄: 쓴 문장 → 조사·어미 떨어짐 → 수어 순서 */}
          {result ? (
            <View style={styles.chainWrap} onLayout={(e) => (chainYRef.current = e.nativeEvent.layout.y)}>
              <TalkChain
                words={chainWords}
                tokens={normalizedTokens}
                gloss={chainGloss}
                muted={chainMuted}
                active={chainActive}
                runKey={chainRunKey}
                onPick={motion ? undefined : (index) => setCurrentClipIndex(index)}
                doneNote={motion ? '다시 보려면 「다시 보기」를 눌러요' : undefined}
                sentence={result.simplifiedSentence || undefined}
              />
            </View>
          ) : null}

          {/* 손짓 액자 */}
          <RoughBox seed={9} radius={18} style={[styles.signerFrame, { width: frameWidth, height: frameHeight }]}>
            <Animated.View style={[styles.signerInner, { opacity: avatarOpacity, transform: [{ scale: avatarScale }] }]}>
              {signer}
              {loading ? (
                <View style={styles.avatarLoadingOverlay} pointerEvents="none">
                  <PenLoader label="손짓을 그리는 중" />
                </View>
              ) : null}
            </Animated.View>
          </RoughBox>

          {/* 자막 + 몇 번째인지 */}
          <View style={styles.captionWrap}>
            <Animated.View
              style={{
                opacity: wordOpacity,
                transform: [{ translateX: wordTranslateX }, { translateY: wordTranslateY }],
              }}>
              {caption ? (
                <RoughBox seed={23} radius={12} fill={Paint.yellowSoft} strokeWidth={1.4} style={styles.captionPill}>
                  {/* 낱말이 바뀔 때마다 펜으로 새로 쓴다 */}
                  <Handwrite
                    text={caption}
                    runKey={motion ? `m${motionSeg}` : avatarAnimationKey}
                    size={Size.title}
                    underline={false}
                    speed={45}
                    seed={currentClipIndex + 23}
                    accessibilityLiveRegion="polite"
                  />
                </RoughBox>
              ) : null}
            </Animated.View>
            <BodyText soft size={Size.caption} style={styles.counter}>
              {`${stepNow} / ${stepTotal} 손짓`}
            </BodyText>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
          </View>

          {/* 재생 조절 · 저장 · 북마크 · 자세히 */}
          <View style={styles.actionRow}>
            {motion ? (
              <IconAction icon="play" label="다시 보기" onPress={replayMotion} />
            ) : (
              <>
                <IconAction icon="play" flip label="이전" onPress={() => moveClip(-1)} disabled={currentClipIndex <= 0} />
                <IconAction icon="play" label="다음" onPress={() => moveClip(1)} disabled={currentClipIndex >= playbackItems.length - 1} />
              </>
            )}
            <Animated.View style={{ transform: [{ scale: saveButtonScale }] }}>
              <IconAction icon="bookmark" label="저장" a11y="현재 문장 저장" onPress={handleSaveSentence} />
            </Animated.View>
            <IconAction icon="note" label="북마크" a11y="북마크 보기" onPress={handleToggleBookmarks} active={bookmarksOpen} />
            <IconAction icon="star" label="세부 결과" onPress={() => setResultOpen(true)} active={resultOpen} />
          </View>

          {feedbackMessage ? (
            <Animated.View style={[styles.feedbackWrap, { opacity: feedbackOpacity, transform: [{ translateY: feedbackTranslateY }] }]}>
              <RoughBox seed={27} radius={12} wash={Paint.yellowSoft} strokeWidth={1.4} style={styles.feedbackToast}>
                <PaintIcon name="check" size={18} />
                <BodyText size={Size.small} accessibilityLiveRegion="polite">{feedbackMessage}</BodyText>
              </RoughBox>
            </Animated.View>
          ) : null}
        </ScrollView>

        {bookmarksOpen && (
          <Animated.View style={[styles.sheet, bookmarkSheetStyle]}>
            <RoughBox seed={51} radius={18} style={styles.sheetBox}>
              <View style={styles.sheetHeader}>
                <StoryText size={Size.lead}>내 북마크 문장</StoryText>
                <Pressable style={styles.closeButton} onPress={handleToggleBookmarks} accessibilityRole="button" accessibilityLabel="북마크 닫기">
                  <PaintIcon name="close" size={22} color={Paint.inkSoft} />
                </Pressable>
              </View>
              <RoughBox seed={53} radius={12} strokeWidth={1.4} stroke={Paint.inkSoft} style={styles.searchBox}>
                <TextInput
                  value={bookmarkQuery}
                  onChangeText={setBookmarkQuery}
                  placeholder="문장 검색"
                  placeholderTextColor={Paint.inkFaint}
                  accessibilityLabel="북마크 문장 검색"
                  style={styles.searchInput}
                />
              </RoughBox>
              <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent} showsVerticalScrollIndicator={false}>
                {filteredBookmarks.length === 0 ? (
                  <BodyText soft size={Size.small} style={styles.sheetEmpty}>저장된 문장이 없습니다.</BodyText>
                ) : (
                  filteredBookmarks.map((item, i) => (
                    <RoughBox key={item.quizId} seed={60 + i} radius={12} strokeWidth={1.4} style={styles.bookmarkRow}>
                      <BodyText size={Size.small} style={{ flex: 1 }} numberOfLines={2}>
                        {item.questionText || '-'}
                      </BodyText>
                      <Pressable
                        style={styles.rowPlay}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.questionText || '문장'} 다시 보기`}
                        onPress={() => {
                          void handleTranslate(item.questionText);
                          setBookmarksOpen(false);
                          setBookmarkQuery('');
                          setFeedbackMessage('북마크 문장을 재생합니다.');
                        }}>
                        <Wash color={Paint.sky} opacity={0.7} seed={i + 5} inset={4} />
                        <PaintIcon name="play" size={20} />
                      </Pressable>
                    </RoughBox>
                  ))
                )}
              </ScrollView>
            </RoughBox>
          </Animated.View>
        )}

        {resultOpen && (
          <Animated.View style={[styles.sheet, resultSheetStyle]}>
            <RoughBox seed={71} radius={18} style={styles.sheetBox}>
              <View style={styles.sheetHeader}>
                <StoryText size={Size.lead}>번역 결과</StoryText>
                <Pressable style={styles.closeButton} onPress={() => setResultOpen(false)} accessibilityRole="button" accessibilityLabel="번역 결과 닫기">
                  <PaintIcon name="close" size={22} color={Paint.inkSoft} />
                </Pressable>
              </View>
              <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent} showsVerticalScrollIndicator={false}>
                <View style={styles.resultSection}>
                  <StoryText size={Size.small}>수어용 변환 문장</StoryText>
                  {result?.simplifiedSentence ? (
                    <Handwrite text={result.simplifiedSentence} runKey={chainRunKey} font="body" size={Size.body} seed={71} />
                  ) : (
                    <BodyText>-</BodyText>
                  )}
                </View>
                <View style={styles.resultSection}>
                  <StoryText size={Size.small}>매칭된 토큰</StoryText>
                  <View style={styles.tokenWrap}>
                    {normalizedTokens.length === 0 ? (
                      <BodyText soft size={Size.small}>-</BodyText>
                    ) : (
                      normalizedTokens.map((token, index) => (
                        <View key={`${token}-${index}`} style={[styles.tokenChip, { backgroundColor: Paint.card }]}>
                          <BodyText size={Size.caption}>{token}</BodyText>
                        </View>
                      ))
                    )}
                  </View>
                </View>
                <View style={styles.resultSection}>
                  <StoryText size={Size.small}>사전에 없는 토큰</StoryText>
                  <View style={styles.tokenWrap}>
                    {unknownTokens.length === 0 ? (
                      <BodyText soft size={Size.small}>없음</BodyText>
                    ) : (
                      unknownTokens.map((token, index) => (
                        <View key={`${token}-${index}`} style={[styles.tokenChip, { backgroundColor: Paint.wrongSoft }]}>
                          <BodyText size={Size.caption}>{token}</BodyText>
                        </View>
                      ))
                    )}
                  </View>
                </View>
                <View style={styles.resultSection}>
                  <StoryText size={Size.small}>영상이 없는 단어</StoryText>
                  <BodyText soft size={Size.caption}>사전에는 있지만 수어 영상이 준비되지 않은 단어입니다.</BodyText>
                  <View style={styles.tokenWrap}>
                    {noVideoWords.length === 0 ? (
                      <BodyText soft size={Size.small}>없음</BodyText>
                    ) : (
                      noVideoWords.map((token, index) => (
                        <View key={`${token}-${index}`} style={[styles.tokenChip, styles.tokenChipDashed]}>
                          <BodyText size={Size.caption}>{token}</BodyText>
                        </View>
                      ))
                    )}
                  </View>
                </View>
              </ScrollView>
            </RoughBox>
          </Animated.View>
        )}
      </View>
      <PaintTabBar current="translator" />
    </PaperScreen>
  );
}

/* 동그란 손그림 버튼 + 아래 이름 (누르는 곳 48×48) */
function IconAction({
  icon,
  label,
  a11y,
  onPress,
  disabled,
  active,
  flip,
}: {
  icon: PaintIconName;
  label: string;
  a11y?: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  flip?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={({ pressed }) => [styles.iconAction, disabled && { opacity: 0.4 }, pressed && { transform: [{ translateY: 2 }] }]}>
      <RoughBox seed={label.length * 7} radius={24} wash={active ? Paint.sky : undefined} style={styles.iconCircle}>
        <View style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
          <PaintIcon name={icon} size={24} />
        </View>
      </RoughBox>
      <BodyText soft size={Size.caption}>{label}</BodyText>
    </Pressable>
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
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 28 },
  inputBox: { marginHorizontal: 20, marginTop: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  input: { minHeight: 52, color: Paint.ink, fontFamily: Font.body, fontSize: Size.lead, lineHeight: Size.lead * 1.45, paddingVertical: 6, textAlignVertical: 'top' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  presetChip: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  goButton: { marginHorizontal: 20, marginTop: 12 },
  errorBox: { marginHorizontal: 20, marginTop: 12 },
  chainWrap: { marginHorizontal: 16, marginTop: 18 },
  signerFrame: { alignSelf: 'center', marginTop: 16 },
  signerInner: { position: 'absolute', top: 6, left: 6, right: 6, bottom: 6, borderRadius: 13, overflow: 'hidden', backgroundColor: Paint.paperDeep },
  penAvatar: { width: '100%', height: '100%' },
  avatarVideo: { width: '100%', height: '100%', backgroundColor: Paint.paperDeep },
  webVideoElement: { width: '100%', height: '100%', objectFit: 'cover', backgroundColor: Paint.paperDeep } as any,
  webVideoStack: { width: '100%', height: '100%', position: 'relative', backgroundColor: Paint.paperDeep },
  nativeVideoStack: { width: '100%', height: '100%', position: 'relative', backgroundColor: Paint.paperDeep },
  textAvatar: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 6, backgroundColor: Paint.card },
  textAvatarWord: { width: '100%', textAlign: 'center' },
  emptyAvatar: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 18, backgroundColor: Paint.card },
  avatarLoadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251,245,230,0.78)',
  },
  captionWrap: { alignItems: 'center', marginTop: 12, minHeight: 64 },
  captionPill: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  counter: { marginTop: 6 },
  progressTrack: { marginTop: 6, width: '54%', height: 6, borderRadius: 3, borderWidth: 1, borderColor: Paint.line, backgroundColor: Paint.paperDeep, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Paint.sky },
  actionRow: { marginTop: 18, marginHorizontal: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  iconAction: { alignItems: 'center', gap: 4, minWidth: 56 },
  iconCircle: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  feedbackWrap: { alignSelf: 'center', marginTop: 10 },
  feedbackToast: { minHeight: 40, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sheet: { position: 'absolute', left: 12, right: 12, bottom: 8, height: 340, zIndex: 40 },
  sheetBox: { flex: 1, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBox: { marginBottom: 8, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  searchInput: { color: Paint.ink, fontFamily: Font.body, fontSize: Size.small, paddingVertical: 8 },
  sheetList: { flex: 1 },
  sheetListContent: { gap: 8, paddingBottom: 4 },
  sheetEmpty: { textAlign: 'center', marginTop: 12 },
  bookmarkRow: { minHeight: 56, paddingLeft: 12, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowPlay: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  resultSection: { gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Paint.line },
  tokenWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tokenChip: { borderRadius: 10, borderWidth: 1.5, borderColor: Paint.ink, paddingHorizontal: 9, paddingVertical: 3 },
  tokenChipDashed: { borderStyle: 'dashed', borderColor: Paint.inkSoft, backgroundColor: Paint.yellowSoft },
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
