package com.wow.signlanguage.user.controller;

import com.wow.signlanguage.user.model.UserInfo;
import com.wow.signlanguage.user.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.concurrent.ExecutionException;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UserService userService;

    @PostMapping("/{username}")
    public ResponseEntity<UserInfo> createUser(@PathVariable String username) {
        try {
            UserInfo userInfo = userService.createUserIfNotExists(username);
            return ResponseEntity.ok(userInfo);
        } catch (Exception e) {
            e.printStackTrace(); // 예외 발생 시 로그 출력
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/{username}")
    public ResponseEntity<UserInfo> getUser(@PathVariable String username) {
        System.out.println("getUser called, username=" + username);
        try {
            UserInfo userInfo = userService.getUserInfo(username);
            if (userInfo != null) {
                return ResponseEntity.ok(userInfo);
            }
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @PatchMapping("/{uid}")
    public ResponseEntity<?> updateUserPartial(@PathVariable String uid, @RequestBody Map<String, Object> updates) {
        try {
            UserInfo updatedUser = userService.updateUserPartial(uid, updates);
            return ResponseEntity.ok(updatedUser);
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/{uid}/{fieldName}")
    public ResponseEntity<?> getUserField(@PathVariable String uid, @PathVariable String fieldName) {
        try {
            UserInfo userInfo = userService.getUserInfo(uid);
            if (userInfo == null) {
                return ResponseEntity.notFound().build();
            }
            Object value;
            switch (fieldName) {
                case "totalQuestionNum":
                    value = userInfo.getTotalQuestionNum();
                    break;
                case "correctQuestionNum":
                    value = userInfo.getCorrectQuestionNum();
                    break;
                case "incorrectQuestions":
                    value = userInfo.getIncorrectQuestions();
                    break;
                case "userId":
                    value = userInfo.getUserId();
                    break;
                case "userLevel":
                    value = userInfo.getUserLevel();
                    break;
                case "totalQuestions":
                    value = userInfo.getTotalQuestions();
                    break;
                default:
                    return ResponseEntity.badRequest().body("Unknown field: " + fieldName);
            }
            return ResponseEntity.ok(Map.of(fieldName, value));
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @PatchMapping("/{uid}/tryQuestion")
    public ResponseEntity<?> tryQuestion(@PathVariable String uid, @RequestBody Map<String, Object> body) {
        String questionId = (String) body.get("questionId");
        Boolean isCorrect = (Boolean) body.get("isCorrect");
        if (questionId == null || isCorrect == null) {
            return ResponseEntity.badRequest().body("questionId와 isCorrect를 모두 입력하세요.");
        }
        try {
            UserInfo updated = userService.tryQuestion(uid, questionId, isCorrect);
            return ResponseEntity.ok(updated);
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @PostMapping("/google")
    public ResponseEntity<UserInfo> createUserWithGoogleIdToken(@RequestBody Map<String, String> body) {
        String idTokenString = body.get("idToken");
        if (idTokenString == null) {
            return ResponseEntity.badRequest().build();
        }
        try {
            UserInfo userInfo = userService.createUserWithGoogleIdToken(idTokenString);
            return ResponseEntity.ok(userInfo);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}