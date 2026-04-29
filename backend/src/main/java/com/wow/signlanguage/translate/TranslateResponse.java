package com.wow.signlanguage.translate;

import java.util.List;

public record TranslateResponse(
    String input,
    String simplifiedSentence,
    List<String> normalizedTokens,
    List<String> appliedRules,
    SimplificationMetadata metadata,
    List<ClipMatch> clips,
    List<String> unknown,
    /** 사전에는 있지만 Firebase Storage에 영상이 없는 단어 목록 */
    List<String> noVideoWords
) {
}
