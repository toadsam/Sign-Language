package com.wow.signlanguage.service;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.dictionary.SignDictionaryEntry;
import com.wow.signlanguage.normalizer.TextNormalizer;
import com.wow.signlanguage.translate.ClipMatch;
import com.wow.signlanguage.translate.SimplificationResult;
import com.wow.signlanguage.translate.TranslateResponse;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class TranslationService {

  private final TextNormalizer textNormalizer;
  private final DictionaryLoader dictionaryLoader;
  private final SignSentenceSimplifier signSentenceSimplifier;
  private final UnknownTokenResolverService unknownTokenResolverService;

  public TranslationService(
      TextNormalizer textNormalizer,
      DictionaryLoader dictionaryLoader,
      SignSentenceSimplifier signSentenceSimplifier,
      UnknownTokenResolverService unknownTokenResolverService
  ) {
    this.textNormalizer = textNormalizer;
    this.dictionaryLoader = dictionaryLoader;
    this.signSentenceSimplifier = signSentenceSimplifier;
    this.unknownTokenResolverService = unknownTokenResolverService;
  }

  public TranslateResponse translate(String input) {
    String safeInput = input == null ? "" : input;
    SimplificationResult simplification = signSentenceSimplifier.simplify(safeInput);
    List<String> tokens = simplification.tokens().stream()
        .map(textNormalizer::normalizeToken)
        .filter(token -> !token.isBlank())
        .toList();
    List<String> resolvedTokens = new ArrayList<>();
    for (String token : tokens) {
      if (dictionaryLoader.findByWord(token).isPresent()) {
        resolvedTokens.add(token);
        continue;
      }

      String resolved = unknownTokenResolverService.resolveToken(token).orElse(token);
      resolvedTokens.add(resolved);
    }

    List<ClipMatch> clips = new ArrayList<>();
    List<String> unknown = new ArrayList<>();

    for (String token : resolvedTokens) {
      SignDictionaryEntry entry = dictionaryLoader.findByWord(token).orElse(null);
      if (entry == null) {
        unknown.add(token);
        continue;
      }

      clips.add(new ClipMatch(
          token,
          entry.id(),
          entry.file(),
          "/clips/" + entry.file()
      ));
    }

    return new TranslateResponse(
        safeInput,
        simplification.simplifiedSentence(),
        resolvedTokens,
        simplification.appliedRules(),
        simplification.metadata(),
        clips,
        unknown
    );
  }
}
