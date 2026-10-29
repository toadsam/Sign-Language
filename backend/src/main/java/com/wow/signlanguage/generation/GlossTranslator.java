package com.wow.signlanguage.generation;

import com.wow.signlanguage.normalizer.TextNormalizer;
import com.wow.signlanguage.service.ExternalLexiconApiClient;
import com.wow.signlanguage.service.OpenAiMorphologyNormalizerService;
import com.wow.signlanguage.service.SignSentenceSimplifier;
import com.wow.signlanguage.translate.SimplificationResult;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Sentence -> gloss for motion generation, judged against the word GPT vocabulary.
 * Unlike TranslationService (/translate), it never consults the 120-word video dictionary
 * and never swaps a word for a similarly spelled one; words outside the table pass through
 * unchanged so the generator reports them as unknown.
 */
@Service
public class GlossTranslator {
  public record Gloss(List<String> words, boolean question) {}

  /** The vocabulary file was missing or unreadable at startup. */
  public static final class VocabularyUnavailable extends RuntimeException {
    VocabularyUnavailable() { super("word vocabulary unavailable"); }
  }

  private final WordVocabulary vocabulary;
  private final TextNormalizer textNormalizer;
  private final SignSentenceSimplifier simplifier;
  private final ExternalLexiconApiClient etri;
  private final OpenAiMorphologyNormalizerService openAi;

  public GlossTranslator(WordVocabulary vocabulary, TextNormalizer textNormalizer, SignSentenceSimplifier simplifier,
                         ExternalLexiconApiClient etri, OpenAiMorphologyNormalizerService openAi) {
    this.vocabulary = vocabulary;
    this.textNormalizer = textNormalizer;
    this.simplifier = simplifier;
    this.etri = etri;
    this.openAi = openAi;
  }

  public Gloss translate(String text) {
    if (!vocabulary.available()) throw new VocabularyUnavailable();
    SimplificationResult rule = simplifier.simplify(text, vocabulary::contains);
    List<String> ruleTokens = normalize(rule.tokens());
    List<String> etriTokens = normalize(etri.fetchSentenceLemmas(text));
    List<String> openAiTokens = openAi.normalize(text).map(result -> normalize(result.tokens())).orElse(List.of());
    return new Gloss(choose(ruleTokens, etriTokens, openAiTokens), rule.metadata().question());
  }

  private List<String> normalize(List<String> tokens) {
    if (tokens == null) return List.of();
    return tokens.stream().filter(token -> token != null)
        .map(textNormalizer::normalizeToken).filter(token -> !token.isBlank()).toList();
  }

  /** Most drawable words wins; ties prefer OpenAI, then ETRI, then the rules (same order as /translate). */
  private List<String> choose(List<String> rule, List<String> etriTokens, List<String> openAiTokens) {
    List<String> best = List.of();
    int bestHits = -1;
    for (List<String> tokens : List.of(openAiTokens, etriTokens, rule)) {
      if (tokens.isEmpty()) continue;
      int hits = (int) tokens.stream().filter(vocabulary::isMapped).count();
      if (hits > bestHits) {
        best = tokens;
        bestHits = hits;
      }
    }
    return new ArrayList<>(best);
  }
}
