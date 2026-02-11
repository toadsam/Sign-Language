package com.wow.signlanguage.auth.service;

import java.security.SecureRandom;
import java.util.Base64;
import org.springframework.stereotype.Service;

@Service
public class TokenService {
  private final SecureRandom secureRandom = new SecureRandom();

  public String issueToken() {
    byte[] raw = new byte[32];
    secureRandom.nextBytes(raw);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
  }
}
