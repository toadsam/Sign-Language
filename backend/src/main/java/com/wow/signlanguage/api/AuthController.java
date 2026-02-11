package com.wow.signlanguage.api;

import com.wow.signlanguage.auth.dto.AuthResponse;
import com.wow.signlanguage.auth.dto.LoginRequest;
import com.wow.signlanguage.auth.dto.MeResponse;
import com.wow.signlanguage.auth.dto.RegisterRequest;
import com.wow.signlanguage.auth.service.AuthService;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final AuthService authService;

  public AuthController(AuthService authService) {
    this.authService = authService;
  }

  @PostMapping("/register")
  public AuthResponse register(@RequestBody RegisterRequest request) {
    return authService.register(request);
  }

  @PostMapping("/login")
  public AuthResponse login(@RequestBody LoginRequest request) {
    return authService.login(request);
  }

  @GetMapping("/me")
  public MeResponse me(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    return authService.me(extractBearerToken(authorization));
  }

  @PostMapping("/logout")
  public Map<String, String> logout(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    authService.logout(extractBearerToken(authorization));
    return Map.of("status", "ok");
  }

  private String extractBearerToken(String authorization) {
    if (authorization == null || authorization.isBlank()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authorization header is required");
    }

    String prefix = "Bearer ";
    if (!authorization.startsWith(prefix) || authorization.length() <= prefix.length()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid authorization format");
    }
    return authorization.substring(prefix.length()).trim();
  }
}
