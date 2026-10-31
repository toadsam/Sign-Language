package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.normalizer.TextNormalizer;
import com.wow.signlanguage.service.ExternalLexiconApiClient;
import com.wow.signlanguage.service.OpenAiMorphologyNormalizerService;
import com.wow.signlanguage.service.OpenAiMorphologyNormalizerService.MorphologyNormalizationResult;
import com.wow.signlanguage.service.SignSentenceSimplifier;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** OpenAI and ETRI are fakes; the vocabulary is synthetic. */
class GlossTranslatorTests {
  @TempDir Path dir;
  DictionaryLoader videoDictionary = mock(DictionaryLoader.class);
  ExternalLexiconApiClient etri = mock(ExternalLexiconApiClient.class);
  OpenAiMorphologyNormalizerService openAi = mock(OpenAiMorphologyNormalizerService.class);
  SynonymReplacer synonyms = mock(SynonymReplacer.class);
  TextNormalizer normalizer = new TextNormalizer();
  GlossTranslator translator;

  @BeforeEach void setUp() throws Exception {
    translator = translator(WordVocabularyTests.load(dir, """
        {"schema_version": 1,
         "mapping": {"고향": "WORD0001", "친구": "WORD0002", "만나다": "WORD0003", "화장실": "WORD0004"},
         "ambiguous": {"눈": ["WORD0005", "WORD0006"]}}
        """));
    when(etri.fetchSentenceLemmas(anyString())).thenReturn(List.of());
    when(openAi.normalize(anyString())).thenReturn(Optional.empty());
    // Default: the synonym step changes nothing (as with no cache or no API key).
    when(synonyms.replace(anyString(), anyList()))
        .thenAnswer(call -> SynonymReplacer.Result.unchanged(call.getArgument(1)));
  }

  GlossTranslator translator(WordVocabulary vocabulary) {
    return new GlossTranslator(vocabulary, normalizer, new SignSentenceSimplifier(normalizer, videoDictionary),
        etri, openAi, synonyms);
  }

  void openAiSays(String... tokens) {
    when(openAi.normalize(anyString())).thenReturn(Optional.of(
        new MorphologyNormalizationResult(String.join(" ", tokens), List.of(tokens), "present")));
  }

  @Test void outOfVocabularyWordsPassThroughWithoutSpellingSubstitution() {
    openAiSays("고양이", "친구", "만나다");
    GlossTranslator.Gloss gloss = translator.translate("고양이가 친구를 만났다");
    // 고양이 must not become 고향 (shared first syllable); the generator reports it as unknown.
    assertThat(gloss.words()).containsExactly("고양이", "친구", "만나다");
    assertThat(gloss.question()).isFalse();
  }

  @Test void neverConsultsTheVideoDictionary() {
    openAiSays("친구", "화장실");
    translator.translate("친구 화장실");
    verifyNoInteractions(videoDictionary);
  }

  @Test void ambiguousWordsPassThroughUnchanged() {
    openAiSays("눈", "오다");
    assertThat(translator.translate("눈이 와요").words()).containsExactly("눈", "오다");
  }

  @Test void choosesTheStreamWithMoreDrawableWords() {
    openAiSays("고양이", "친구");
    when(etri.fetchSentenceLemmas(anyString())).thenReturn(List.of("고향", "친구"));
    assertThat(translator.translate("문장").words()).containsExactly("고향", "친구");
  }

  @Test void tiePrefersOpenAi() {
    openAiSays("친구", "가다");
    when(etri.fetchSentenceLemmas(anyString())).thenReturn(List.of("친구", "오다"));
    assertThat(translator.translate("문장").words()).containsExactly("친구", "가다");
  }

  @Test void ambiguousWordsDoNotCountAsDrawable() {
    openAiSays("친구", "고양이");
    when(etri.fetchSentenceLemmas(anyString())).thenReturn(List.of("눈", "고양이"));
    assertThat(translator.translate("문장").words()).containsExactly("친구", "고양이");
  }

  @Test void rulesAreTheFallbackAndKeepTheQuestionFlag() {
    GlossTranslator.Gloss gloss = translator.translate("친구?");
    assertThat(gloss.words()).containsExactly("친구");
    assertThat(gloss.question()).isTrue();
  }

  @Test void synonymStepRunsOnTheChosenStreamWithTheOriginalSentence() {
    openAiSays("변소", "가다");
    when(synonyms.replace("변소 가고 싶어", List.of("변소", "가다"))).thenReturn(new SynonymReplacer.Result(
        List.of("화장실", "가다"), List.of(new SynonymReplacer.Replacement("변소", "화장실"))));
    GlossTranslator.Gloss gloss = translator.translate("변소 가고 싶어");
    assertThat(gloss.words()).containsExactly("화장실", "가다");
    assertThat(gloss.replacements()).containsExactly(new SynonymReplacer.Replacement("변소", "화장실"));
  }

  @Test void streamIsChosenBeforeSynonymsAreApplied() {
    // ETRI already has more drawable words; the synonym step must not change which stream wins.
    openAiSays("변소", "친구");
    when(etri.fetchSentenceLemmas(anyString())).thenReturn(List.of("화장실", "친구"));
    translator.translate("문장");
    verify(synonyms).replace("문장", List.of("화장실", "친구"));
  }

  @Test void noReplacementsByDefault() {
    openAiSays("고양이", "친구");
    assertThat(translator.translate("문장").replacements()).isEmpty();
  }

  @Test void missingVocabularyFailsBeforeAnyExternalCall() {
    GlossTranslator unavailable = translator(new WordVocabulary("", new ObjectMapper()));
    assertThatThrownBy(() -> unavailable.translate("친구"))
        .isInstanceOf(GlossTranslator.VocabularyUnavailable.class);
    verifyNoInteractions(etri, openAi, synonyms);
  }
}
