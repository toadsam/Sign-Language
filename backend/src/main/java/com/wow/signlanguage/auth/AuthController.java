package com.wow.signlanguage.auth;

import com.wow.signlanguage.auth.dto.AuthResponse;
import com.wow.signlanguage.auth.dto.GoogleAuthRequest;
import com.wow.signlanguage.auth.dto.IdTokenRequest;
import com.wow.signlanguage.auth.dto.SignupCompleteRequest;
import com.wow.signlanguage.user.model.UserInfo;
import com.wow.signlanguage.user.service.UserAlreadyExistsException;
import com.wow.signlanguage.user.service.UserNotFoundException;
import com.wow.signlanguage.user.service.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final GoogleAuthService googleAuthService;
  private final JwtService jwtService;
  private final UserService userService;

  public AuthController(GoogleAuthService googleAuthService, JwtService jwtService, UserService userService) {
    this.googleAuthService = googleAuthService;
    this.jwtService = jwtService;
    this.userService = userService;
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

  @PostMapping("/signup")
  public ResponseEntity<?> signup(@RequestBody IdTokenRequest request) {
    try {
      // 1. idToken 검증 및 구글 유저 정보 추출
      GoogleAuthService.GoogleUser googleUser = googleAuthService.verify(request.getIdToken());

      // 2. 유저 생성
      UserInfo user = googleAuthService.signupWithGoogleToken(request.getIdToken());

      // 3. JWT 토큰 발급
      String accessToken = jwtService.generateAccessToken(googleUser);
      String refreshToken = jwtService.generateRefreshToken(googleUser.sub());

      // 4. 응답 생성
      Map<String, Object> response = new HashMap<>();
      response.put("success", true);
      response.put("message", "Signup initiated. Please complete registration.");
      response.put("accessToken", accessToken);
      response.put("refreshToken", refreshToken);
      response.put("tokenType", "Bearer");
      response.put("expiresIn", jwtService.getAccessExpSeconds());

      // user 정보
      Map<String, Object> userMap = new HashMap<>();
      userMap.put("id", googleUser.sub());
      userMap.put("email", user.getEmail() != null ? user.getEmail() : googleUser.email());
      userMap.put("name", user.getName() != null ? user.getName() : googleUser.name());
      userMap.put("picture", user.getProfileImageUrl() != null ? user.getProfileImageUrl() : googleUser.picture());
      response.put("user", userMap);

      response.put("isRegistered", user.isRegistered());

      return ResponseEntity.status(HttpStatus.CREATED).body(response);
    } catch (UserAlreadyExistsException e) {
      Map<String, Object> errorResponse = new HashMap<>();
      errorResponse.put("success", false);
      errorResponse.put("message", "User already exists");
      return ResponseEntity.status(HttpStatus.CONFLICT).body(errorResponse);
    } catch (Exception e) {
      Map<String, Object> errorResponse = new HashMap<>();
      errorResponse.put("success", false);
      errorResponse.put("message", "Signup failed: " + e.getMessage());
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }
  }

  @PostMapping("/login")
  public ResponseEntity<?> login(@RequestBody IdTokenRequest request) {
    try {
      // 1. idToken 검증 및 구글 유저 정보 추출
      GoogleAuthService.GoogleUser googleUser = googleAuthService.verify(request.getIdToken());

      // 2. Firestore에서 유저 정보 조회
      UserInfo user = googleAuthService.loginWithGoogleToken(request.getIdToken());
      System.out.println("로그인 유저 정보: userId=" + user.getUserId() + ", name=" + user.getName() + ", email=" + user.getEmail() + ", isRegistered=" + user.isRegistered());

      // 3. JWT 토큰 발급
      String accessToken = jwtService.generateAccessToken(googleUser);
      String refreshToken = jwtService.generateRefreshToken(googleUser.sub());

      // 4. 응답 생성
      Map<String, Object> response = new HashMap<>();
      response.put("success", true);
      response.put("accessToken", accessToken);
      response.put("refreshToken", refreshToken);
      response.put("tokenType", "Bearer");
      response.put("expiresIn", jwtService.getAccessExpSeconds());

      // user 정보 (Firestore의 name 포함)
      Map<String, Object> userMap = new HashMap<>();
      userMap.put("id", googleUser.sub());
      userMap.put("email", user.getEmail() != null ? user.getEmail() : googleUser.email());
      userMap.put("name", user.getName() != null ? user.getName() : googleUser.name()); // Firestore의 name 우선
      userMap.put("picture", user.getProfileImageUrl() != null ? user.getProfileImageUrl() : googleUser.picture()); // Firestore의 profileImageUrl 우선
      response.put("user", userMap);

      response.put("isRegistered", user.isRegistered());

      System.out.println("로그인 응답 전송: isRegistered=" + user.isRegistered() + ", name=" + user.getName());
      return ResponseEntity.ok(response);
    } catch (UserNotFoundException e) {
      Map<String, Object> errorResponse = new HashMap<>();
      errorResponse.put("success", false);
      errorResponse.put("message", "User not found. Please signup first.");
      errorResponse.put("needsSignup", true);
      return ResponseEntity.status(HttpStatus.NOT_FOUND).body(errorResponse);
    } catch (Exception e) {
      Map<String, Object> errorResponse = new HashMap<>();
      errorResponse.put("success", false);
      errorResponse.put("message", "Login failed: " + e.getMessage());
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }
  }

  @PostMapping("/signup/complete")
  public ResponseEntity<?> completeSignup(@RequestBody SignupCompleteRequest request) {
    try {
      UserInfo user = userService.completeUserRegistration(
          request.getGoogleId(),
          request.getName(),
          request.getPhoneNumber(),
          request.getOrganization()
      );
      Map<String, Object> response = new HashMap<>();
      response.put("success", true);
      response.put("message", "Registration completed successfully");
      response.put("user", user);
      return ResponseEntity.ok(response);
    } catch (Exception e) {
      Map<String, Object> errorResponse = new HashMap<>();
      errorResponse.put("success", false);
      errorResponse.put("message", "Failed to complete registration: " + e.getMessage());
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }
  }
}
