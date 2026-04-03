package com.wow.signlanguage.service;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.dictionary.SignDictionaryEntry;
import com.wow.signlanguage.normalizer.TextNormalizer;
import com.wow.signlanguage.translate.ClipMatch;
import com.wow.signlanguage.translate.SimplificationResult;
import com.wow.signlanguage.translate.TranslateResponse;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class TranslationService {
  private static final String[] TEST_AVATAR_FILES = {
      "테스트아바타.mp4",
      "테스트아바타2.mp4"
  };

  private final TextNormalizer textNormalizer;
  private final DictionaryLoader dictionaryLoader;
  private final SignSentenceSimplifier signSentenceSimplifier;
  private final UnknownTokenResolverService unknownTokenResolverService;
  private final ExternalLexiconApiClient externalLexiconApiClient;

  public TranslationService(
      TextNormalizer textNormalizer,
      DictionaryLoader dictionaryLoader,
      SignSentenceSimplifier signSentenceSimplifier,
      UnknownTokenResolverService unknownTokenResolverService,
      ExternalLexiconApiClient externalLexiconApiClient
  ) {
    this.textNormalizer = textNormalizer;
    this.dictionaryLoader = dictionaryLoader;
    this.signSentenceSimplifier = signSentenceSimplifier;
    this.unknownTokenResolverService = unknownTokenResolverService;
    this.externalLexiconApiClient = externalLexiconApiClient;
  }

  public TranslateResponse translate(String input) {
    String safeInput = input == null ? "" : input;
    SimplificationResult simplification = signSentenceSimplifier.simplify(safeInput);
    List<String> ruleTokens = simplification.tokens().stream()
        .map(textNormalizer::normalizeToken)
        .filter(token -> !token.isBlank())
        .toList();
    List<String> etriTokens = externalLexiconApiClient.fetchSentenceLemmas(safeInput).stream()
        .map(textNormalizer::normalizeToken)
        .filter(token -> !token.isBlank())
        .toList();
    List<String> tokens = chooseTokenStream(ruleTokens, etriTokens);
    List<String> resolvedTokens = resolveTokens(tokens, etriTokens);

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
          buildClipUrl(entry.file())
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

  private List<String> chooseTokenStream(List<String> ruleTokens, List<String> etriTokens) {
    if (etriTokens == null || etriTokens.isEmpty()) {
      return ruleTokens;
    }
    if (ruleTokens == null || ruleTokens.isEmpty()) {
      return etriTokens;
    }

    int ruleHits = countDictionaryHits(ruleTokens);
    int etriHits = countDictionaryHits(etriTokens);
    return etriHits > ruleHits ? etriTokens : ruleTokens;
  }

  private int countDictionaryHits(List<String> tokens) {
    int hits = 0;
    for (String token : tokens) {
      if (dictionaryLoader.findByWord(token).isPresent()) {
        hits++;
      }
    }
    return hits;
  }

  private List<String> resolveTokens(List<String> tokens, List<String> contextTokens) {
    List<String> resolvedTokens = new ArrayList<>();
    List<String> contextDictionaryWords = buildContextDictionaryWords(contextTokens);

    for (String token : tokens) {
      if (dictionaryLoader.findByWord(token).isPresent()) {
        resolvedTokens.add(token);
        continue;
      }

      String resolved = unknownTokenResolverService.resolveToken(token).orElse(null);
      if (resolved == null || resolved.isBlank()) {
        resolved = pickBestContextMatch(token, contextDictionaryWords).orElse(token);
      }
      resolvedTokens.add(resolved);
    }
    return resolvedTokens;
  }

  private List<String> buildContextDictionaryWords(List<String> contextTokens) {
    if (contextTokens == null || contextTokens.isEmpty()) {
      return List.of();
    }

    Set<String> contextWords = new LinkedHashSet<>();
    for (String contextToken : contextTokens) {
      if (contextToken == null || contextToken.isBlank()) {
        continue;
      }

      if (dictionaryLoader.findByWord(contextToken).isPresent()) {
        contextWords.add(contextToken);
        continue;
      }

      String resolved = unknownTokenResolverService.resolveToken(contextToken).orElse(null);
      if (resolved != null && !resolved.isBlank() && dictionaryLoader.findByWord(resolved).isPresent()) {
        contextWords.add(resolved);
      }
    }
    return new ArrayList<>(contextWords);
  }

  private java.util.Optional<String> pickBestContextMatch(String token, List<String> contextWords) {
    if (token == null || token.isBlank() || contextWords == null || contextWords.isEmpty()) {
      return java.util.Optional.empty();
    }

    int bestScore = Integer.MIN_VALUE;
    String best = null;
    for (String candidate : contextWords) {
      int score = similarityScore(token, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best == null || bestScore < 2) {
      return java.util.Optional.empty();
    }
    return java.util.Optional.of(best);
  }

  private int similarityScore(String source, String candidate) {
    if (source.equals(candidate)) {
      return 100;
    }

    int score = 0;
    if (source.startsWith(candidate) || candidate.startsWith(source)) {
      score += 4;
    }
    if (source.contains(candidate) || candidate.contains(source)) {
      score += 3;
    }

    score += commonPrefixLength(source, candidate) * 2;
    score += commonSuffixLength(source, candidate);
    return score;
  }

  private int commonPrefixLength(String a, String b) {
    int max = Math.min(a.length(), b.length());
    int idx = 0;
    while (idx < max && a.charAt(idx) == b.charAt(idx)) {
      idx++;
    }
    return idx;
  }

  private int commonSuffixLength(String a, String b) {
    int ai = a.length() - 1;
    int bi = b.length() - 1;
    int count = 0;
    while (ai >= 0 && bi >= 0 && a.charAt(ai) == b.charAt(bi)) {
      count++;
      ai--;
      bi--;
    }
    return count;
  }

  private String buildClipUrl(String fileName) {
    String seed = fileName == null ? "" : fileName.trim();
    int index = Math.floorMod(seed.hashCode(), TEST_AVATAR_FILES.length);
    return "/choicemp4/" + TEST_AVATAR_FILES[index];
  }
}
