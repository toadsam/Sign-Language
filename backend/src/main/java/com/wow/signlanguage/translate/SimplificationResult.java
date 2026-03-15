package com.wow.signlanguage.translate;

import java.util.List;

public record SimplificationResult(
    String simplifiedSentence,
    List<String> tokens,
    List<String> appliedRules,
    SimplificationMetadata metadata
) {
}
