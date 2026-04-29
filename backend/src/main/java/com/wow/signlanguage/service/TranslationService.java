package com.wow.signlanguage.service;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.dictionary.SignDictionaryEntry;
import com.wow.signlanguage.normalizer.TextNormalizer;
import com.wow.signlanguage.service.OpenAiMorphologyNormalizerService.MorphologyNormalizationResult;
import com.wow.signlanguage.storage.StorageVideoCache;
import com.wow.signlanguage.translate.ClipMatch;
import com.wow.signlanguage.translate.SimplificationResult;
import com.wow.signlanguage.translate.TranslateResponse;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class TranslationService {

  private final TextNormalizer textNormalizer;
  private final DictionaryLoader dictionaryLoader;
  private final SignSentenceSimplifier signSentenceSimplifier;
  private final UnknownTokenResolverService unknownTokenResolverService;
  private final ExternalLexiconApiClient externalLexiconApiClient;
  private final OpenAiMorphologyNormalizerService openAiMorphologyNormalizerService;
  private final StorageVideoCache storageVideoCache;

  public TranslationService(
      TextNormalizer textNormalizer,
      DictionaryLoader dictionaryLoader,
      SignSentenceSimplifier signSentenceSimplifier,
      UnknownTokenResolverService unknownTokenResolverService,
      ExternalLexiconApiClient externalLexiconApiClient,
      OpenAiMorphologyNormalizerService openAiMorphologyNormalizerService,
      StorageVideoCache storageVideoCache
  ) {
    this.textNormalizer = textNormalizer;
    this.dictionaryLoader = dictionaryLoader;
    this.signSentenceSimplifier = signSentenceSimplifier;
    this.unknownTokenResolverService = unknownTokenResolverService;
    this.externalLexiconApiClient = externalLexiconApiClient;
    this.openAiMorphologyNormalizerService = openAiMorphologyNormalizerService;
    this.storageVideoCache = storageVideoCache;
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
    Optional<MorphologyNormalizationResult> openAiResult = openAiMorphologyNormalizerService.normalize(safeInput);
    List<String> openAiTokens = openAiResult.stream()
        .flatMap(result -> result.tokens().stream())
        .map(textNormalizer::normalizeToken)
        .filter(token -> !token.isBlank())
        .toList();
    TokenStreamChoice tokenChoice = chooseTokenStream(ruleTokens, etriTokens, openAiTokens);
    List<String> tokens = tokenChoice.tokens();
    List<String> resolvedTokens = resolveTokens(tokens, mergeContextTokens(etriTokens, openAiTokens));

    List<ClipMatch> clips = new ArrayList<>();
    List<String> unknown = new ArrayList<>();
    List<String> noVideoWords = new ArrayList<>();

    for (String token : resolvedTokens) {
      SignDictionaryEntry entry = dictionaryLoader.findByWord(token).orElse(null);
      String storageUrl = storageVideoCache.findUrl(token);
      if (storageUrl != null && !storageUrl.isBlank()) {
        clips.add(new ClipMatch(
            token,
            entry == null ? 0 : entry.id(),
            entry == null ? "" : entry.file(),
            storageUrl
        ));
        continue;
      }

      if (entry == null) {
        // 사전에 없는 단어 → unknown
        unknown.add(token);
        continue;
      }

      // 사전에는 있음 → Firebase Storage에서 영상 URL 조회
      if (storageUrl == null || storageUrl.isBlank()) {
        // 사전엔 있지만 Storage에 영상 없음 → noVideoWords
        noVideoWords.add(token);
        continue;
      }

      clips.add(new ClipMatch(
          token,
          entry.id(),
          entry.file(),
          storageUrl
      ));
    }

    return new TranslateResponse(
        safeInput,
        buildSimplifiedSentence(simplification, openAiResult, tokenChoice.source()),
        resolvedTokens,
        buildAppliedRules(simplification.appliedRules(), openAiResult.isPresent(), tokenChoice.source()),
        simplification.metadata(),
        clips,
        unknown,
        noVideoWords
    );
  }

  private TokenStreamChoice chooseTokenStream(List<String> ruleTokens, List<String> etriTokens, List<String> openAiTokens) {
    List<TokenStreamChoice> choices = new ArrayList<>();
    if (ruleTokens != null && !ruleTokens.isEmpty()) {
      choices.add(new TokenStreamChoice("rule", ruleTokens));
    }
    if (etriTokens != null && !etriTokens.isEmpty()) {
      choices.add(new TokenStreamChoice("etri", etriTokens));
    }
    if (openAiTokens != null && !openAiTokens.isEmpty()) {
      choices.add(new TokenStreamChoice("openai", openAiTokens));
    }

    if (choices.isEmpty()) {
      return new TokenStreamChoice("rule", List.of());
    }

    TokenStreamChoice best = choices.get(0);
    int bestHits = countDictionaryHits(best.tokens());
    for (TokenStreamChoice choice : choices.subList(1, choices.size())) {
      int hits = countDictionaryHits(choice.tokens());
      if (hits > bestHits || (hits == bestHits && shouldPreferTie(choice.source(), best.source()))) {
        best = choice;
        bestHits = hits;
      }
    }
    return best;
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

  private List<String> mergeContextTokens(List<String> first, List<String> second) {
    LinkedHashSet<String> merged = new LinkedHashSet<>();
    if (first != null) {
      merged.addAll(first);
    }
    if (second != null) {
      merged.addAll(second);
    }
    return new ArrayList<>(merged);
  }

  private boolean shouldPreferTie(String candidateSource, String currentSource) {
    return sourcePriority(candidateSource) > sourcePriority(currentSource);
  }

  private int sourcePriority(String source) {
    return switch (source) {
      case "openai" -> 3;
      case "etri" -> 2;
      default -> 1;
    };
  }

  private String buildSimplifiedSentence(
      SimplificationResult simplification,
      Optional<MorphologyNormalizationResult> openAiResult,
      String source
  ) {
    if ("openai".equals(source) && openAiResult.isPresent()) {
      String simplifiedSentence = openAiResult.get().simplifiedSentence();
      if (simplifiedSentence != null && !simplifiedSentence.isBlank()) {
        return simplifiedSentence;
      }
    }
    return simplification.simplifiedSentence();
  }

  private List<String> buildAppliedRules(List<String> baseRules, boolean openAiAvailable, String source) {
    LinkedHashSet<String> rules = new LinkedHashSet<>();
    if (baseRules != null) {
      rules.addAll(baseRules);
    }
    if (openAiAvailable) {
      rules.add("openai_morphology_normalization");
    }
    if ("openai".equals(source)) {
      rules.add("openai_token_stream");
    }
    return new ArrayList<>(rules);
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
    if (fileName == null || fileName.isBlank()) {
      return "";
    }

    String trimmed = fileName.trim();
    if (trimmed.toLowerCase().endsWith(".mp4")) {
      return "/choicemp4/" + trimmed;
    }

    return "/clips/" + trimmed;
  }

  private record TokenStreamChoice(String source, List<String> tokens) {
  }
}
