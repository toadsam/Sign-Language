import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  ChoiceId,
  QuizAnswerResponse,
  QuizSessionQuestion,
  fetchQuizSession,
  submitQuizAnswer,
} from '@/lib/api/quiz';
import { useAuth } from '@/context/auth-context';

const PRIMARY = '#1f80e3';
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

export default function QuizScreen() {
  const router = useRouter();

  const [questions, setQuestions] = useState<QuizSessionQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<ChoiceId | null>(null);
  const [answerResult, setAnswerResult] = useState<QuizAnswerResponse | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { user } = useAuth(); // user.uid가 구글 고유 ID(sub)라고 가정

  const currentQuestion = questions[currentIndex] ?? null;
  const options = useMemo(() => toOptions(currentQuestion), [currentQuestion]);
  const player = useVideoPlayer(currentQuestion?.videoUrl ?? null, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.play();
  });

  const isAnswered = answerResult !== null;
  const isCorrect = answerResult?.isCorrect ?? false;
  const progressText = `${Math.min(currentIndex + 1, Math.max(questions.length, 1))} / ${Math.max(questions.length, 1)}`;
  const progressPercent =
    questions.length > 0 ? Math.min(((currentIndex + 1) / questions.length) * 100, 100) : 0;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const session = await fetchQuizSession(QUIZ_COUNT);
        if (!mounted) return;
        setQuestions(session.questions ?? []);
        setCurrentIndex(0);
      } catch (error) {
        if (!mounted) return;
        setErrorMessage(error instanceof Error ? error.message : '퀴즈를 불러오지 못했습니다.');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleSelect(id: ChoiceId) {
    if (!currentQuestion || isAnswered || isChecking) return;

    setSelectedId(id);
    setIsSaved(false);
    setErrorMessage(null);

    try {
      setIsChecking(true);
      const result = await submitQuizAnswer(currentQuestion.quizId, id);
      setAnswerResult(result);

      console.log('user:', user);
      console.log('user.id:', user?.id);
      console.log('currentQuestion:', currentQuestion);
      console.log('result:', result);

      if (user && user.id) {
        console.log('PATCH 요청 실행', user.id, currentQuestion.quizId, result.isCorrect);
        await fetch(`http://localhost:8080/api/users/${user.id}/tryQuestion`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionId: currentQuestion.quizId,
            isCorrect: result.isCorrect,
          }),
        });
      } else {
        console.log('user 또는 user.id가 없음, PATCH 요청 실행 안 됨');
      }
    } catch (error) {
      setSelectedId(null);
      setErrorMessage(error instanceof Error ? error.message : '정답 확인에 실패했습니다.');
      console.error('handleSelect error:', error);
    } finally {
      setIsChecking(false);
    }
  }

  function handleNext() {
    if (currentIndex + 1 >= questions.length) {
      router.back();
      return;
    }

    setCurrentIndex((prev) => prev + 1);
    setSelectedId(null);
    setAnswerResult(null);
    setIsSaved(false);
    setErrorMessage(null);
  }

  function handleReplayVideo() {
    try {
      player.replay();
      player.play();
    } catch {
      setErrorMessage('영상을 다시 재생하지 못했습니다.');
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>퀴즈를 불러오는 중...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentQuestion) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>출제 가능한 문제가 없습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.closeButton} onPress={() => router.back()}>
            <Ionicons name="close" size={22} color="#64748b" />
          </Pressable>
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>
          <Text style={styles.progressText}>{progressText}</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.imageWrap}>
            <VideoView
              style={styles.videoPlayer}
              player={player}
              nativeControls
              contentFit="cover"
            />
            <Pressable style={styles.replayButton} onPress={handleReplayVideo}>
              <Ionicons name="play" size={14} color="#4b5563" />
              <Text style={styles.replayText}>다시 재생</Text>
            </Pressable>
          </View>

          <View style={styles.questionWrap}>
            <Text style={styles.questionTitle}>{currentQuestion.questionText}</Text>
            <Text style={styles.questionSub}>알맞은 답을 선택해주세요.</Text>
          </View>

          <View style={styles.optionsWrap}>
            {options.map((option) => {
              const isPicked = selectedId === option.id;
              const isCorrectOption = isAnswered && answerResult?.correctChoiceId === option.id;
              const isWrongPicked = isAnswered && isPicked && !isCorrect;
              const shouldFade = isAnswered && !isPicked && !isCorrectOption;

              return (
                <Pressable
                  key={option.id}
                  style={[
                    styles.optionButton,
                    shouldFade && styles.optionDisabled,
                    isCorrectOption && styles.optionCorrect,
                    isWrongPicked && styles.optionWrong,
                  ]}
                  onPress={() => handleSelect(option.id)}>
                  <View
                    style={[
                      styles.optionBadge,
                      isCorrectOption && styles.optionBadgeCorrect,
                      isWrongPicked && styles.optionBadgeWrong,
                    ]}>
                    <Text
                      style={[
                        styles.optionBadgeText,
                        isCorrectOption && styles.optionBadgeTextCorrect,
                        isWrongPicked && styles.optionBadgeTextWrong,
                      ]}>
                      {option.id}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.optionText,
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

          {isChecking && <Text style={styles.helperText}>정답을 확인하는 중...</Text>}
          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

          {isAnswered && answerResult && (
            <View style={[styles.feedbackWrap, isCorrect ? styles.feedbackCorrect : styles.feedbackWrong]}>
              <View style={styles.feedbackTop}>
                <View style={[styles.feedbackIconWrap, isCorrect ? styles.iconCorrect : styles.iconWrong]}>
                  <Ionicons
                    name={isCorrect ? 'checkmark' : 'close'}
                    size={20}
                    color={isCorrect ? '#22c55e' : '#ef4444'}
                  />
                </View>
                <View style={styles.feedbackTextWrap}>
                  <Text
                    style={[styles.feedbackTitle, isCorrect ? styles.feedbackTitleCorrect : styles.feedbackTitleWrong]}>
                    {isCorrect ? '정답입니다' : '오답입니다'}
                  </Text>
                  <Text
                    style={[styles.feedbackDesc, isCorrect ? styles.feedbackDescCorrect : styles.feedbackDescWrong]}>
                    정답: {answerResult.correctChoiceText}
                  </Text>
                </View>
              </View>

              <Pressable
                style={[styles.saveButton, isCorrect ? styles.saveButtonCorrect : styles.saveButtonWrong]}
                onPress={() => setIsSaved(true)}>
                <MaterialCommunityIcons name="bookmark" size={15} color={isCorrect ? '#16a34a' : '#ef4444'} />
                <Text style={[styles.saveButtonText, isCorrect ? styles.saveTextCorrect : styles.saveTextWrong]}>
                  오답노트에 저장
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
            </View>
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
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: {
    flex: 1,
    paddingHorizontal: 8,
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
  },
  questionTitle: {
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
  optionTextWrong: {
    color: '#b91c1c',
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
  savedFeedback: {
    marginTop: 8,
    textAlign: 'center',
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  saveTextCorrect: {
    color: '#16a34a',
  },
  saveTextWrong: {
    color: '#dc2626',
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
