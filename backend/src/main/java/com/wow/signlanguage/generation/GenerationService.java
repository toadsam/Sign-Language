package com.wow.signlanguage.generation;

import org.springframework.stereotype.Service;

@Service
public class GenerationService {
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
}
