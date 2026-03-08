package com.wow.signlanguage.user.dto;

public record TopWrongWordResponse(
    String quizId,
    String word,
    int wrongCount) {}
