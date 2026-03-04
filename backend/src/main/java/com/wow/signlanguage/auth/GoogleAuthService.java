package com.wow.signlanguage.auth;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.wow.signlanguage.user.model.UserInfo;
import com.wow.signlanguage.user.service.UserAlreadyExistsException;
import com.wow.signlanguage.user.service.UserNotFoundException;
import com.wow.signlanguage.user.service.UserService;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class GoogleAuthService {
  private final GoogleIdTokenVerifier verifier;

  @Autowired
  private UserService userService;

  public GoogleAuthService(@Value("${google.client-id}") String googleClientId) {
    if (googleClientId == null || googleClientId.isBlank()) {
      throw new IllegalStateException("google.client-id is required");
    }

    this.verifier =
        new GoogleIdTokenVerifier.Builder(new NetHttpTransport(), GsonFactory.getDefaultInstance())
            .setAudience(List.of(googleClientId))
            .build();
  }

  public GoogleUser verify(String idTokenString) {
    if (idTokenString == null || idTokenString.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "idToken is required");
    }

    try {
      GoogleIdToken idToken = verifier.verify(idTokenString);
      if (idToken == null) {
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid Google id token");
      }

      GoogleIdToken.Payload payload = idToken.getPayload();
      String sub = payload.getSubject();
      String email = payload.getEmail();
      String name = (String) payload.get("name");
      String picture = (String) payload.get("picture");

      return new GoogleUser(sub, email, name, picture);
    } catch (GeneralSecurityException | IOException ex) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Google token verification failed");
    }
  }

  public UserInfo signupWithGoogleToken(String idToken) {
      try {
          GoogleUser googleUser = verify(idToken);
          String googleId = googleUser.sub();

          if (userService.existsByGoogleId(googleId)) {
              throw new UserAlreadyExistsException();
          }

          return userService.createUser(googleId, googleUser.email());
      } catch (Exception e) {
          if (e instanceof UserAlreadyExistsException) {
              throw (UserAlreadyExistsException) e;
          }
          throw new RuntimeException("Signup failed", e);
      }
  }

  public UserInfo loginWithGoogleToken(String idToken) {
      try {
          GoogleUser googleUser = verify(idToken);
          String googleId = googleUser.sub();

          if (!userService.existsByGoogleId(googleId)) {
              throw new UserNotFoundException();
          }

          return userService.getUserByGoogleId(googleId);
      } catch (Exception e) {
          if (e instanceof UserNotFoundException) {
              throw (UserNotFoundException) e;
          }
          throw new RuntimeException("Login failed", e);
      }
  }

  public record GoogleUser(String sub, String email, String name, String picture) {}
}
