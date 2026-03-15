package com.wow.signlanguage.service;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.normalizer.TextNormalizer;
import com.wow.signlanguage.translate.SimplificationMetadata;
import com.wow.signlanguage.translate.SimplificationResult;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class SignSentenceSimplifier {

  private static final Set<String> TIME_WORDS = Set.of("오늘", "내일", "지금", "나중", "시간", "분");
  private static final Set<String> QUESTION_WORDS = Set.of(
      "어디", "무엇", "언제", "왜", "어떻게", "누구", "몇", "얼마", "몇시"
  );
  private static final Set<String> PLACE_WORDS = Set.of(
      "여기", "거기", "저기", "이쪽", "저쪽", "앞", "뒤", "왼쪽", "오른쪽", "위", "아래",
      "가운데", "옆", "근처", "길", "거리", "교차로", "신호등", "횡단보도", "입구", "출구",
      "계단", "엘리베이터", "에스컬레이터", "문", "안내표지", "지도", "화장실", "매표소",
      "안내소", "지하철역", "정류장", "병원", "약국", "경찰서", "우체국", "공항", "도로"
  );
  private static final Set<String> PREDICATE_WORDS = Set.of(
      "알다", "모르다", "있다", "없다", "맞다", "아니다", "가능", "불가능", "가다", "오다",
      "들어가다", "나가다", "건너다", "돌다", "직진", "멈추다", "기다리다", "찾다", "보다",
      "주다", "받다", "타다", "환승", "출발", "도착", "예약", "확인", "도와주다", "괜찮다"
  );
  private static final List<String> PARTICLES = List.of(
      "에서는", "으로는", "에게는", "에서는", "으로", "에서", "에게", "한테", "까지", "부터",
      "처럼", "보다", "와", "과", "은", "는", "이", "가", "을", "를", "에", "도", "만", "로"
  );
  private static final List<String> SUBJECT_PARTICLES = List.of("은", "는", "이", "가");
  private static final List<String> OBJECT_PARTICLES = List.of("을", "를");
  private static final List<String> PLACE_PARTICLES = List.of("에서", "에", "으로", "로");

  private final TextNormalizer textNormalizer;
  private final DictionaryLoader dictionaryLoader;

  public SignSentenceSimplifier(TextNormalizer textNormalizer, DictionaryLoader dictionaryLoader) {
    this.textNormalizer = textNormalizer;
    this.dictionaryLoader = dictionaryLoader;
  }

  public SimplificationResult simplify(String input) {
    String safeInput = input == null ? "" : input.trim();
    if (safeInput.isEmpty()) {
      return new SimplificationResult("", List.of(), List.of(), new SimplificationMetadata(false, false, "present"));
    }

    LinkedHashSet<String> appliedRules = new LinkedHashSet<>();
    List<String> timeTokens = new ArrayList<>();
    List<String> placeTokens = new ArrayList<>();
    List<String> subjectTokens = new ArrayList<>();
    List<String> objectTokens = new ArrayList<>();
    List<String> predicateTokens = new ArrayList<>();
    List<String> questionTokens = new ArrayList<>();

    boolean question = safeInput.contains("?");
    boolean negative = false;
    String tense = "present";

    for (String rawToken : tokenize(safeInput)) {
      TokenAnalysis analysis = analyze(rawToken);
      if (analysis == null) {
        continue;
      }

      if (analysis.removedParticle()) {
        appliedRules.add("particle_removal");
      }

      if (analysis.standaloneNegativeMarker()) {
        negative = true;
        appliedRules.add("negative_processing");
        continue;
      }

      if (analysis.past()) {
        tense = "past";
        appliedRules.add("tense_separation");
      } else if (analysis.future() && !"past".equals(tense)) {
        tense = "future";
        appliedRules.add("tense_separation");
      }

      if (analysis.questionWord()) {
        question = true;
        addUnique(questionTokens, analysis.token());
        appliedRules.add("question_reordering");
        continue;
      }

      if (analysis.negativeWord()) {
        negative = true;
      }

      switch (analysis.role()) {
        case TIME -> addUnique(timeTokens, analysis.token());
        case PLACE -> addUnique(placeTokens, analysis.token());
        case SUBJECT -> addUnique(subjectTokens, analysis.token());
        case PREDICATE -> addUnique(predicateTokens, analysis.token());
        case OBJECT -> addUnique(objectTokens, analysis.token());
      }
    }

    if ("future".equals(tense) && timeTokens.stream().noneMatch(token -> token.equals("내일") || token.equals("나중"))) {
      addUnique(timeTokens, "나중");
    }

    List<String> orderedTokens = new ArrayList<>();
    orderedTokens.addAll(timeTokens);
    orderedTokens.addAll(placeTokens);
    orderedTokens.addAll(subjectTokens);
    orderedTokens.addAll(objectTokens);
    orderedTokens.addAll(predicateTokens);

    if (negative && orderedTokens.stream().noneMatch(token -> token.equals("아니다") || token.equals("없다") || token.equals("불가능"))) {
      addUnique(orderedTokens, "아니다");
    }

    if ("past".equals(tense) && hasDictionaryWord("끝")) {
      addUnique(orderedTokens, "끝");
    }

    for (String questionToken : questionTokens) {
      addUnique(orderedTokens, questionToken);
    }

    if (!orderedTokens.isEmpty()) {
      appliedRules.add("word_order");
    }

    return new SimplificationResult(
        String.join(" ", orderedTokens),
        List.copyOf(orderedTokens),
        List.copyOf(appliedRules),
        new SimplificationMetadata(question, negative, tense)
    );
  }

  private List<String> tokenize(String input) {
    String cleaned = input.replaceAll("[,!.]", " ").trim();
    if (cleaned.isEmpty()) {
      return List.of();
    }
    return List.of(cleaned.split("\\s+"));
  }

  private TokenAnalysis analyze(String rawToken) {
    if (rawToken == null || rawToken.isBlank()) {
      return null;
    }

    String token = stripPunctuation(rawToken);
    if (token.isBlank()) {
      return null;
    }

    boolean standaloneNegativeMarker = token.equals("안") || token.equals("못");
    if (standaloneNegativeMarker) {
      return new TokenAnalysis("", Role.OBJECT, false, false, false, false, true, false);
    }

    Role particleRole = detectParticleRole(token);
    String stripped = stripParticles(token);
    boolean removedParticle = !stripped.equals(token);

    String normalized = resolveKnownWord(stripped);
    boolean questionWord = QUESTION_WORDS.contains(normalized);
    boolean negativeWord = normalized.equals("아니다") || normalized.equals("없다") || normalized.equals("불가능");
    boolean past = detectPastTense(token);
    boolean future = detectFutureTense(token) || normalized.equals("내일") || normalized.equals("나중");
    Role role = inferRole(normalized, particleRole, questionWord);

    return new TokenAnalysis(normalized, role, questionWord, past, future, removedParticle, false, negativeWord);
  }

  private String resolveKnownWord(String token) {
    String normalized = textNormalizer.normalizeToken(token);
    if (hasDictionaryWord(normalized)) {
      return normalized;
    }

    for (String candidate : deriveCandidates(token)) {
      String normalizedCandidate = textNormalizer.normalizeToken(candidate);
      if (hasDictionaryWord(normalizedCandidate)) {
        return normalizedCandidate;
      }
    }

    return normalized;
  }

  private List<String> deriveCandidates(String token) {
    LinkedHashSet<String> candidates = new LinkedHashSet<>();
    candidates.add(token);

    String[] copulaSuffixes = {"이에요", "예요", "입니다", "이야", "야"};
    for (String suffix : copulaSuffixes) {
      if (token.endsWith(suffix) && token.length() > suffix.length()) {
        candidates.add(token.substring(0, token.length() - suffix.length()));
      }
    }

    String[] hadaSuffixes = {"했어요", "했어", "했다", "했습니다", "해요", "해", "하고"};
    for (String suffix : hadaSuffixes) {
      if (token.endsWith(suffix) && token.length() > suffix.length()) {
        String stem = token.substring(0, token.length() - suffix.length());
        candidates.add(stem);
        candidates.add(stem + "하다");
      }
    }

    String[] verbSuffixes = {"아요", "어요", "여요", "고", "아", "어", "요", "다", "자", "니", "냐", "나", "죠", "지"};
    for (String suffix : verbSuffixes) {
      if (token.endsWith(suffix) && token.length() > suffix.length()) {
        String stem = token.substring(0, token.length() - suffix.length());
        candidates.add(stem);
        candidates.add(stem + "다");
      }
    }

    return new ArrayList<>(candidates);
  }

  private Role inferRole(String token, Role particleRole, boolean questionWord) {
    if (questionWord) {
      return Role.OBJECT;
    }
    if (TIME_WORDS.contains(token)) {
      return Role.TIME;
    }
    if (PLACE_WORDS.contains(token) || particleRole == Role.PLACE) {
      return Role.PLACE;
    }
    if (particleRole == Role.SUBJECT) {
      return Role.SUBJECT;
    }
    if (particleRole == Role.OBJECT) {
      return Role.OBJECT;
    }
    if (PREDICATE_WORDS.contains(token)) {
      return Role.PREDICATE;
    }
    return Role.OBJECT;
  }

  private Role detectParticleRole(String token) {
    for (String suffix : PLACE_PARTICLES) {
      if (token.endsWith(suffix) && token.length() > suffix.length()) {
        return Role.PLACE;
      }
    }
    for (String suffix : SUBJECT_PARTICLES) {
      if (token.endsWith(suffix) && token.length() > suffix.length()) {
        return Role.SUBJECT;
      }
    }
    for (String suffix : OBJECT_PARTICLES) {
      if (token.endsWith(suffix) && token.length() > suffix.length()) {
        return Role.OBJECT;
      }
    }
    return Role.OBJECT;
  }

  private String stripPunctuation(String token) {
    return token.replaceAll("^[\\p{Punct}！？。，、·]+|[\\p{Punct}！？。，、·]+$", "");
  }

  private String stripParticles(String token) {
    for (String suffix : PARTICLES) {
      if (token.endsWith(suffix) && token.length() > suffix.length()) {
        return token.substring(0, token.length() - suffix.length());
      }
    }
    return token;
  }

  private boolean detectPastTense(String token) {
    return token.matches(".*(었|았|였|했다|했어|했어요|였습니다|였다).*");
  }

  private boolean detectFutureTense(String token) {
    return token.matches(".*(겠|을거|ㄹ거|거야|거예요|할거|갈거|올거).*");
  }

  private boolean hasDictionaryWord(String token) {
    return dictionaryLoader.findByWord(token).isPresent();
  }

  private void addUnique(List<String> tokens, String token) {
    if (token == null || token.isBlank() || tokens.contains(token)) {
      return;
    }
    tokens.add(token);
  }

  private enum Role {
    TIME,
    PLACE,
    SUBJECT,
    OBJECT,
    PREDICATE
  }

  private record TokenAnalysis(
      String token,
      Role role,
      boolean questionWord,
      boolean past,
      boolean future,
      boolean removedParticle,
      boolean standaloneNegativeMarker,
      boolean negativeWord
  ) {
  }
}
