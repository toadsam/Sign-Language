package com.wow.signlanguage.translate;

import java.util.List;

public record TranslateResponse(
    String input,
    List<String> normalizedTokens,
    List<ClipMatch> clips,
    List<String> unknown
) {
}
