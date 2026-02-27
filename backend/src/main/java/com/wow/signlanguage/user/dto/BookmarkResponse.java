package com.wow.signlanguage.user.dto;

public record BookmarkResponse(
    String quizId, String questionText, String word, String videoUrl, Object savedAt) {}
