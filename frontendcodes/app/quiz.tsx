import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#1f80e3';
const CORRECT_ID = 'A';

type Option = {
  id: 'A' | 'B' | 'C' | 'D';
  text: string;
};

const OPTIONS: Option[] = [
  { id: 'A', text: '안녕하세요' },
  { id: 'B', text: '감사합니다' },
  { id: 'C', text: '미안합니다' },
  { id: 'D', text: '반갑습니다' },
];

export default function QuizScreen() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<Option['id'] | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const isAnswered = selectedId !== null;
  const isCorrect = selectedId === CORRECT_ID;

  function handleSelect(id: Option['id']) {
    if (isAnswered) return;
    setSelectedId(id);
    setIsSaved(false);
  }

  function handleNext() {
    setSelectedId(null);
    setIsSaved(false);
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
              <View style={styles.progressFill} />
            </View>
          </View>
          <Text style={styles.progressText}>3 / 10</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.imageWrap}>
            <Image
              source={{
                uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAvbquIqnIM4VfFf76FFOla9NVkwZB0pnDjiQJrkJ0a6Jah0MPf954olrFBzzop5P2bW-vCo_jN8qcEvdEAgBIgQK5MUgv_KAhxiCc42Is53joiE3uwKxrQ4ln9KzAZ2cfWsqu3DlM8seMjtLiQNkDZb-tP9eU3Aq5gPYzRimsDpJrfzdyBgJspYPTVUzXiJ9rDQoJZlX0yPp0kdIyL9rmh5UI5LC1dwJs8u5tF2EH6sDYVI1_XZ1NpX45zAdhKb8WCIhXRnHRqlA',
              }}
              contentFit="cover"
              style={styles.avatarImage}
            />
            <Pressable style={styles.replayButton}>
              <Ionicons name="refresh" size={14} color="#4b5563" />
              <Text style={styles.replayText}>다시 보기</Text>
            </Pressable>
          </View>

          <View style={styles.questionWrap}>
            <Text style={styles.questionTitle}>이 수어의 의미는 무엇인가요?</Text>
            <Text style={styles.questionSub}>알맞은 답을 선택해주세요.</Text>
          </View>

          <View style={styles.optionsWrap}>
            {OPTIONS.map((option) => {
              const isPicked = selectedId === option.id;
              const isWrongPicked = isPicked && !isCorrect;
              const isCorrectPicked = isPicked && isCorrect;
              const shouldFade = isAnswered && !isPicked;

              return (
                <Pressable
                  key={option.id}
                  style={[
                    styles.optionButton,
                    shouldFade && styles.optionDisabled,
                    isCorrectPicked && styles.optionCorrect,
                    isWrongPicked && styles.optionWrong,
                  ]}
                  onPress={() => handleSelect(option.id)}>
                  <View
                    style={[
                      styles.optionBadge,
                      isCorrectPicked && styles.optionBadgeCorrect,
                      isWrongPicked && styles.optionBadgeWrong,
                    ]}>
                    <Text
                      style={[
                        styles.optionBadgeText,
                        isCorrectPicked && styles.optionBadgeTextCorrect,
                        isWrongPicked && styles.optionBadgeTextWrong,
                      ]}>
                      {option.id}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.optionText,
                      isCorrectPicked && styles.optionTextCorrect,
                      isWrongPicked && styles.optionTextWrong,
                    ]}>
                    {option.text}
                  </Text>

                  {isCorrectPicked && <Ionicons name="checkmark" size={20} color="#22c55e" />}
                  {isWrongPicked && <Ionicons name="close" size={20} color="#ef4444" />}
                </Pressable>
              );
            })}
          </View>

          {isAnswered && (
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
                    {isCorrect ? '정답입니다!' : '오답입니다'}
                  </Text>
                  <Text
                    style={[styles.feedbackDesc, isCorrect ? styles.feedbackDescCorrect : styles.feedbackDescWrong]}>
                    {isCorrect ? '의미: 안녕하세요' : '정답: 안녕하세요'}
                  </Text>
                </View>
              </View>

              <Pressable
                style={[styles.saveButton, isCorrect ? styles.saveButtonCorrect : styles.saveButtonWrong]}
                onPress={() => setIsSaved(true)}>
                <MaterialCommunityIcons name="bookmark" size={15} color={isCorrect ? '#16a34a' : '#ef4444'} />
                <Text style={[styles.saveButtonText, isCorrect ? styles.saveTextCorrect : styles.saveTextWrong]}>
                  내 단어장에 저장
                </Text>
              </Pressable>
              {isSaved && <Text style={styles.savedFeedback}>저장되었습니다</Text>}

              <Pressable
                style={[styles.nextButton, isCorrect ? styles.nextButtonCorrect : styles.nextButtonWrong]}
                onPress={handleNext}>
                <Text style={styles.nextButtonText}>다음 문제로</Text>
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
    width: '30%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: PRIMARY,
  },
  progressText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 36,
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
  avatarImage: {
    width: '100%',
    height: '100%',
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
