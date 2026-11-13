package com.wow.signlanguage.generation;

import com.wow.signlanguage.service.TranslationService;
import com.wow.signlanguage.translate.TranslateResponse;
import org.springframework.stereotype.Service;

@Service
public class GenerationService {
  private final TranslationService translation;
  private final InferenceClient inference;
  private final GenerationSettings settings;

  public GenerationService(TranslationService translation, InferenceClient inference, GenerationSettings settings) {
    this.translation = translation;
    this.inference = inference;
    this.settings = settings;
  }

  public Object generate(String text) {
    if (text == null || text.isBlank() || text.length() > settings.maxTextChars()) {
      throw new GenerationFailure(GenerationFailure.Reason.INVALID_REQUEST);
    }
    TranslateResponse translated;
    try {
      translated = translation.translate(text);
      if (translated == null) throw new IllegalStateException();
    } catch (RuntimeException error) {
      throw new GenerationFailure(GenerationFailure.Reason.TRANSLATION_UNAVAILABLE);
    }
    if (translated.normalizedTokens() == null || translated.normalizedTokens().isEmpty()
        || translated.normalizedTokens().stream().anyMatch(token -> token == null || token.isBlank())) {
      throw new GenerationFailure(GenerationFailure.Reason.NO_GENERATABLE_INPUT);
    }
    return inference.generate(translated.normalizedTokens(),
        translated.metadata() != null && translated.metadata().question());
  }
}
