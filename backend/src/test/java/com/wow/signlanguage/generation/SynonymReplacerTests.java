package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** OpenAI is a fake; vocabulary and embedding cache are synthetic (see SynonymIndexTests). */
class SynonymReplacerTests {
  static final String SENTENCE = "변소에서 벗을 만났다";
  // 변소 points at 화장실, 벗 at 친구, 고양이 at 개.
  static final Map<String, float[]> QUERY = Map.of(
      "변소", new float[] {1, 0, 0}, "벗", new float[] {0, 1, 0}, "고양이", new float[] {0, 0, 1});

  @TempDir Path dir;
  OpenAiSynonymClient openAi = mock(OpenAiSynonymClient.class);
  WordVocabulary vocabulary;
  SynonymIndex index;

  @BeforeEach void setUp() throws Exception {
    index = SynonymIndexTests.index(dir);
    vocabulary = WordVocabularyTests.load(dir, SynonymIndexTests.VOCAB);
    when(openAi.configured()).thenReturn(true);
    when(openAi.embed(anyList(), eq("test-embedding"), eq(3))).thenAnswer(call -> {
      List<String> words = call.getArgument(0);
      return Optional.of(words.stream().map(word -> QUERY.getOrDefault(word, new float[] {1, 1, 1})).toList());
    });
  }

  SynonymReplacer replacer(int candidates) {
    return new SynonymReplacer(index, vocabulary, openAi, true, candidates);
  }

  void llmAnswers(Map<String, String> answers) {
    when(openAi.choose(anyString(), anyMap())).thenReturn(Optional.of(answers));
  }

  @Test void replacesOnlyWhatTheModelConfirms() {
    llmAnswers(Map.of("변소", "화장실", "벗", "none"));
    SynonymReplacer.Result result = replacer(2).replace(SENTENCE, List.of("변소", "벗", "만나다"));
    assertThat(result.words()).containsExactly("화장실", "벗", "만나다");
    assertThat(result.replacements()).containsExactly(new SynonymReplacer.Replacement("변소", "화장실"));
  }

  @Test void asksOnceWithTheSentenceAndNearestCandidatesOfOutOfTableWordsOnly() {
    llmAnswers(Map.of());
    replacer(2).replace(SENTENCE, List.of("변소", "친구", "눈", "벗", "변소"));
    // 친구 (mapped) and 눈 (ambiguous) are in the table: never embedded, never offered. 변소 is asked once.
    verify(openAi, times(1)).embed(List.of("변소", "벗"), "test-embedding", 3);
    verify(openAi, times(1)).choose(SENTENCE, Map.of("변소", List.of("화장실", "개"), "벗", List.of("친구", "만나다")));
  }

  @Test void repeatedWordsAreAllReplaced() {
    llmAnswers(Map.of("변소", "화장실"));
    SynonymReplacer.Result result = replacer(2).replace(SENTENCE, List.of("변소", "가다", "변소"));
    assertThat(result.words()).containsExactly("화장실", "가다", "화장실");
    assertThat(result.replacements()).hasSize(1);
  }

  @Test void answersOutsideTheOfferedCandidatesAreIgnored() {
    // 친구 is drawable but was not offered for 변소; 고양이's answer is invented.
    llmAnswers(Map.of("변소", "친구", "고양이", "강아지"));
    SynonymReplacer.Result result = replacer(1).replace(SENTENCE, List.of("변소", "고양이"));
    assertThat(result.words()).containsExactly("변소", "고양이");
    assertThat(result.replacements()).isEmpty();
  }

  @Test void noneAndMissingAnswersKeepTheWord() {
    llmAnswers(Map.of("고양이", "none"));
    SynonymReplacer.Result result = replacer(2).replace(SENTENCE, List.of("고양이", "벗"));
    assertThat(result.words()).containsExactly("고양이", "벗");
  }

  @Test void allInTableMeansNoCall() {
    SynonymReplacer.Result result = replacer(2).replace(SENTENCE, List.of("친구", "눈", "만나다"));
    assertThat(result.words()).containsExactly("친구", "눈", "만나다");
    verify(openAi, never()).embed(anyList(), anyString(), anyInt());
    verify(openAi, never()).choose(anyString(), anyMap());
  }

  @Test void embeddingFailureKeepsWordsAndSkipsTheChat() {
    when(openAi.embed(anyList(), anyString(), anyInt())).thenReturn(Optional.empty());
    assertThat(replacer(2).replace(SENTENCE, List.of("변소")).words()).containsExactly("변소");
    verify(openAi, never()).choose(anyString(), anyMap());
  }

  @Test void chatFailureKeepsWords() {
    when(openAi.choose(anyString(), anyMap())).thenReturn(Optional.empty());
    assertThat(replacer(2).replace(SENTENCE, List.of("변소")).replacements()).isEmpty();
  }

  @Test void unexpectedErrorsKeepWords() {
    when(openAi.choose(anyString(), anyMap())).thenThrow(new IllegalStateException("boom"));
    assertThat(replacer(2).replace(SENTENCE, List.of("변소")).words()).containsExactly("변소");
  }

  @Test void offWithoutCacheKeyOrSwitch() throws Exception {
    ObjectMapper json = new ObjectMapper();
    SynonymIndex noCache = new SynonymIndex("", vocabulary, json);
    assertThat(new SynonymReplacer(noCache, vocabulary, openAi, true, 2).replace(SENTENCE, List.of("변소")).words())
        .containsExactly("변소");
    assertThat(new SynonymReplacer(index, vocabulary, openAi, false, 2).replace(SENTENCE, List.of("변소")).words())
        .containsExactly("변소");
    when(openAi.configured()).thenReturn(false);
    assertThat(replacer(2).replace(SENTENCE, List.of("변소")).words()).containsExactly("변소");
    verify(openAi, never()).embed(anyList(), anyString(), anyInt());
  }
}
