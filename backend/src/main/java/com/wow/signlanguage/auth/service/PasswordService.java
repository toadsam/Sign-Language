package com.wow.signlanguage.auth.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import org.springframework.stereotype.Service;

@Service
public class PasswordService {
  private final SecureRandom secureRandom = new SecureRandom();

  public String newSalt() {
    byte[] salt = new byte[16];
    secureRandom.nextBytes(salt);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(salt);
  }

  public String hash(String password, String salt) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hashed = digest.digest((salt + ":" + password).getBytes(StandardCharsets.UTF_8));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(hashed);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is not available", e);
    }
  }
}
