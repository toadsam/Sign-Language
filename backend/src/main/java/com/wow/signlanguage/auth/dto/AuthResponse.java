package com.wow.signlanguage.auth.dto;

public record AuthResponse(
    String token,
    String username,
    String displayName
) {
}
