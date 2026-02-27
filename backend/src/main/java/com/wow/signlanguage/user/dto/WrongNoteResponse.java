package com.wow.signlanguage.user.dto;

public record WrongNoteResponse(
    String quizId, String questionText, String word, String videoUrl, Object wrongAt) {}
