package com.wow.signlanguage.user.controller;

import com.wow.signlanguage.user.dto.BookmarkRequest;
import com.wow.signlanguage.user.dto.BookmarkResponse;
import com.wow.signlanguage.user.dto.WrongNoteResponse;
import com.wow.signlanguage.user.dto.WrongNoteSaveRequest;
import com.wow.signlanguage.user.dto.WrongNoteSavedResponse;
import com.wow.signlanguage.user.model.UserInfo;
import com.wow.signlanguage.user.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
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

    @PostMapping("/{uid}/bookmarks")
    public ResponseEntity<?> saveBookmark(@PathVariable String uid, @RequestBody BookmarkRequest request) {
        if (request == null || request.quizId() == null || request.quizId().isBlank()) {
            return ResponseEntity.badRequest().body("quizId를 입력하세요.");
        }
        try {
            BookmarkResponse response = userService.saveBookmark(uid, request.quizId());
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/{uid}/bookmarks")
    public ResponseEntity<?> getBookmarks(@PathVariable String uid) {
        try {
            List<BookmarkResponse> response = userService.getBookmarks(uid);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @DeleteMapping("/{uid}/bookmarks/{quizId}")
    public ResponseEntity<?> deleteBookmark(@PathVariable String uid, @PathVariable String quizId) {
        try {
            userService.deleteBookmark(uid, quizId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/{uid}/wrong-notes")
    public ResponseEntity<?> getWrongNotes(@PathVariable String uid) {
        try {
            List<WrongNoteResponse> response = userService.getWrongNotes(uid);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @PostMapping("/{uid}/wrong-note-saved")
    public ResponseEntity<?> saveWrongNote(@PathVariable String uid, @RequestBody WrongNoteSaveRequest request) {
        if (request == null || request.quizId() == null || request.quizId().isBlank()) {
            return ResponseEntity.badRequest().body("quizId를 입력하세요.");
        }
        try {
            WrongNoteSavedResponse response = userService.saveWrongNote(uid, request.quizId());
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/{uid}/wrong-note-saved")
    public ResponseEntity<?> getSavedWrongNotes(@PathVariable String uid) {
        try {
            List<WrongNoteSavedResponse> response = userService.getSavedWrongNotes(uid);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @DeleteMapping("/{uid}/wrong-note-saved/{quizId}")
    public ResponseEntity<?> deleteSavedWrongNote(@PathVariable String uid, @PathVariable String quizId) {
        try {
            userService.deleteSavedWrongNote(uid, quizId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @PatchMapping("/{uid}/profile-image")
    public ResponseEntity<?> updateProfileImage(@PathVariable String uid, @RequestBody Map<String, String> body) {
        String profileImageUrl = body.get("profileImageUrl");
        if (profileImageUrl == null || profileImageUrl.isBlank()) {
            return ResponseEntity.badRequest().body("profileImageUrl을 입력하세요.");
        }
        try {
            UserInfo updated = userService.updateProfileImage(uid, profileImageUrl);
            return ResponseEntity.ok(updated);
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        } catch (ExecutionException | InterruptedException e) {
            return ResponseEntity.internalServerError().build();
        }
    }
}
