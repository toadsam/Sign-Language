package com.wow.signlanguage.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
  private final SecretKey key;
  private final long accessExpMinutes;
  private final long refreshExpDays;

  public JwtService(
      @Value("${jwt.secret}") String secret,
      @Value("${jwt.access-exp-min:60}") long accessExpMinutes,
      @Value("${jwt.refresh-exp-day:14}") long refreshExpDays) {
    if (secret == null || secret.length() < 32) {
      throw new IllegalStateException("jwt.secret must be at least 32 chars");
    }

    this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    this.accessExpMinutes = accessExpMinutes;
    this.refreshExpDays = refreshExpDays;
  }

  public String generateAccessToken(GoogleAuthService.GoogleUser user) {
    Instant now = Instant.now();
    Instant expiresAt = now.plus(accessExpMinutes, ChronoUnit.MINUTES);

    return Jwts.builder()
        .subject(user.sub())
        .claim("email", user.email())
        .claim("name", user.name())
        .claim("picture", user.picture())
        .issuedAt(Date.from(now))
        .expiration(Date.from(expiresAt))
        .signWith(key)
        .compact();
  }

  public String generateRefreshToken(String subject) {
    Instant now = Instant.now();
    Instant expiresAt = now.plus(refreshExpDays, ChronoUnit.DAYS);

    return Jwts.builder()
        .subject(subject)
        .claim("type", "refresh")
        .issuedAt(Date.from(now))
        .expiration(Date.from(expiresAt))
        .signWith(key)
        .compact();
  }

  public long getAccessExpSeconds() {
    return accessExpMinutes * 60L;
  }
}
