package com.wow.signlanguage.auth.dto;

public record RegisterRequest(
    String username,
    String password,
    String displayName
) {
}
