package com.wow.signlanguage.user.dto;

import java.util.List;

public record DailySolvedTrendResponse(
    String uid,
    List<DailySolvedCountPointResponse> dailySolvedCounts) {}
