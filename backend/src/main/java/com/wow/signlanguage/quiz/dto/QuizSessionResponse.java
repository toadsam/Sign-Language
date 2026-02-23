package com.wow.signlanguage.quiz.dto;

import java.util.List;

public record QuizSessionResponse(int count, List<QuizSessionQuestionResponse> questions) {}
