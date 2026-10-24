package com.wow.signlanguage.generation;

import com.wow.signlanguage.service.TranslationService;
import com.wow.signlanguage.translate.TranslatePlaybackItem;
import com.wow.signlanguage.translate.TranslateResponse;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

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
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid text");
    }
    TranslateResponse translated;
    try {
      translated = translation.translate(text);
      if (translated == null || translated.normalizedTokens() == null || translated.items() == null
          || translated.unknown() == null || translated.normalizedTokens().stream()
              .anyMatch(token -> token == null || token.isBlank())) {
        throw new IllegalStateException();
      }
    } catch (RuntimeException error) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Translation unavailable");
    }
    if (!translated.normalizedTokens().isEmpty()) {
      try {
        return inference.generate(translated.normalizedTokens(),
            translated.metadata() != null && translated.metadata().question());
      } catch (InferenceClient.InferenceUnavailable error) {
        // Preserve the original items, including hasVideo=false; never synthesize clips.
      }
    }
    return new VideoResponse("video", translated.items(), translated.unknown());
  }

  public record VideoResponse(String source, List<TranslatePlaybackItem> items, List<String> unknown) {}
}
