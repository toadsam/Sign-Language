package com.wow.signlanguage.generation;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Step 2 of the generation gloss: swap an out-of-table word for a drawable word only when they mean the same
 * thing in context (변소 -> 화장실, never 고양이 -> 개). Words in the table, including ambiguous ones, are never
 * touched. Per request: at most one embedding call and one chat call. Any doubt or failure keeps the word.
 */
@Service
public class SynonymReplacer {
  private static final Logger log = LoggerFactory.getLogger(SynonymReplacer.class);

  public record Replacement(String from, String to) {}

  public record Result(List<String> words, List<Replacement> replacements) {
    static Result unchanged(List<String> words) {
      return new Result(words, List.of());
    }
  }

  private final SynonymIndex index;
  private final WordVocabulary vocabulary;
  private final OpenAiSynonymClient openAi;
  private final boolean enabled;
  private final int candidates;

  public SynonymReplacer(SynonymIndex index, WordVocabulary vocabulary, OpenAiSynonymClient openAi,
                         @Value("${sign.generation.synonym.enabled:true}") boolean enabled,
                         @Value("${sign.generation.synonym.candidates:10}") int candidates) {
    this.index = index;
    this.vocabulary = vocabulary;
    this.openAi = openAi;
    this.enabled = enabled;
    this.candidates = Math.max(1, candidates);
  }

  public Result replace(String sentence, List<String> words) {
    if (!enabled || !index.available() || !openAi.configured() || words.isEmpty()) return Result.unchanged(words);
    List<String> outside = words.stream().filter(word -> !vocabulary.contains(word)).distinct().toList();
    if (outside.isEmpty()) return Result.unchanged(words);
    try {
      return decide(sentence, words, outside);
    } catch (RuntimeException error) {
      log.warn("Synonym step skipped ({})", error.getClass().getSimpleName());
      return Result.unchanged(words);
    }
  }

  private Result decide(String sentence, List<String> words, List<String> outside) {
    Optional<List<float[]>> vectors = openAi.embed(outside, index.model(), index.dimensions());
    if (vectors.isEmpty() || vectors.get().size() != outside.size()) return Result.unchanged(words);

    Map<String, List<String>> options = new LinkedHashMap<>();
    for (int i = 0; i < outside.size(); i++) {
      List<String> nearest = index.nearest(vectors.get().get(i), candidates);
      if (!nearest.isEmpty()) options.put(outside.get(i), nearest);
    }
    if (options.isEmpty()) return Result.unchanged(words);

    Map<String, String> answers = openAi.choose(sentence, options).orElse(Map.of());
    Map<String, String> accepted = new LinkedHashMap<>();
    options.forEach((word, offered) -> {
      String answer = answers.get(word);
      // Only a word we offered, and still drawable; "none", blanks and invented words keep the original.
      if (answer != null && offered.contains(answer) && vocabulary.isMapped(answer)) accepted.put(word, answer);
    });
    if (accepted.isEmpty()) return Result.unchanged(words);

    List<String> replaced = new ArrayList<>(words.size());
    for (String word : words) replaced.add(accepted.getOrDefault(word, word));
    List<Replacement> replacements = accepted.entrySet().stream()
        .map(entry -> new Replacement(entry.getKey(), entry.getValue())).toList();
    return new Result(replaced, replacements);
  }
}
