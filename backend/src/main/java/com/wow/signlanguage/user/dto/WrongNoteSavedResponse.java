package com.wow.signlanguage.user.dto;

public record WrongNoteSavedResponse(
    String quizId, String questionText, String word, String videoUrl, Object wrongAt, Object savedAt) {}
