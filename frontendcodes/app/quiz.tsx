import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import {
  ChoiceId,
  QuizAnswerResponse,
  QuizSessionQuestion,
  fetchQuizSession,
  fetchWrongQuizSession,
  submitQuizAnswer,
} from '@/lib/api/quiz';
import { saveWrongNote } from '@/lib/api/wrong-note-saved';
import { recordQuizAttempt } from '@/lib/api/users';
import { useAuth } from '@/context/auth-context';

const PRIMARY = '#1f80e3';
const QUIZ_COUNT = 10;
const CHOICE_IDS: ChoiceId[] = ['A', 'B', 'C', 'D'];

type Option = {
  id: ChoiceId;
  text: string;
};

type StreakTier = 'base' | 'bronze' | 'silver' | 'gold';

function getStreakTier(streak: number): StreakTier {
  if (streak >= 12) return 'gold';
  if (streak >= 8) return 'silver';
  if (streak >= 5) return 'bronze';
  return 'base';
}

function toOptions(question: QuizSessionQuestion | null): Option[] {
  if (!question) return [];
  return question.choices.slice(0, 4).map((text, index) => ({
    id: CHOICE_IDS[index],
    text,
  }));
}

export default function QuizScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; title?: string; category?: string }>();
  const { user } = useAuth();
  const { width, height } = useWindowDimensions();
  const isWrongOnlyMode = params.mode === 'wrong';
  const sessionTitleParam = typeof params.title === 'string' ? params.title : '';
  const categoryParam = typeof params.category === 'string' ? params.category : undefined;
  const sessionTitle = sessionTitleParam || (isWrongOnlyMode ? '오답 복습 퀴즈' : '오늘의 퀴즈');

  const [questions, setQuestions] = useState<QuizSessionQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<ChoiceId | null>(null);
  const [answerResult, setAnswerResult] = useState<QuizAnswerResponse | null>(null);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressTrackWidth, setProgressTrackWidth] = useState(0);
  const badgeScale = useRef(new Animated.Value(1)).current;
  const comboScale = useRef(new Animated.Value(1)).current;
  const comboTranslateY = useRef(new Animated.Value(0)).current;
  const waveOpacity = useRef(new Animated.Value(0)).current;
  const waveScale = useRef(new Animated.Value(0.6)).current;
  const feedbackTranslateY = useRef(new Animated.Value(52)).current;
  const feedbackScale = useRef(new Animated.Value(0.96)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const prevStreakRef = useRef(0);
  const prevComboStreakRef = useRef(0);
  const sessionStartedAtRef = useRef(Date.now());

  const currentQuestion = questions[currentIndex] ?? null;
  const options = useMemo(() => toOptions(currentQuestion), [currentQuestion]);
  const player = useVideoPlayer(currentQuestion?.videoUrl ?? null, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.play();
  });

  const isAnswered = answerResult !== null;
  const isCorrect = answerResult?.isCorrect ?? false;
  const waveDiameter = Math.max(width, height) * 2.3;
  const streakTier = getStreakTier(currentStreak);
  const streakBadgeTone =
    streakTier === 'gold'
      ? { bg: '#f59e0b', border: '#fcd34d', text: '#111827' }
      : streakTier === 'silver'
      ? { bg: '#94a3b8', border: '#e2e8f0', text: '#0f172a' }
      : streakTier === 'bronze'
      ? { bg: '#b45309', border: '#fdba74', text: '#fff7ed' }
      : { bg: '#f59e0b', border: '#fbbf24', text: '#111827' };
  const progressText = `${Math.min(currentIndex + 1, Math.max(questions.length, 1))} / ${Math.max(questions.length, 1)}`;
  const progressPercent =
    questions.length > 0 ? Math.min(((currentIndex + 1) / questions.length) * 100, 100) : 0;
  const comboLabel = `콤보 x${currentStreak}`;
  const comboLabelWidth = 86 + Math.max(0, String(currentStreak).length - 1) * 10;
  const comboLabelLeft = useMemo(() => {
    if (progressTrackWidth <= 0) {
      return 0;
    }
    const centerX = (progressPercent / 100) * progressTrackWidth;
    const rawLeft = centerX - comboLabelWidth / 2;
    return Math.max(0, Math.min(rawLeft, progressTrackWidth - comboLabelWidth));
  }, [comboLabelWidth, progressPercent, progressTrackWidth]);
  const questionCorrectRate =
    typeof currentQuestion?.correctRate === 'number' ? currentQuestion.correctRate : null;
  const questionAttemptCount =
    typeof currentQuestion?.attemptCount === 'number' ? currentQuestion.attemptCount : null;
  const normalizedDifficulty = (currentQuestion?.difficultyLevel ?? '').trim().toLowerCase();
  const difficultyLabel = normalizedDifficulty
    ? normalizedDifficulty
    : questionCorrectRate == null
    ? ''
    : questionCorrectRate <= 40
    ? 'hard'
    : questionCorrectRate >= 70
    ? 'easy'
    : 'medium';
  const difficultyText =
    difficultyLabel === 'hard' || difficultyLabel === '어려움'
      ? '어려움'
      : difficultyLabel === 'easy' || difficultyLabel === '쉬움'
      ? '쉬움'
      : difficultyLabel === 'medium' || difficultyLabel === '보통'
      ? '보통'
      : '';
  const difficultyTone =
    difficultyText === '쉬움'
      ? { chipBg: '#dcfce7', chipText: '#15803d', percent: '#16a34a' }
      : difficultyText === '보통'
      ? { chipBg: '#fef3c7', chipText: '#a16207', percent: '#ca8a04' }
      : difficultyText === '어려움'
      ? { chipBg: '#fecaca', chipText: '#991b1b', percent: '#b91c1c' }
      : { chipBg: '#dbeafe', chipText: '#2563eb', percent: '#2563eb' };

  const accuracy = answeredCount <= 0 ? 0 : Math.round((correctCount / answeredCount) * 100);
  const summarySeconds = Math.max(elapsedSeconds, 1);
  const summaryMinutesText = `${Math.floor(summarySeconds / 60)}분 ${summarySeconds % 60}초`;

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        if (isWrongOnlyMode && !user?.id) {
          throw new Error('로그인 후 오답 복습 퀴즈를 이용할 수 있습니다.');
        }
        sessionStartedAtRef.current = Date.now();
        setShowSummary(false);
        setElapsedSeconds(0);
        setCorrectCount(0);
        setAnsweredCount(0);
        setCurrentStreak(0);
        setMaxStreak(0);
        const session =
          isWrongOnlyMode && user?.id
            ? await fetchWrongQuizSession(user.id, QUIZ_COUNT)
            : await fetchQuizSession(QUIZ_COUNT, categoryParam);
        if (!mounted) return;
        setQuestions(session.questions ?? []);
        setCurrentIndex(0);
      } catch (error) {
        if (!mounted) return;
        setErrorMessage(error instanceof Error ? error.message : '퀴즈를 불러오지 못했습니다.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [categoryParam, isWrongOnlyMode, user?.id]);

  function handleSelect(id: ChoiceId) {
    if (!currentQuestion || isAnswered || isChecking) return;

    setSelectedId(id);
    setIsSaved(false);
    setErrorMessage(null);
  }

  async function handleSubmitAnswer() {
    if (!currentQuestion || !selectedId || isAnswered || isChecking) return;

    try {
      setIsChecking(true);
      const result = await submitQuizAnswer(currentQuestion.quizId, selectedId);
      setAnswerResult(result);
      setAnsweredCount((prev) => prev + 1);
      if (result.isCorrect) {
        setCorrectCount((prev) => prev + 1);
      }
      setCurrentStreak((prev) => {
        const nextStreak = result.isCorrect ? prev + 1 : 0;
        setMaxStreak((currentMax) => Math.max(currentMax, nextStreak));
        return nextStreak;
      });
      feedbackTranslateY.setValue(52);
      feedbackScale.setValue(0.96);
      feedbackOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.spring(feedbackTranslateY, {
          toValue: 0,
          tension: 85,
          friction: 7,
          useNativeDriver: false,
        }),
        Animated.spring(feedbackScale, {
          toValue: 1,
          tension: 95,
          friction: 8,
          useNativeDriver: false,
        }),
      ]).start();

      if (user?.id) {
        await recordQuizAttempt(user.id, currentQuestion.quizId, result.isCorrect);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '정답 확인에 실패했습니다.');
    } finally {
      setIsChecking(false);
    }
  }

  function handleNext() {
    if (currentIndex + 1 >= questions.length) {
      const elapsed = Math.round((Date.now() - sessionStartedAtRef.current) / 1000);
      setElapsedSeconds(Math.max(elapsed, 1));
      setShowSummary(true);
      return;
    }

    setCurrentIndex((prev) => prev + 1);
    setSelectedId(null);
    setAnswerResult(null);
    setIsSaved(false);
    setErrorMessage(null);
  }

  function handleSaveFeedback() {
    if (!isAnswered || !user?.id || !currentQuestion) return;
    if (isSaving || isSaved) return;
    setErrorMessage(null);
    setIsSaving(true);
    void saveWrongNote(user.id, currentQuestion.quizId)
      .then(() => setIsSaved(true))
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : '오답노트 저장에 실패했습니다.');
      })
      .finally(() => setIsSaving(false));
  }

  function handleReplayVideo() {
    try {
      player.replay();
      player.play();
    } catch {
      setErrorMessage('영상을 다시 재생하지 못했습니다.');
    }
  }

  function handleRestartSession() {
    router.replace({
      pathname: '/quiz',
      params: {
        ...(isWrongOnlyMode ? { mode: 'wrong' } : {}),
        ...(categoryParam ? { category: categoryParam } : {}),
        ...(sessionTitleParam ? { title: sessionTitleParam } : {}),
      },
    });
  }

  useEffect(() => {
    if (!currentQuestion) return;
    try {
      player.replay();
      player.play();
    } catch {
      // Ignore autoplay failures; user can still replay manually.
    }
  }, [currentQuestion, player]);

  useEffect(() => {
    const prev = prevStreakRef.current;
    prevStreakRef.current = currentStreak;

    if (currentStreak <= prev || currentStreak <= 0) {
      return;
    }
    if (currentStreak % 3 !== 0) {
      return;
    }

    badgeScale.setValue(1);
    waveOpacity.setValue(0.62);
    waveScale.setValue(0.6);

    Animated.parallel([
      Animated.sequence([
        Animated.timing(badgeScale, {
          toValue: 1.26,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(badgeScale, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.back(1.2)),
          useNativeDriver: false,
        }),
      ]),
      Animated.timing(waveScale, {
        toValue: 2.2,
        duration: 2100,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(waveOpacity, {
        toValue: 0,
        duration: 2500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();
  }, [badgeScale, currentStreak, waveOpacity, waveScale]);

  useEffect(() => {
    const prev = prevComboStreakRef.current;
    prevComboStreakRef.current = currentStreak;

    if (currentStreak < 2 || currentStreak <= prev) {
      return;
    }

    comboScale.setValue(0.84);
    comboTranslateY.setValue(6);

    Animated.parallel([
      Animated.spring(comboScale, {
        toValue: 1.16,
        tension: 150,
        friction: 7,
        useNativeDriver: false,
      }),
      Animated.spring(comboTranslateY, {
        toValue: -2,
        tension: 130,
        friction: 8,
        useNativeDriver: false,
      }),
    ]).start(() => {
      Animated.parallel([
        Animated.spring(comboScale, {
          toValue: 1,
          tension: 120,
          friction: 9,
          useNativeDriver: false,
        }),
        Animated.spring(comboTranslateY, {
          toValue: 0,
          tension: 120,
          friction: 10,
          useNativeDriver: false,
        }),
      ]).start();
    });
  }, [comboScale, comboTranslateY, currentStreak]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>퀴즈를 불러오는 중...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (showSummary) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.summaryRoot}>
          <Text style={styles.summaryTitle}>퀴즈 결과</Text>
          <Text style={styles.summarySubTitle}>{sessionTitle}</Text>

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>정답률</Text>
              <Text style={styles.summaryValue}>{accuracy}%</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>최대 연속 정답</Text>
              <Text style={styles.summaryValue}>{maxStreak}회</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>걸린 시간</Text>
              <Text style={styles.summaryValue}>{summaryMinutesText}</Text>
            </View>
          </View>

          <Pressable style={styles.summaryPrimaryButton} onPress={handleRestartSession}>
            <Text style={styles.summaryPrimaryButtonText}>같은 퀴즈 다시 풀기</Text>
          </Pressable>
          <Pressable style={styles.summarySecondaryButton} onPress={() => router.replace('/learn')}>
            <Text style={styles.summarySecondaryButtonText}>이전 화면으로</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentQuestion) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>
            {isWrongOnlyMode ? '오답 복습 문제가 없습니다.' : '출제 가능한 문제가 없습니다.'}
          </Text>
          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <Animated.View pointerEvents="none" style={[styles.screenFlashOverlay, { opacity: waveOpacity }]} />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.waveOverlay,
            {
              width: waveDiameter,
              height: waveDiameter,
              borderRadius: waveDiameter / 2,
              left: (width - waveDiameter) / 2,
              top: (height - waveDiameter) / 2,
              opacity: waveOpacity,
              transform: [{ scale: waveScale }],
            },
          ]}
        />
        <Animated.View pointerEvents="none" style={[styles.boltLayer, { opacity: waveOpacity }]}>
          <View style={[styles.boltSegment, styles.boltSeg1]} />
          <View style={[styles.boltSegment, styles.boltSeg2]} />
          <View style={[styles.boltSegment, styles.boltSeg3]} />
          <View style={[styles.boltSegment, styles.boltSeg4]} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.starLayer, { opacity: waveOpacity }]}>
          <Ionicons name="star" size={12} color="#fde68a" style={[styles.starItem, styles.star1]} />
          <Ionicons name="star" size={10} color="#fef08a" style={[styles.starItem, styles.star2]} />
          <Ionicons name="star" size={14} color="#fde68a" style={[styles.starItem, styles.star3]} />
          <Ionicons name="star" size={9} color="#fef08a" style={[styles.starItem, styles.star4]} />
          <Ionicons name="star" size={11} color="#fde68a" style={[styles.starItem, styles.star5]} />
          <Ionicons name="star" size={13} color="#fef08a" style={[styles.starItem, styles.star6]} />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.comboBurstWrap, { opacity: waveOpacity, transform: [{ scale: badgeScale }] }]}>
          <Text style={styles.comboBurstText}>콤보 x{currentStreak}</Text>
        </Animated.View>
        <View style={styles.headerBlock}>
          <View style={styles.header}>
            <Pressable style={styles.closeButton} onPress={() => router.back()}>
              <Ionicons name="close" size={22} color="#64748b" />
            </Pressable>
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack} onLayout={(event) => setProgressTrackWidth(event.nativeEvent.layout.width)}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              {currentStreak >= 2 && (
                <Animated.Text
                  style={[
                    styles.streakProgressText,
                    {
                      left: comboLabelLeft,
                      width: comboLabelWidth,
                      color: streakBadgeTone.bg,
                      transform: [{ translateY: comboTranslateY }, { scale: comboScale }],
                    },
                  ]}>
                  {comboLabel}
                </Animated.Text>
              )}
            </View>
            <Text style={styles.progressText}>{progressText}</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.imageWrap}>
            {currentQuestion?.videoUrl ? (
              <>
                <VideoView style={styles.videoPlayer} player={player} nativeControls contentFit="cover" />
                <Pressable style={styles.replayButton} onPress={handleReplayVideo}>
                  <Ionicons name="play" size={14} color="#4b5563" />
                  <Text style={styles.replayText}>다시 재생</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.noVideoWrap}>
                <Ionicons name="videocam-off-outline" size={36} color="#94a3b8" />
                <Text style={styles.noVideoText}>이 단어의 수어 영상이 아직 준비되지 않았습니다.</Text>
              </View>
            )}
          </View>

          <View style={styles.questionWrap}>
            <View style={styles.difficultyPanel}>
              <View style={[styles.difficultyChip, { backgroundColor: difficultyTone.chipBg }]}>
                <Ionicons name="pulse" size={12} color={difficultyTone.chipText} />
                <Text style={[styles.difficultyChipText, { color: difficultyTone.chipText }]}>
                  난이도 {difficultyText || '미정'}
                </Text>
              </View>
              {questionCorrectRate !== null ? (
                <Text style={styles.difficultyDescription}>
                  이 문제는 전체 사용자의{' '}
                  <Text style={[styles.correctRateValue, { color: difficultyTone.percent }]}>
                    {questionCorrectRate}%
                  </Text>
                  가 맞춘 퀴즈입니다.
                </Text>
              ) : (
                <Text style={styles.difficultyDescriptionMuted}>이 문제 통계는 집계 중입니다.</Text>
              )}
              {questionAttemptCount !== null && questionAttemptCount < 20 ? (
                <Text style={styles.difficultyHint}>표본이 적어 통계가 달라질 수 있습니다.</Text>
              ) : null}
            </View>
            <Text style={styles.questionTitle}>{currentQuestion.questionText}</Text>
            <Text style={styles.questionSub}>알맞은 답을 선택해주세요.</Text>
          </View>

          <View style={styles.optionsWrap}>
            {options.map((option) => {
              const isPicked = selectedId === option.id;
              const isCorrectOption = isAnswered && answerResult?.correctChoiceId === option.id;
              const isWrongPicked = isAnswered && isPicked && !isCorrect;
              const shouldFade = isAnswered && !isPicked && !isCorrectOption;
              const isWaitingPicked = !isAnswered && isPicked;

              return (
                <Pressable
                  key={option.id}
                  style={[
                    styles.optionButton,
                    shouldFade && styles.optionDisabled,
                    isWaitingPicked && styles.optionPicked,
                    isCorrectOption && styles.optionCorrect,
                    isWrongPicked && styles.optionWrong,
                  ]}
                  onPress={() => handleSelect(option.id)}>
                  <View
                    style={[
                      styles.optionBadge,
                      isWaitingPicked && styles.optionBadgePicked,
                      isCorrectOption && styles.optionBadgeCorrect,
                      isWrongPicked && styles.optionBadgeWrong,
                    ]}>
                    <Text
                      style={[
                        styles.optionBadgeText,
                        isWaitingPicked && styles.optionBadgeTextPicked,
                        isCorrectOption && styles.optionBadgeTextCorrect,
                        isWrongPicked && styles.optionBadgeTextWrong,
                      ]}>
                      {option.id}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.optionText,
                      isWaitingPicked && styles.optionTextPicked,
                      isCorrectOption && styles.optionTextCorrect,
                      isWrongPicked && styles.optionTextWrong,
                    ]}>
                    {option.text}
                  </Text>

                  {isCorrectOption && <Ionicons name="checkmark" size={20} color="#22c55e" />}
                  {isWrongPicked && <Ionicons name="close" size={20} color="#ef4444" />}
                </Pressable>
              );
            })}
          </View>

          {!isAnswered && (
            <Pressable
              style={[styles.submitButton, (!selectedId || isChecking) && styles.submitButtonDisabled]}
              onPress={handleSubmitAnswer}
              disabled={!selectedId || isChecking}>
              <Text style={styles.submitButtonText}>{isChecking ? '제출 중...' : '제출하기'}</Text>
            </Pressable>
          )}

          {isChecking && <Text style={styles.helperText}>정답을 확인하는 중...</Text>}
          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

          {isAnswered && answerResult && (
            <Animated.View
              style={[
                styles.feedbackWrap,
                isCorrect ? styles.feedbackCorrect : styles.feedbackWrong,
                {
                  opacity: feedbackOpacity,
                  transform: [{ translateY: feedbackTranslateY }, { scale: feedbackScale }],
                },
              ]}>
              <View style={styles.feedbackTop}>
                <View style={[styles.feedbackIconWrap, isCorrect ? styles.iconCorrect : styles.iconWrong]}>
                  <Ionicons
                    name={isCorrect ? 'checkmark' : 'close'}
                    size={20}
                    color={isCorrect ? '#22c55e' : '#ef4444'}
                  />
                </View>
                <View style={styles.feedbackTextWrap}>
                  <Text style={[styles.feedbackTitle, isCorrect ? styles.feedbackTitleCorrect : styles.feedbackTitleWrong]}>
                    {isCorrect ? '정답입니다' : '오답입니다'}
                  </Text>
                  <Text style={[styles.feedbackDesc, isCorrect ? styles.feedbackDescCorrect : styles.feedbackDescWrong]}>
                    정답: {answerResult.correctChoiceText}
                  </Text>
                  {isCorrect && currentStreak >= 2 && (
                    <Text style={styles.streakInlineText}>콤보 x{currentStreak} 진행 중</Text>
                  )}
                </View>
              </View>

              <Pressable
                style={[styles.saveButton, isCorrect ? styles.saveButtonCorrect : styles.saveButtonWrong]}
                onPress={handleSaveFeedback}
                disabled={isSaving || isSaved}>
                <MaterialCommunityIcons name="bookmark" size={15} color={isCorrect ? '#16a34a' : '#ef4444'} />
                <Text style={[styles.saveButtonText, isCorrect ? styles.saveTextCorrect : styles.saveTextWrong]}>
                  {isSaved ? '저장됨' : isSaving ? '저장 중...' : '오답노트에 저장'}
                </Text>
              </Pressable>

              {isSaved && <Text style={styles.savedFeedback}>저장되었습니다</Text>}

              <Pressable
                style={[styles.nextButton, isCorrect ? styles.nextButtonCorrect : styles.nextButtonWrong]}
                onPress={handleNext}>
                <Text style={styles.nextButtonText}>
                  {currentIndex + 1 >= questions.length ? '퀴즈 종료' : '다음 문제로'}
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  root: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    overflow: 'hidden',
  },
  summaryRoot: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 18,
    paddingTop: 36,
  },
  summaryTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
  },
  summarySubTitle: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '700',
    color: '#64748b',
    textAlign: 'center',
  },
  summaryCard: {
    marginTop: 26,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontSize: 17,
    color: '#334155',
    fontWeight: '700',
  },
  summaryValue: {
    fontSize: 22,
    color: '#0f172a',
    fontWeight: '900',
  },
  summaryPrimaryButton: {
    marginTop: 24,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryPrimaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  summarySecondaryButton: {
    marginTop: 10,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summarySecondaryButtonText: {
    color: '#475569',
    fontSize: 16,
    fontWeight: '700',
  },
  screenFlashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(253, 224, 71, 0.28)',
    zIndex: 50,
    elevation: 50,
  },
  waveOverlay: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderWidth: 6,
    borderColor: 'rgba(253, 224, 71, 0.9)',
    zIndex: 51,
    elevation: 51,
  },
  boltLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 55,
    elevation: 55,
  },
  starLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 56,
    elevation: 56,
  },
  starItem: {
    position: 'absolute',
  },
  star1: {
    top: '16%',
    left: '12%',
  },
  star2: {
    top: '24%',
    left: '72%',
  },
  star3: {
    top: '36%',
    left: '18%',
  },
  star4: {
    top: '46%',
    left: '80%',
  },
  star5: {
    top: '62%',
    left: '28%',
  },
  star6: {
    top: '72%',
    left: '74%',
  },
  boltSegment: {
    position: 'absolute',
    width: 14,
    borderRadius: 999,
    backgroundColor: '#fef08a',
    borderWidth: 1,
    borderColor: '#fde047',
  },
  boltSeg1: {
    height: 190,
    top: 42,
    left: '47%',
    transform: [{ rotate: '28deg' }],
  },
  boltSeg2: {
    height: 170,
    top: 196,
    left: '44%',
    transform: [{ rotate: '-32deg' }],
  },
  boltSeg3: {
    height: 200,
    top: 330,
    left: '50%',
    transform: [{ rotate: '30deg' }],
  },
  boltSeg4: {
    height: 230,
    top: 510,
    left: '46%',
    transform: [{ rotate: '-14deg' }],
  },
  comboBurstWrap: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(17, 24, 39, 0.68)',
    borderWidth: 2,
    borderColor: '#f59e0b',
    zIndex: 60,
    elevation: 60,
  },
  comboBurstText: {
    color: '#f59e0b',
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#334155',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  headerBlock: {
    paddingBottom: 6,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: {
    flex: 1,
    paddingHorizontal: 8,
    position: 'relative',
    paddingBottom: 24,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#d1d5db',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: PRIMARY,
  },
  progressText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'right',
  },
  streakProgressText: {
    position: 'absolute',
    top: 14,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.12)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 24,
  },
  imageWrap: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#d1d5db',
    height: 350,
    position: 'relative',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  noVideoWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    gap: 10,
    paddingHorizontal: 24,
  },
  noVideoText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  replayButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  replayText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '700',
  },
  questionWrap: {
    marginTop: 14,
    alignItems: 'center',
    width: '100%',
  },
  difficultyPanel: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dde4ef',
    backgroundColor: '#eef2f7',
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 4,
  },
  difficultyChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#dbeafe',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  difficultyChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  difficultyDescription: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  correctRateValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  difficultyDescriptionMuted: {
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  difficultyHint: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
  questionTitle: {
    marginTop: 14,
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  questionSub: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
  },
  optionsWrap: {
    marginTop: 14,
    gap: 8,
  },
  optionButton: {
    minHeight: 58,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#d5dbe3',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionDisabled: {
    opacity: 0.6,
  },
  optionCorrect: {
    borderColor: '#22c55e',
    backgroundColor: '#e8f9ee',
  },
  optionPicked: {
    borderColor: PRIMARY,
    backgroundColor: '#eff6ff',
  },
  optionWrong: {
    borderColor: '#ef4444',
    backgroundColor: '#fef2f2',
  },
  optionBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  optionBadgeCorrect: {
    backgroundColor: '#d1fae5',
    borderColor: '#86efac',
  },
  optionBadgePicked: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
  },
  optionBadgeWrong: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  optionBadgeText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
  },
  optionBadgeTextCorrect: {
    color: '#16a34a',
  },
  optionBadgeTextPicked: {
    color: PRIMARY,
  },
  optionBadgeTextWrong: {
    color: '#dc2626',
  },
  optionText: {
    flex: 1,
    marginLeft: 12,
    color: '#4b5563',
    fontSize: 18,
    fontWeight: '600',
  },
  optionTextCorrect: {
    color: '#15803d',
  },
  optionTextPicked: {
    color: '#1d4ed8',
  },
  optionTextWrong: {
    color: '#b91c1c',
  },
  submitButton: {
    marginTop: 12,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
  },
  submitButtonDisabled: {
    backgroundColor: '#93c5fd',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  helperText: {
    marginTop: 10,
    textAlign: 'center',
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 10,
    textAlign: 'center',
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '700',
  },
  feedbackWrap: {
    marginTop: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderTopWidth: 2,
  },
  feedbackCorrect: {
    backgroundColor: '#eaf9ef',
    borderTopColor: '#bbf7d0',
  },
  feedbackWrong: {
    backgroundColor: '#fef2f2',
    borderTopColor: '#fecaca',
  },
  feedbackTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedbackIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  iconCorrect: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  iconWrong: {
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  feedbackTextWrap: {
    flex: 1,
  },
  feedbackTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  feedbackTitleCorrect: {
    color: '#16a34a',
  },
  feedbackTitleWrong: {
    color: '#dc2626',
  },
  feedbackDesc: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '600',
  },
  feedbackDescCorrect: {
    color: '#166534',
  },
  feedbackDescWrong: {
    color: '#7f1d1d',
  },
  streakInlineText: {
    marginTop: 4,
    color: '#92400e',
    fontSize: 13,
    fontWeight: '700',
  },
  saveButton: {
    marginTop: 12,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
  },
  saveButtonCorrect: {
    borderColor: '#86efac',
  },
  saveButtonWrong: {
    borderColor: '#fca5a5',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  saveTextCorrect: {
    color: '#16a34a',
  },
  saveTextWrong: {
    color: '#dc2626',
  },
  savedFeedback: {
    marginTop: 8,
    textAlign: 'center',
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  nextButton: {
    marginTop: 10,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonCorrect: {
    backgroundColor: '#22c55e',
  },
  nextButtonWrong: {
    backgroundColor: '#ef4444',
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
});
