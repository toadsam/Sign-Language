package com.wow.signlanguage.service;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.normalizer.TextNormalizer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Queue;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class FastLemmaResolverService {

  private static final List<String> STRIPPABLE_SUFFIXES = List.of(
      "고있다가", "고있었던", "고있었다", "고있었", "고있는", "고있다", "고있어",
      "고다가", "고", "다가", "는중이다", "는중", "면서", "지만", "는데", "니까",
      "려고", "려다", "려고하다", "어야", "아야", "해야", "하여", "해서", "하며",
      "하고", "해도", "해요", "했다가", "했더니", "했는데", "했으니", "했지만",
      "했었다가", "했었다", "했었어", "했었", "했다", "했어", "해",
      "었을것이다", "았을것이다", "였을것이다", "을것이다", "ㄹ것이다",
      "었겠다", "았겠다", "겠지", "겠다", "겠", "었던", "았던", "였던",
      "었는", "았는", "였는", "어서", "아서", "였다", "였다가", "였다면",
      "었다", "았다", "었어", "았어", "어요", "아요", "어", "아",
      "는", "은", "ㄴ", "을", "ㄹ", "다"
  );

  private final DictionaryLoader dictionaryLoader;
  private final TextNormalizer textNormalizer;

  public FastLemmaResolverService(DictionaryLoader dictionaryLoader, TextNormalizer textNormalizer) {
    this.dictionaryLoader = dictionaryLoader;
    this.textNormalizer = textNormalizer;
  }

  public List<String> resolveTokens(List<String> tokens) {
    if (tokens == null || tokens.isEmpty()) {
      return List.of();
    }

    List<String> resolved = new ArrayList<>();
    for (String token : tokens) {
      resolved.add(resolveToken(token).orElse(token));
    }
    return resolved;
  }

  public Optional<String> resolveToken(String token) {
    if (token == null || token.isBlank()) {
      return Optional.empty();
    }

    String normalized = textNormalizer.normalizeToken(token);
    if (dictionaryLoader.findByWord(normalized).isPresent()) {
      return Optional.of(normalized);
    }

    Set<String> dictionaryWords = dictionaryLoader.entries()
        .stream()
        .map(entry -> entry.word().trim())
        .collect(Collectors.toSet());

    for (String candidate : buildCandidates(normalized)) {
      String normalizedCandidate = textNormalizer.normalizeToken(candidate);
      if (dictionaryWords.contains(normalizedCandidate)) {
        return Optional.of(normalizedCandidate);
      }
      if (dictionaryWords.contains(candidate)) {
        return Optional.of(candidate);
      }
    }

    return Optional.empty();
  }

  public boolean canResolveToken(String token) {
    return resolveToken(token).isPresent();
  }

  private List<String> buildCandidates(String token) {
    LinkedHashSet<String> candidates = new LinkedHashSet<>();
    Queue<String> queue = new ArrayDeque<>();
    queue.add(token);

    int depth = 0;
    while (!queue.isEmpty() && depth < 4) {
      int size = queue.size();
      for (int i = 0; i < size; i++) {
        String current = queue.poll();
        if (current == null || current.isBlank()) {
          continue;
        }

        candidates.add(current);
        addStemVariants(current, candidates);

        for (String suffix : STRIPPABLE_SUFFIXES) {
          if (current.endsWith(suffix) && current.length() > suffix.length()) {
            String stem = current.substring(0, current.length() - suffix.length());
            if (!stem.isBlank() && candidates.add(stem)) {
              queue.add(stem);
            }
          }
        }
      }
      depth++;
    }

    return new ArrayList<>(candidates);
  }

  private void addStemVariants(String stem, Set<String> candidates) {
    candidates.add(stem + "다");

    switch (stem) {
      case "하", "해", "했", "했었" -> candidates.add("하다");
      case "되", "돼", "됐" -> candidates.add("되다");
      case "가", "갔" -> candidates.add("가다");
      case "오", "와", "왔" -> candidates.add("오다");
      case "보", "봐", "봤" -> candidates.add("보다");
      case "주", "줘", "줬" -> candidates.add("주다");
      case "자", "잤" -> candidates.add("자다");
      case "서", "섰" -> candidates.add("서다");
      case "켜", "켰" -> candidates.add("켜다");
      case "끄", "꺼", "껐" -> candidates.add("끄다");
      default -> {
      }
    }
  }
}
