/**
 * 퀴즈 화면 (색칠 마을).
 * 만화 칸 속 수어 영상을 보고 보기 4개 중 뜻을 고른다.
 * 맞으면 칸에 노란 물감이 번지고, 틀리면 카드가 흔들린다. 마지막 문제 뒤에는 결과를 보여 준다.
 */
import { useLocalSearchParams, type Href } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Bee } from '@/components/paint/bee';
import { PaintConfetti } from '@/components/paint/effects';
import { PenLoader } from '@/components/paint/pen-loader';
import {
  BodyText,
  Mark,
  PaintButton,
  PaintIcon,
  PaperScreen,
  RoughBox,
  StoryText,
  Wash,
} from '@/components/paint/paint-ui';
import { EmptyState, errorKind } from '@/components/paint/empty-state';
import { QuizAnswer, QuizAnswerGrid, type QuizAnswerState } from '@/components/paint/quiz-answer';
import { usePaintNav } from '@/components/paint/transition';
import { VideoFrame } from '@/components/paint/video-frame';
import { Paint, Size } from '@/constants/paint';
import { useAuth } from '@/context/auth-context';
import {
  ChoiceId,
  QuizAnswerResponse,
  QuizSessionQuestion,
  fetchQuizSession,
  fetchWrongQuizSession,
  submitQuizAnswer,
} from '@/lib/api/quiz';
import { recordQuizAttempt } from '@/lib/api/users';
import { saveWrongNote } from '@/lib/api/wrong-note-saved';
import { feel } from '@/lib/feel';

const QUIZ_COUNT = 10;
const CHOICE_IDS: ChoiceId[] = ['A', 'B', 'C', 'D'];

type Option = {
  id: ChoiceId;
  text: string;
};

function toOptions(question: QuizSessionQuestion | null): Option[] {
  if (!question) return [];
  return question.choices.slice(0, 4).map((text, index) => ({
    id: CHOICE_IDS[index],
    text,
  }));
}

/* ── 꿀짓이 반응: 맞으면 폴짝 뛰며 한 바퀴, 틀리면 고개를 갸웃 ── */
function BeeCheer({ right, k }: { right: boolean; k: number }) {
  const reduce = useReducedMotion();
  const hop = useSharedValue(0);
  const spin = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    if (right) {
      hop.value = withSequence(withTiming(-18, { duration: 180, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 6, stiffness: 220 }));
      spin.value = 0;
      spin.value = withTiming(360, { duration: 520, easing: Easing.out(Easing.cubic) });
    } else {
      spin.value = withSequence(withTiming(-14, { duration: 140 }), withTiming(10, { duration: 160 }), withTiming(-6, { duration: 140 }), withTiming(0, { duration: 140 }));
    }
  }, [right, k, reduce, hop, spin]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: hop.value }, { rotate: `${spin.value}deg` }] }));
  return (
    <Animated.View style={st}>
      <Bee size={48} flip={!right} />
    </Animated.View>
  );
}

/* ── 연속 정답 물방울: 하나씩 차오르다가 3개가 되면 콤보로 터진다 ── */
function StreakDrops({ streak }: { streak: number }) {
  const filled = streak > 0 && streak % 3 === 0 ? 3 : streak % 3;
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessible accessibilityLabel={`연속 정답 ${streak}개`}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.sdrop, i < filled && { backgroundColor: Paint.yellow }]} />
      ))}
    </View>
  );
}

/* ── 진행 점: 푼 문제는 노랑, 지금 문제는 숨 쉬듯 커졌다 작아진다 ── */
function ProgressDot({ status }: { status: 'done' | 'now' | 'todo' }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (status !== 'now' || reduce) {
      s.value = 1;
      return;
    }
    s.value = withRepeat(withSequence(withTiming(1.25, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
  }, [status, reduce, s]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View
      style={[
        styles.dot,
        status === 'done' && { backgroundColor: Paint.yellow },
        status === 'now' && { backgroundColor: Paint.yellowSoft },
        st,
      ]}
    />
  );
}

export default function QuizScreen() {
  const nav = usePaintNav();
  const reduce = useReducedMotion();
  const params = useLocalSearchParams<{ mode?: string; title?: string; category?: string }>();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
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
  const [isQuestionTransitioning, setIsQuestionTransitioning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displayedCorrectRate, setDisplayedCorrectRate] = useState(0);
  const prevStreakRef = useRef(0);
  const prevComboStreakRef = useRef(0);
  const sessionStartedAtRef = useRef(Date.now());

  // 움직임 값 (reanimated)
  const qOpacity = useSharedValue(1);
  const qShift = useSharedValue(0);
  const noteIn = useSharedValue(0);
  const comboPop = useSharedValue(1);
  const burst = useSharedValue(0);
  const burstScale = useSharedValue(0.6);
  const savedIn = useSharedValue(0);

  const currentQuestion = questions[currentIndex] ?? null;
  const options = useMemo(() => toOptions(currentQuestion), [currentQuestion]);
  const player = useVideoPlayer(currentQuestion?.videoUrl ?? null, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.play();
  });

  const isAnswered = answerResult !== null;
  const isCorrect = answerResult?.isCorrect ?? false;
  const isLast = currentIndex + 1 >= questions.length;
  const total = Math.max(questions.length, 1);
  const progressText = `${Math.min(currentIndex + 1, total)} / ${total}`;
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
  // 난이도 색: 쉬움 초록 · 보통 노랑 · 어려움 산호
  const difficultyColor =
    difficultyText === '쉬움' ? Paint.rightSoft : difficultyText === '어려움' ? Paint.wrongSoft : Paint.yellowSoft;

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
      if (result.isCorrect) feel.right();
      else feel.wrong();
      setAnsweredCount((prev) => prev + 1);
      if (result.isCorrect) {
        setCorrectCount((prev) => prev + 1);
      }
      setCurrentStreak((prev) => {
        const nextStreak = result.isCorrect ? prev + 1 : 0;
        setMaxStreak((currentMax) => Math.max(currentMax, nextStreak));
        return nextStreak;
      });
      // 버튼 위 한 줄 글이 살짝 올라오며 나타난다
      if (reduce) {
        noteIn.value = 1;
      } else {
        noteIn.value = 0;
        noteIn.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.quad) });
      }

      if (user?.id) {
        await recordQuizAttempt(user.id, currentQuestion.quizId, result.isCorrect);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '정답 확인에 실패했습니다.');
    } finally {
      setIsChecking(false);
    }
  }

  function finishSession(at: { x: number; y: number }) {
    const elapsed = Math.round((Date.now() - sessionStartedAtRef.current) / 1000);
    // 결과는 누른 자리에서 물감이 번지며 나온다
    void nav.cover(
      () => {
        setElapsedSeconds(Math.max(elapsed, 1));
        setShowSummary(true);
      },
      { kind: 'bloom', x: at.x, y: at.y },
    );
  }

  function handleNext(at: { x: number; y: number }) {
    if (isQuestionTransitioning) return;

    if (isLast) {
      finishSession(at);
      return;
    }

    const goNext = () => {
      setCurrentIndex((prev) => prev + 1);
      setSelectedId(null);
      setAnswerResult(null);
      setIsSaved(false);
      setErrorMessage(null);
      noteIn.value = 0;
    };

    setIsQuestionTransitioning(true);
    if (reduce) {
      goNext();
      return;
    }
    qOpacity.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) });
    qShift.value = withTiming(-Math.min(width * 0.22, 92), { duration: 180, easing: Easing.in(Easing.cubic) });
    setTimeout(goNext, 190);
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

  function handleRestartSession(at: { x: number; y: number }) {
    const href: Href = {
      pathname: '/quiz',
      params: {
        ...(isWrongOnlyMode ? { mode: 'wrong' } : {}),
        ...(categoryParam ? { category: categoryParam } : {}),
        ...(sessionTitleParam ? { title: sessionTitleParam } : {}),
      },
    };
    void nav.go(href, { kind: 'bloom', replace: true, x: at.x, y: at.y });
  }

  useEffect(() => {
    if (!currentQuestion) return;
    try {
      player.replay();
      player.play();
    } catch {
      // 자동 재생이 막혀도 '다시' 버튼으로 볼 수 있다
    }
  }, [currentQuestion, player]);

  // 전체 정답률 숫자가 0부터 올라간다 (움직임 줄이기면 바로 보여 준다)
  useEffect(() => {
    if (questionCorrectRate === null) {
      setDisplayedCorrectRate(0);
      return;
    }
    if (reduce) {
      setDisplayedCorrectRate(Math.round(questionCorrectRate));
      return;
    }

    setDisplayedCorrectRate(0);
    let frameId: number | null = null;
    const timerId = setTimeout(() => {
      const startedAt = Date.now();
      const duration = 560;

      const animateRate = () => {
        const progress = Math.min((Date.now() - startedAt) / duration, 1);
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        setDisplayedCorrectRate(Math.round(questionCorrectRate * easedProgress));

        if (progress < 1) {
          frameId = requestAnimationFrame(animateRate);
        }
      };

      animateRate();
    }, 110);

    return () => {
      clearTimeout(timerId);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [currentIndex, questionCorrectRate, reduce]);

  // 새 문제가 오른쪽에서 들어온다
  useEffect(() => {
    if (!currentQuestion) return;
    if (reduce) {
      qOpacity.value = 1;
      qShift.value = 0;
      setIsQuestionTransitioning(false);
      return;
    }
    qOpacity.value = 0;
    qShift.value = Math.min(width * 0.22, 92);
    qOpacity.value = withTiming(1, { duration: 210, easing: Easing.out(Easing.quad) });
    qShift.value = withSpring(0, { damping: 18, stiffness: 160 });
    const id = setTimeout(() => setIsQuestionTransitioning(false), 330);
    return () => clearTimeout(id);
    // width는 처음 들어올 때 거리만 정한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion, reduce]);

  // 3번 연속 맞힐 때마다 화면 가운데에 물감이 번지며 콤보가 뜬다
  useEffect(() => {
    const prev = prevStreakRef.current;
    prevStreakRef.current = currentStreak;
    if (currentStreak <= prev || currentStreak <= 0 || currentStreak % 3 !== 0) return;
    if (reduce) return;
    burst.value = 0.9;
    burstScale.value = 0.6;
    burstScale.value = withTiming(1.6, { duration: 1800, easing: Easing.out(Easing.cubic) });
    burst.value = withTiming(0, { duration: 2200, easing: Easing.in(Easing.quad) });
  }, [currentStreak, reduce, burst, burstScale]);

  // 2번 이상 연속이면 위쪽 콤보 글씨가 톡 튄다
  useEffect(() => {
    const prev = prevComboStreakRef.current;
    prevComboStreakRef.current = currentStreak;
    if (currentStreak < 2 || currentStreak <= prev || reduce) return;
    comboPop.value = 0.84;
    comboPop.value = withSequence(withSpring(1.16, { damping: 7, stiffness: 220 }), withSpring(1, { damping: 10, stiffness: 180 }));
  }, [currentStreak, reduce, comboPop]);

  useEffect(() => {
    if (!isSaved) {
      savedIn.value = 0;
      return;
    }
    savedIn.value = reduce ? 1 : withTiming(1, { duration: 180 });
  }, [isSaved, reduce, savedIn]);

  const questionStyle = useAnimatedStyle(() => ({
    opacity: qOpacity.value,
    transform: [{ translateX: qShift.value }],
  }));
  const noteStyle = useAnimatedStyle(() => ({
    opacity: noteIn.value,
    transform: [{ translateY: (1 - noteIn.value) * 6 }],
  }));
  const comboStyle = useAnimatedStyle(() => ({ transform: [{ scale: comboPop.value }] }));
  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.value, transform: [{ scale: burstScale.value }] }));
  const savedStyle = useAnimatedStyle(() => ({
    opacity: savedIn.value,
    transform: [{ translateY: (1 - savedIn.value) * 8 }],
  }));

  if (isLoading) {
    return (
      <PaperScreen edges={['top', 'bottom']}>
        <View style={styles.center} accessibilityLiveRegion="polite">
          <PenLoader label="퀴즈를 그리는 중이에요" size={110} />
        </View>
      </PaperScreen>
    );
  }

  if (showSummary) {
    return (
      <PaperScreen edges={['top', 'bottom']}>
        <PaintConfetti trigger={accuracy >= 70 ? 1 : 0} />
        <ScrollView contentContainerStyle={styles.summaryRoot}>
          <View style={styles.summaryHead}>
            <Bee size={84} />
            <StoryText size={Size.display}>퀴즈 결과</StoryText>
            <BodyText soft>{sessionTitle}</BodyText>
          </View>

          <RoughBox seed={41} wash={Paint.yellowSoft} washOpacity={0.55} style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <BodyText size={Size.lead}>정답률</BodyText>
              <StoryText size={Size.heading}>{accuracy}%</StoryText>
            </View>
            <View style={styles.summaryRow}>
              <BodyText size={Size.lead}>최대 연속 정답</BodyText>
              <StoryText size={Size.heading}>{maxStreak}회</StoryText>
            </View>
            <View style={styles.summaryRow}>
              <BodyText size={Size.lead}>걸린 시간</BodyText>
              <StoryText size={Size.heading}>{summaryMinutesText}</StoryText>
            </View>
          </RoughBox>

          <View style={styles.summaryButtons}>
            {/* 마을로 돌아가면 새로 다 배운 곳이 물감으로 칠해진다 */}
            <PaintButton label="마을에 색칠하러 가기" onPress={(at) => void nav.go('/home', { kind: 'bloom', replace: true, x: at.x, y: at.y })} seed={42} />
            <PaintButton label="같은 퀴즈 다시 풀기" variant="ghost" onPress={handleRestartSession} seed={43} />
            <PaintButton
              label="이전 화면으로"
              variant="ghost"
              seed={44}
              onPress={(at) => void nav.go('/learn', { kind: 'bloom', replace: true, x: at.x, y: at.y })}
            />
          </View>
        </ScrollView>
      </PaperScreen>
    );
  }

  if (!currentQuestion) {
    return (
      <PaperScreen edges={['top', 'bottom']}>
        <View style={styles.center}>
          {errorMessage ? (
            <EmptyState kind={errorKind(errorMessage)} actionLabel="돌아가기" onAction={(at) => void nav.back(at)} />
          ) : isWrongOnlyMode ? (
            <EmptyState kind="empty-note" title="복습할 오답이 없어요" sub="틀린 문제가 생기면 여기서 다시 풀 수 있어요." actionLabel="돌아가기" onAction={(at) => void nav.back(at)} />
          ) : (
            <EmptyState kind="no-quiz" actionLabel="돌아가기" onAction={(at) => void nav.back(at)} />
          )}
        </View>
      </PaperScreen>
    );
  }

  const answerStateOf = (id: ChoiceId): QuizAnswerState => {
    const isPicked = selectedId === id;
    if (!isAnswered) return isPicked ? 'picked' : 'idle';
    if (answerResult?.correctChoiceId === id) return 'right';
    if (isPicked) return 'wrong';
    return 'faded';
  };

  return (
    <PaperScreen edges={['top', 'bottom']}>
      {/* 콤보 물감 번짐 (누르기를 막지 않는다) */}
      <Animated.View pointerEvents="none" style={[styles.burstLayer, burstStyle]}>
        <View style={styles.burstBlob}>
          <Wash color={Paint.yellowSoft} opacity={0.85} seed={currentStreak + 2} />
        </View>
        <RoughBox seed={currentStreak + 30} wash={Paint.yellow} style={styles.burstCard}>
          <StoryText size={34}>콤보 x{currentStreak}</StoryText>
        </RoughBox>
      </Animated.View>

      {/* 위: 돌아가기 · 진행 점 · 몇 번째 */}
      <View style={styles.header}>
        <Pressable
          onPress={(e) => void nav.back({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
          accessibilityRole="button"
          accessibilityLabel="퀴즈 그만하고 돌아가기"
          hitSlop={8}
          style={styles.backBtn}
        >
          <PaintIcon name="back" size={30} />
        </Pressable>
        <View
          style={styles.dots}
          accessible
          accessibilityLabel={`${total}문제 중 ${Math.min(currentIndex + 1, total)}번째`}
        >
          {questions.map((q, i) => (
            <ProgressDot key={q.quizId ?? i} status={i < currentIndex ? 'done' : i === currentIndex ? 'now' : 'todo'} />
          ))}
        </View>
        <BodyText soft size={Size.small}>{progressText}</BodyText>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={questionStyle}>
          <View style={styles.whereRow}>
            <BodyText soft size={Size.small}>{sessionTitle}</BodyText>
            <StreakDrops streak={currentStreak} />
            {currentStreak >= 2 && (
              <Animated.View style={comboStyle}>
                <StoryText size={Size.body}>
                  <Mark color={Paint.yellow}>{` 콤보 x${currentStreak} `}</Mark>
                </StoryText>
              </Animated.View>
            )}
          </View>
          <StoryText size={23} style={styles.question}>{currentQuestion.questionText}</StoryText>

          {/* 난이도 · 전체 정답률 */}
          <View style={styles.statRow}>
            <BodyText size={Size.small}>
              <Mark color={difficultyColor}>{` 난이도 ${difficultyText || '미정'} `}</Mark>
            </BodyText>
            {questionCorrectRate !== null ? (
              <BodyText soft size={Size.small}>
                전체 사용자의 <StoryText size={Size.body}>{displayedCorrectRate}%</StoryText>가 맞춘 문제
              </BodyText>
            ) : (
              <BodyText soft size={Size.small}>통계는 집계 중이에요</BodyText>
            )}
          </View>
          {questionAttemptCount !== null && questionAttemptCount < 20 ? (
            <BodyText soft size={Size.caption}>표본이 적어 통계가 달라질 수 있습니다.</BodyText>
          ) : null}

          {/* 액자 속 수어 영상 */}
          <VideoFrame
            player={currentQuestion.videoUrl ? player : null}
            onReplay={handleReplayVideo}
            seed={currentIndex + 3}
            glow={isAnswered && isCorrect}
            style={styles.panel}
            fallback={
              <>
                <Bee size={60} still />
                <BodyText soft style={{ textAlign: 'center' }}>이 단어의 수어 영상이 아직 준비되지 않았습니다.</BodyText>
              </>
            }
          />

          {/* 보기 4개 */}
          <View style={{ marginTop: 16 }}>
            <QuizAnswerGrid>
              {options.map((option, i) => (
                <QuizAnswer
                  key={option.id}
                  letter={option.id}
                  text={option.text}
                  index={i}
                  revealKey={currentIndex}
                  state={answerStateOf(option.id)}
                  celebrate={isAnswered && isCorrect && selectedId === option.id}
                  disabled={isQuestionTransitioning || isAnswered || isChecking}
                  onPress={() => handleSelect(option.id)}
                />
              ))}
            </QuizAnswerGrid>
          </View>

          {errorMessage && (
            <BodyText size={Size.small} style={styles.errorText}>
              <Mark color={Paint.wrongSoft}>{errorMessage}</Mark>
            </BodyText>
          )}
        </Animated.View>
      </ScrollView>

      {/* 아래: 한 줄 글 + 버튼 */}
      <View style={styles.footer}>
        {isAnswered && answerResult ? (
          <Animated.View style={[styles.noteRow, noteStyle]} accessibilityLiveRegion="polite">
            <BeeCheer right={isCorrect} k={currentIndex} />
            <View style={{ flex: 1 }}>
              <StoryText size={Size.lead}>{isCorrect ? '맞아요!' : '아깝다! 손 모양을 한 번 더 볼까요?'}</StoryText>
              <BodyText soft size={Size.small}>
                정답: <Mark>{answerResult.correctChoiceText}</Mark>
                {isCorrect && currentStreak >= 2 ? `  ·  콤보 x${currentStreak} 진행 중` : ''}
              </BodyText>
            </View>
          </Animated.View>
        ) : isChecking ? (
          <BodyText soft size={Size.small} style={styles.checking}>정답을 확인하는 중...</BodyText>
        ) : null}

        {isSaved && (
          <Animated.View style={[styles.savedRow, savedStyle]} accessibilityLiveRegion="polite">
            <PaintIcon name="check" size={16} />
            <BodyText size={Size.small}>오답노트에 저장되었습니다</BodyText>
          </Animated.View>
        )}

        {!isAnswered ? (
          <PaintButton
            label={isChecking ? '확인하는 중...' : '확인'}
            disabled={!selectedId || isChecking}
            onPress={() => void handleSubmitAnswer()}
            seed={currentIndex + 50}
          />
        ) : (
          <View style={styles.footRow}>
            <PaintButton
              small
              variant="ghost"
              style={{ flex: 1 }}
              seed={61}
              disabled={isSaving || isSaved || !user?.id}
              label={!user?.id ? '로그인 후 저장' : isSaved ? '저장됨' : isSaving ? '저장 중...' : '오답노트'}
              accessibilityLabel={!user?.id ? '로그인하면 오답노트에 저장할 수 있어요' : '오답노트에 저장'}
              icon={<PaintIcon name="bookmark" size={18} color={isSaved || !user?.id ? Paint.inkFaint : Paint.ink} />}
              onPress={handleSaveFeedback}
            />
            <PaintButton
              small
              style={{ flex: 1.4 }}
              seed={62}
              color={isCorrect ? Paint.mint : Paint.yellow}
              disabled={isQuestionTransitioning}
              label={isLast ? '결과 보러 가기' : '다음 문제로'}
              onPress={handleNext}
            />
          </View>
        )}
      </View>
    </PaperScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  sdrop: { width: 12, height: 12, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomRightRadius: 6, borderWidth: 1.5, borderColor: Paint.ink, transform: [{ rotate: '-45deg' }] },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.8, borderColor: Paint.ink, backgroundColor: 'transparent' },

  scrollContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  whereRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  question: { marginTop: 2 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, marginTop: 6 },

  panel: { marginTop: 14 },

  errorText: { marginTop: 12, textAlign: 'center' },

  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 10, borderTopWidth: 1.5, borderTopColor: Paint.line },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checking: { textAlign: 'center' },
  savedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  footRow: { flexDirection: 'row', gap: 10 },

  burstLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 50, elevation: 50 },
  burstBlob: { position: 'absolute', width: 320, height: 320 },
  burstCard: { paddingHorizontal: 22, paddingVertical: 10 },

  summaryRoot: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 28 },
  summaryHead: { alignItems: 'center', gap: 4 },
  summaryCard: { marginTop: 24, paddingVertical: 18, paddingHorizontal: 18, gap: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryButtons: { marginTop: 24, gap: 12 },
});
