package com.wow.signlanguage.user.dto;

public record DailySolvedCountPointResponse(
    String date,
    int solvedCount) {}
