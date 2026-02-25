package com.wow.signlanguage.auth.dto;

public record AuthResponse(
    String accessToken,
    String refreshToken,
    String tokenType,
    long expiresInSeconds,
    UserProfile user) {
  public record UserProfile(String id, String email, String name, String picture) {}
}
