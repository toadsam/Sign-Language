package com.wow.signlanguage.auth.service;

import com.wow.signlanguage.auth.dto.AuthResponse;
import com.wow.signlanguage.auth.dto.LoginRequest;
import com.wow.signlanguage.auth.dto.MeResponse;
import com.wow.signlanguage.auth.dto.RegisterRequest;
import com.wow.signlanguage.auth.model.UserAccount;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {
  private final PasswordService passwordService;
  private final TokenService tokenService;

  private final Map<String, UserAccount> usersByUsername = new ConcurrentHashMap<>();
  private final Map<String, String> usernameByToken = new ConcurrentHashMap<>();

  public AuthService(PasswordService passwordService, TokenService tokenService) {
    this.passwordService = passwordService;
    this.tokenService = tokenService;
  }

  public AuthResponse register(RegisterRequest request) {
    if (request == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "request body is required");
    }

    String username = normalizeUsername(request.username());
    String password = requireNonBlank(request.password(), "password is required");
    requireMinLength(password, 8, "password must be at least 8 characters");

    String salt = passwordService.newSalt();
    String hash = passwordService.hash(password, salt);
    String displayName = normalizeDisplayName(request.displayName(), username);
    UserAccount account = new UserAccount(username, salt, hash, displayName);
    UserAccount previous = usersByUsername.putIfAbsent(username, account);
    if (previous != null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "username already exists");
    }

    String token = tokenService.issueToken();
    usernameByToken.put(token, username);
    return new AuthResponse(token, account.username(), account.displayName());
  }

  public AuthResponse login(LoginRequest request) {
    if (request == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "request body is required");
    }

    String username = normalizeUsername(request.username());
    String password = requireNonBlank(request.password(), "password is required");

    UserAccount account = usersByUsername.get(username);
    if (account == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid username or password");
    }

    String hash = passwordService.hash(password, account.passwordSalt());
    if (!hash.equals(account.passwordHash())) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid username or password");
    }

    String token = tokenService.issueToken();
    usernameByToken.put(token, account.username());
    return new AuthResponse(token, account.username(), account.displayName());
  }

  public MeResponse me(String token) {
    UserAccount account = findByToken(token);
    return new MeResponse(account.username(), account.displayName());
  }

  public void logout(String token) {
    if (!usernameByToken.containsKey(token)) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid token");
    }
    usernameByToken.remove(token);
  }

  private UserAccount findByToken(String token) {
    String username = usernameByToken.get(token);
    if (username == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid token");
    }
    UserAccount account = usersByUsername.get(username);
    if (account == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid token");
    }
    return account;
  }

  private String normalizeUsername(String value) {
    String username = requireNonBlank(value, "username is required");
    requireMinLength(username, 3, "username must be at least 3 characters");
    return username.trim().toLowerCase();
  }

  private String normalizeDisplayName(String value, String fallback) {
    if (value == null || value.isBlank()) {
      return fallback;
    }
    return value.trim();
  }

  private String requireNonBlank(String value, String message) {
    if (value == null || value.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
    return value.trim();
  }

  private void requireMinLength(String value, int min, String message) {
    if (value.length() < min) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
  }
}
