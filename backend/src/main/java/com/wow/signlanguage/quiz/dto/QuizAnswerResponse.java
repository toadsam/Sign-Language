package com.wow.signlanguage.quiz.dto;

public record QuizAnswerResponse(
    String quizId,
    String selectedChoiceId,
    boolean isCorrect,
    String correctChoiceId,
    String correctChoiceText) {}
