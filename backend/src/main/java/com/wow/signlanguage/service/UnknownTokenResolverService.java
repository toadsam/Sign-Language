package com.wow.signlanguage.service;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.normalizer.TextNormalizer;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class UnknownTokenResolverService {

  private final ExternalLexiconApiClient externalLexiconApiClient;
  private final DictionaryLoader dictionaryLoader;
  private final TextNormalizer textNormalizer;

  public UnknownTokenResolverService(
      ExternalLexiconApiClient externalLexiconApiClient,
      DictionaryLoader dictionaryLoader,
      TextNormalizer textNormalizer
  ) {
    this.externalLexiconApiClient = externalLexiconApiClient;
    this.dictionaryLoader = dictionaryLoader;
    this.textNormalizer = textNormalizer;
  }

  public Optional<String> resolveToken(String unknownToken) {
    Set<String> dictionaryWords = dictionaryLoader.entries()
        .stream()
        .map(entry -> entry.word().trim())
        .collect(Collectors.toSet());

    List<String> candidates = externalLexiconApiClient.fetchCandidates(unknownToken);
    for (String candidate : candidates) {
      String normalized = textNormalizer.normalizeToken(candidate);
      if (dictionaryWords.contains(normalized)) {
        return Optional.of(normalized);
      }
    }
    return Optional.empty();
  }
}
