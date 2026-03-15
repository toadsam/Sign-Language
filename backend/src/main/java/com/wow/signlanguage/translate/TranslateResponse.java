package com.wow.signlanguage.translate;

import java.util.List;

public record TranslateResponse(
    String input,
    String simplifiedSentence,
    List<String> normalizedTokens,
    List<String> appliedRules,
    SimplificationMetadata metadata,
    List<ClipMatch> clips,
    List<String> unknown
) {
}
