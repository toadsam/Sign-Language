package com.wow.signlanguage.translate;

public record SimplificationMetadata(
    boolean question,
    boolean negative,
    String tense
) {
}
