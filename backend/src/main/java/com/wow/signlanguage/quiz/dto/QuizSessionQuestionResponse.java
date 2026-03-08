package com.wow.signlanguage.quiz.dto;

import java.util.List;

public record QuizSessionQuestionResponse(
    String quizId,
    String questionText,
    List<String> choices,
    String videoUrl,
    long level,
    Long attemptCount,
    Long correctCount,
    Integer correctRate,
    String difficultyLevel) {}
