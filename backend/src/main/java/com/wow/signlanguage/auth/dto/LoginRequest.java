package com.wow.signlanguage.auth.dto;

public record LoginRequest(
    String username,
    String password
) {
}
