package com.wow.signlanguage.user.dto;

public record TranslatorBookmarkRequest(
    String sentence,
    String word,
    String videoUrl
) {}

