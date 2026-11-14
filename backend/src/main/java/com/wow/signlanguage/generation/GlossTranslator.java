package com.wow.signlanguage.generation;

import com.wow.signlanguage.normalizer.TextNormalizer;
import com.wow.signlanguage.service.ExternalLexiconApiClient;
import com.wow.signlanguage.service.OpenAiMorphologyNormalizerService;
import com.wow.signlanguage.service.SignSentenceSimplifier;
import com.wow.signlanguage.translate.SimplificationResult;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Sentence -> gloss for motion generation, judged against the word GPT vocabulary.
 * Unlike TranslationService (/translate), it never consults the 120-word video dictionary
 * and never swaps a word for a similarly spelled one. A word outside the table becomes a drawable word only
 * when {@link SynonymReplacer} finds one with the same meaning; otherwise it passes through unchanged so the
 * generator reports it as unknown.
 */
@Service
public class GlossTranslator {
  private static final Logger log = LoggerFactory.getLogger(GlossTranslator.class);

  /** {@code replacements} is for logs only; it never reaches the /generate response (contract 5). */
  public record Gloss(List<String> words, boolean question, List<SynonymReplacer.Replacement> replacements) {
    public Gloss(List<String> words, boolean question) {
      this(words, question, List.of());
    }
  }

  /** The vocabulary file was missing or unreadable at startup. */
  public static final class VocabularyUnavailable extends RuntimeException {
    VocabularyUnavailable() { super("word vocabulary unavailable"); }
  }

  private final WordVocabulary vocabulary;
  private final TextNormalizer textNormalizer;
  private final SignSentenceSimplifier simplifier;
  private final ExternalLexiconApiClient etri;
  private final OpenAiMorphologyNormalizerService openAi;
  private final SynonymReplacer synonyms;

  public GlossTranslator(WordVocabulary vocabulary, TextNormalizer textNormalizer, SignSentenceSimplifier simplifier,
                         ExternalLexiconApiClient etri, OpenAiMorphologyNormalizerService openAi,
                         SynonymReplacer synonyms) {
    this.vocabulary = vocabulary;
    this.textNormalizer = textNormalizer;
    this.simplifier = simplifier;
    this.etri = etri;
    this.openAi = openAi;
    this.synonyms = synonyms;
  }

  public Gloss translate(String text) {
    if (!vocabulary.available()) throw new VocabularyUnavailable();
    SimplificationResult rule = simplifier.simplify(text, vocabulary::contains);
    List<String> ruleTokens = normalize(rule.tokens());
    List<String> etriTokens = normalize(etri.fetchSentenceLemmas(text));
    List<String> openAiTokens = openAi.normalize(text).map(result -> normalize(result.tokens())).orElse(List.of());
    SynonymReplacer.Result replaced = synonyms.replace(text, choose(ruleTokens, etriTokens, openAiTokens));
    if (!replaced.replacements().isEmpty()) {
      log.info("Generation gloss synonyms: {}", replaced.replacements().stream()
          .map(r -> r.from() + "->" + r.to()).collect(Collectors.joining(", ")));
    }
    return new Gloss(new ArrayList<>(replaced.words()), rule.metadata().question(), replaced.replacements());
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
