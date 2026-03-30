package com.wow.signlanguage.normalizer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class TextNormalizer {

  private static final Map<String, String> REPLACEMENTS = buildReplacements();

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

  public String normalizeToken(String rawToken) {
    String token = rawToken.trim();
    if (token.isEmpty()) {
      return "";
    }

    String predicateNormalized = normalizePredicateEnding(token);
    if (!predicateNormalized.equals(token)) {
      return predicateNormalized;
    }

    String mapped = REPLACEMENTS.get(token);
    if (mapped != null) {
      return mapped;
    }

    return REPLACEMENTS.getOrDefault(token, token);
  }

  private String normalizePredicateEnding(String token) {
    // e.g. 생각한다/생각했는데/생각했었다 -> 생각하다
    String[] hadaEndings = {
        "한다", "한다고", "하는데", "한다면",
        "했다", "했어", "했어요", "했는데", "했다가",
        "했었다", "했었어", "했었어요", "했었는데"
    };
    for (String ending : hadaEndings) {
      if (token.endsWith(ending) && token.length() > ending.length()) {
        return token.substring(0, token.length() - ending.length()) + "하다";
      }
    }

    // e.g. 부러졌다/부러졌는데/부러졌었다 -> 부러지다
    String[] jidaEndings = {
        "졌다", "졌어", "졌어요", "졌는데",
        "졌었다", "졌었어", "졌었어요", "졌었는데"
    };
    for (String ending : jidaEndings) {
      if (token.endsWith(ending) && token.length() > ending.length()) {
        return token.substring(0, token.length() - ending.length()) + "지다";
      }
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
    map.put("가니", "가다");
    map.put("가냐", "가다");

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
    map.put("뭐야", "무엇");
    map.put("뭐예요", "무엇");
    map.put("뭐", "무엇");
    map.put("누구야", "누구");
    map.put("언제야", "언제");
    map.put("왜야", "왜");
    map.put("어떻게야", "어떻게");

    map.put("가서", "가다");
    map.put("건너", "건너다");
    map.put("건너요", "건너다");
    map.put("건너자", "건너다");
    map.put("가능해", "가능");
    map.put("가능해요", "가능");
    map.put("불가능해", "불가능");
    map.put("불가능해요", "불가능");
    map.put("타요", "타다");
    map.put("타자", "타다");
    map.put("찾아요", "찾다");
    map.put("찾아", "찾다");
    map.put("봐요", "보다");
    map.put("봐", "보다");
    map.put("주세요", "주다");
    map.put("줘요", "주다");
    map.put("줘", "주다");
    map.put("받아요", "받다");
    map.put("받아", "받다");
    map.put("기다려", "기다리다");
    map.put("기다려요", "기다리다");
    map.put("돌아", "돌다");
    map.put("돌아요", "돌다");
    map.put("들어가", "들어가다");
    map.put("들어가요", "들어가다");
    map.put("나가", "나가다");
    map.put("나가요", "나가다");
    map.put("멈춰", "멈추다");
    map.put("멈춰요", "멈추다");
    map.put("맞아요", "맞다");
    map.put("몰라", "모르다");
    map.put("몰라요", "모르다");
    map.put("알아요", "알다");
    map.put("알아", "알다");
    map.put("확인해", "확인");
    map.put("확인해요", "확인");
    map.put("예약해", "예약");
    map.put("예약해요", "예약");
    map.put("출발해", "출발");
    map.put("출발해요", "출발");
    map.put("도착해", "도착");
    map.put("도착해요", "도착");

    return map;
  }
}
