package com.wow.signlanguage.auth;

import com.wow.signlanguage.auth.dto.AuthResponse;
import com.wow.signlanguage.auth.dto.GoogleAuthRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final GoogleAuthService googleAuthService;
  private final JwtService jwtService;

  public AuthController(GoogleAuthService googleAuthService, JwtService jwtService) {
    this.googleAuthService = googleAuthService;
    this.jwtService = jwtService;
  }

  @PostMapping("/google")
  public AuthResponse googleLogin(@RequestBody GoogleAuthRequest request) {
    GoogleAuthService.GoogleUser user = googleAuthService.verify(request.idToken());
    String accessToken = jwtService.generateAccessToken(user);
    String refreshToken = jwtService.generateRefreshToken(user.sub());

    return new AuthResponse(
        accessToken,
        refreshToken,
        "Bearer",
        jwtService.getAccessExpSeconds(),
        new AuthResponse.UserProfile(user.sub(), user.email(), user.name(), user.picture()));
  }
}
