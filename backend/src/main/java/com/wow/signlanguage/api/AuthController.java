package com.wow.signlanguage.api;

import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController("apiAuthController")
@RequestMapping("/api/auth")
public class AuthController {
  @GetMapping("/me")
  public Map<String, Object> me(@AuthenticationPrincipal OAuth2User user) {
    return Map.of(
        "authenticated", true,
        "attributes", user.getAttributes());
  }
}