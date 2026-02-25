package com.wow.signlanguage.normalizer;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class TextNormalizer {

  private static final Map<String, String> REPLACEMENTS = buildReplacements();
  private final DictionaryLoader dictionaryLoader;

  public TextNormalizer(DictionaryLoader dictionaryLoader) {
    this.dictionaryLoader = dictionaryLoader;
  }

  public List<String> normalizeTokens(String input) {
    if (input == null || input.isBlank()) {
      return List.of();
    }

    String cleaned = input
        .replaceAll("[\\p{Punct}！？。，、·]+", " ")
        .trim();

    if (cleaned.isEmpty()) {
      return List.of();
    }

    String[] rawTokens = cleaned.split("\\s+");
    List<String> normalized = new ArrayList<>();

    for (String raw : rawTokens) {
      String token = normalizeToken(raw);
      if (!token.isBlank()) {
        normalized.add(token);
      }
    }

    return normalized;
  }

  private String normalizeToken(String rawToken) {
    String token = rawToken.trim();
    if (token.isEmpty()) {
      return "";
    }

    String mapped = REPLACEMENTS.get(token);
    if (mapped != null && dictionaryLoader.containsWord(mapped)) {
      return mapped;
    }

    return token;
  }

  private static Map<String, String> buildReplacements() {
    Map<String, String> map = new LinkedHashMap<>();

    map.put("있어", "있다");
    map.put("있어요", "있다");
    map.put("있냐", "있다");
    map.put("있나요", "있다");
    map.put("있지", "있다");

    map.put("없어", "없다");
    map.put("없어요", "없다");
    map.put("없냐", "없다");
    map.put("없나요", "없다");

    map.put("가", "가다");
    map.put("가요", "가다");
    map.put("가자", "가다");
    map.put("갈래", "가다");
    map.put("갑니다", "가다");

    map.put("와", "오다");
    map.put("와요", "오다");
    map.put("오세요", "오다");
    map.put("옵니다", "오다");

    map.put("어딨어", "어디");
    map.put("어디야", "어디");
    map.put("지금은", "지금");
    map.put("지하철역은", "지하철역");
    map.put("왼쪽으로", "왼쪽");
    map.put("오른쪽으로", "오른쪽");

    map.put("가서", "가다");
    map.put("건너", "건너다");
    map.put("건너요", "건너다");
    map.put("가능해", "가능");
    map.put("가능해요", "가능");

    return map;
  }
}
