package com.wow.signlanguage.user.dto;

public record TranslatorBookmarkResponse(
    String quizId,
    String questionText,
    String word,
    String videoUrl,
    Object savedAt
) {}

