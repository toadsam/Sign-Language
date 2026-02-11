package com.wow.signlanguage.auth.model;

public record UserAccount(
    String username,
    String passwordSalt,
    String passwordHash,
    String displayName
) {
}
