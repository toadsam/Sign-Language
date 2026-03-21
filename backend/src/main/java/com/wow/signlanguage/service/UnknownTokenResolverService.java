package com.wow.signlanguage.service;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.normalizer.TextNormalizer;
import java.util.LinkedHashSet;
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
      for (String variant : buildLookupVariants(candidate)) {
        String normalized = textNormalizer.normalizeToken(variant);
        if (dictionaryWords.contains(normalized)) {
          return Optional.of(normalized);
        }
        if (dictionaryWords.contains(variant)) {
          return Optional.of(variant);
        }
      }
    }
    return Optional.empty();
  }

  private List<String> buildLookupVariants(String candidate) {
    if (candidate == null || candidate.isBlank()) {
      return List.of();
    }

    LinkedHashSet<String> variants = new LinkedHashSet<>();
    String base = candidate.trim();
    variants.add(base);

    // API morpheme lemma can be a stem (e.g. "울", "생각하", "부러지").
    // Add dictionary-style predicate forms to improve direct dictionary hits.
    if (!base.endsWith("\uB2E4")) {
      variants.add(base + "\uB2E4");
    }
    if (base.endsWith("\uD558")) {
      variants.add(base + "\uB2E4");
    }
    if (base.endsWith("\uC9C0")) {
      variants.add(base + "\uB2E4");
    }

    return List.copyOf(variants);
  }
}
