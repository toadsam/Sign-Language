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

    String mapped = REPLACEMENTS.get(token);
    if (mapped != null) {
      return mapped;
    }

    String commonKoreanNormalized = normalizeCommonKoreanEnding(token);
    if (!commonKoreanNormalized.equals(token)) {
      return commonKoreanNormalized;
    }

    String predicateNormalized = normalizePredicateEnding(token);
    if (!predicateNormalized.equals(token)) {
      return predicateNormalized;
    }

    return REPLACEMENTS.getOrDefault(token, token);
  }

  private String normalizeCommonKoreanEnding(String token) {
    String exact = switch (token) {
      case "아파", "아파요", "아팠다", "아팠어요", "아프고", "아프면", "아픈" -> "아프다";
      case "힘들어", "힘들어요", "힘들었다", "힘들었어요", "힘들고", "힘들면", "힘든" -> "힘들다";
      case "좋아", "좋아요", "좋았다", "좋았어요", "좋고", "좋으면", "좋은" -> "좋다";
      case "싫어", "싫어요", "싫었다", "싫었어요", "싫고", "싫으면", "싫은" -> "싫다";
      case "몰라", "몰라요", "몰랐다", "몰랐어요", "모르고", "모르면", "모른" -> "모르다";
      case "알아", "알아요", "알았다", "알았어요", "알고", "알면", "아는" -> "알다";
      case "가", "가요", "갔다", "갔어요", "가고", "가면", "가는", "가야" -> "가다";
      case "걸어", "걸어요", "걸었다", "걸었어요", "걷고", "걸으면", "걷는" -> "걷다";
      case "받아", "받아요", "받았다", "받았어요", "받고", "받으면", "받는" -> "받다";
      case "줘", "줘요", "주었다", "줬다", "줬어요", "주고", "주면", "주는" -> "주다";
      default -> "";
    };
    if (!exact.isBlank()) {
      return exact;
    }

    String[] endings = {
        "습니다", "습니까", "ㅂ니다", "어요", "아요", "네요", "고요", "고", "지만", "면서", "면", "는", "은", "ㄴ"
    };
    for (String ending : endings) {
      if (token.endsWith(ending) && token.length() > ending.length()) {
        String stem = token.substring(0, token.length() - ending.length());
        if (!stem.isBlank()) {
          return stem + "다";
        }
      }
    }

    return token;
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
