package com.wow.signlanguage.generation;

import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class GenerationService {
  /** Same as the inference server's max_words (ml/serve/settings.py). */
  static final int MAX_WORDS = 128;
  private final GlossTranslator translator;
  private final InferenceClient inference;
  private final GenerationSettings settings;

  public GenerationService(GlossTranslator translator, InferenceClient inference, GenerationSettings settings) {
    this.translator = translator;
    this.inference = inference;
    this.settings = settings;
  }

  public Object generate(String text) {
    if (text == null || text.isBlank() || text.length() > settings.maxTextChars()) {
      throw new GenerationFailure(GenerationFailure.Reason.INVALID_REQUEST);
    }
    if (settings.serveTranslator()) {
      return generateWithServeTranslator(text);
    }
    GlossTranslator.Gloss gloss;
    try {
      gloss = translator.translate(text);
      if (gloss == null) throw new IllegalStateException();
    } catch (GlossTranslator.VocabularyUnavailable error) {
      throw new GenerationFailure(GenerationFailure.Reason.GENERATION_UNAVAILABLE);
    } catch (RuntimeException error) {
      throw new GenerationFailure(GenerationFailure.Reason.TRANSLATION_UNAVAILABLE);
    }
    if (gloss.words() == null || gloss.words().isEmpty()
        || gloss.words().stream().anyMatch(word -> word == null || word.isBlank())) {
      throw new GenerationFailure(GenerationFailure.Reason.NO_GENERATABLE_INPUT);
    }
    return inference.generate(gloss.words(), gloss.question());
  }

  /**
   * Serve mode: the inference server's own translator. Its {@code unknown} fragments (not in the gloss table) are
   * appended after the gloss so they come back in the response {@code unknown}, as in the word mode.
   */
  private Object generateWithServeTranslator(String text) {
    InferenceClient.Translation translation = inference.translate(text);
    List<String> words = new ArrayList<>(translation.gloss());
    translation.unknown().stream().filter(word -> !word.isBlank()).forEach(words::add);
    if (words.isEmpty() || words.size() > MAX_WORDS) {
      throw new GenerationFailure(GenerationFailure.Reason.NO_GENERATABLE_INPUT);
    }
    String trimmed = text.strip();
    return inference.generate(words, trimmed.endsWith("?") || trimmed.endsWith("\uFF1F"));
  }
}
