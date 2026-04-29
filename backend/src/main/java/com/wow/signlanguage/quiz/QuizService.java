package com.wow.signlanguage.quiz;

import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.FieldValue;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.QuerySnapshot;
import com.wow.signlanguage.quiz.dto.QuizAnswerRequest;
import com.wow.signlanguage.quiz.dto.QuizAnswerResponse;
import com.wow.signlanguage.quiz.dto.QuizSessionQuestionResponse;
import com.wow.signlanguage.quiz.dto.QuizSessionResponse;
import com.wow.signlanguage.storage.StorageVideoCache;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class QuizService {
  private static final String COLLECTION_NAME = "quiz_items";
  private static final String USERS_COLLECTION_NAME = "users";
  private static final int DEFAULT_COUNT = 10;
  private static final int MAX_COUNT = 50;

  private final Firestore firestore;
  private final StorageVideoCache storageVideoCache;

  public QuizService(Firestore firestore, StorageVideoCache storageVideoCache) {
    this.firestore = firestore;
    this.storageVideoCache = storageVideoCache;
  }

  public QuizSessionResponse getSession(int count) {
    int safeCount = normalizeCount(count);
    List<QuizSessionQuestionResponse> questions = getActiveQuestions();
    Collections.shuffle(questions);

    if (questions.size() > safeCount) {
      questions = new ArrayList<>(questions.subList(0, safeCount));
    }

    return new QuizSessionResponse(questions.size(), questions);
  }

  public QuizSessionResponse getWrongSession(String uid, int count) {
    if (isBlank(uid)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "uid is required.");
    }

    int safeCount = normalizeCount(count);
    DocumentSnapshot userDoc = getUserById(uid);
    List<String> wrongQuizIds = getWrongQuizIds(userDoc);

    List<QuizSessionQuestionResponse> questions = new ArrayList<>();
    for (String quizId : wrongQuizIds) {
      if (questions.size() >= safeCount) {
        break;
      }
      DocumentSnapshot quizDoc = getQuestionByIdOrNull(quizId);
      if (quizDoc == null) {
        continue;
      }
      QuizSessionQuestionResponse question = toSessionQuestion(quizDoc);
      if (question != null) {
        questions.add(question);
      }
    }

    return new QuizSessionResponse(questions.size(), questions);
  }

  public QuizAnswerResponse checkAnswer(QuizAnswerRequest request) {
    if (request == null || isBlank(request.quizId()) || isBlank(request.selectedChoiceId())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "quizId and selectedChoiceId are required.");
    }

    DocumentSnapshot doc = getQuestionById(request.quizId());
    String correctChoiceId = normalizeChoiceId(doc.getString("correctChoiceId"));
    if (isBlank(correctChoiceId)) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "correctChoiceId is missing.");
    }

    List<String> choices = toStringList(doc.get("choices"));
    String selectedChoiceId = normalizeChoiceId(request.selectedChoiceId());
    boolean isCorrect = correctChoiceId.equals(selectedChoiceId);
    updateQuizStats(request.quizId(), isCorrect);

    return new QuizAnswerResponse(
        request.quizId(),
        selectedChoiceId,
        isCorrect,
        correctChoiceId,
        choiceTextById(choices, correctChoiceId));
  }

  private List<QuizSessionQuestionResponse> getActiveQuestions() {
    try {
      QuerySnapshot snapshot =
          firestore.collection(COLLECTION_NAME).whereEqualTo("isActive", true).get().get();

      List<QuizSessionQuestionResponse> questions = new ArrayList<>();
      for (DocumentSnapshot doc : snapshot.getDocuments()) {
        QuizSessionQuestionResponse question = toSessionQuestion(doc);
        if (question != null) {
          questions.add(question);
        }
      }
      return questions;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Firestore read interrupted.", e);
    } catch (ExecutionException e) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to load quiz session.", e);
    }
  }

  private DocumentSnapshot getUserById(String uid) {
    try {
      DocumentSnapshot doc = firestore.collection(USERS_COLLECTION_NAME).document(uid).get().get();
      if (!doc.exists()) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found: " + uid);
      }
      return doc;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Firestore read interrupted.", e);
    } catch (ExecutionException e) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read user.", e);
    }
  }

  private DocumentSnapshot getQuestionById(String quizId) {
    try {
      DocumentSnapshot doc = firestore.collection(COLLECTION_NAME).document(quizId).get().get();
      if (!doc.exists()) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Quiz not found: " + quizId);
      }
      return doc;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Firestore read interrupted.", e);
    } catch (ExecutionException e) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read quiz item.", e);
    }
  }

  private DocumentSnapshot getQuestionByIdOrNull(String quizId) {
    try {
      DocumentSnapshot doc = firestore.collection(COLLECTION_NAME).document(quizId).get().get();
      return doc.exists() ? doc : null;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Firestore read interrupted.", e);
    } catch (ExecutionException e) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read quiz item.", e);
    }
  }

  private int normalizeCount(int count) {
    if (count <= 0) {
      return DEFAULT_COUNT;
    }
    return Math.min(count, MAX_COUNT);
  }

  private List<String> getWrongQuizIds(DocumentSnapshot userDoc) {
    Map<String, Integer> wrongCounts = toStringIntegerMap(userDoc.get("incorrectQuestionCounts"));
    if (!wrongCounts.isEmpty()) {
      List<Map.Entry<String, Integer>> entries = new ArrayList<>(wrongCounts.entrySet());
      entries.sort(
          Comparator.comparingInt((Map.Entry<String, Integer> entry) -> entry.getValue()).reversed()
              .thenComparing(Map.Entry::getKey));
      List<String> quizIds = new ArrayList<>();
      for (Map.Entry<String, Integer> entry : entries) {
        quizIds.add(entry.getKey());
      }
      return quizIds;
    }

    return toStringList(userDoc.get("incorrectQuestions"));
  }

  private QuizSessionQuestionResponse toSessionQuestion(DocumentSnapshot doc) {
    Boolean isActive = doc.getBoolean("isActive");
    if (isActive != null && !isActive) {
      return null;
    }

    String questionText = doc.getString("questionText");
    String firestoreVideoUrl = doc.getString("videoUrl");
    List<String> choices = toStringList(doc.get("choices"));

    if (isBlank(questionText) || choices.size() != 4) {
      return null;
    }

    // Storage 캐시에서 단어명으로 동영상 URL 조회, 없으면 Firestore videoUrl로 fallback
    String storageUrl = storageVideoCache.findUrl(questionText);
    String videoUrl = (storageUrl != null) ? storageUrl : firestoreVideoUrl;

    if (isBlank(videoUrl)) {
      return null;
    }

    Long attemptCount = doc.getLong("attempt_count");
    Long correctCount = doc.getLong("correct_count");
    Integer correctRate = null;
    if (attemptCount != null && attemptCount > 0 && correctCount != null) {
      correctRate = (int) Math.round((correctCount.doubleValue() / attemptCount.doubleValue()) * 100.0);
    }
    String difficultyLevel = safeString(doc.getString("difficulty_level"));

    return new QuizSessionQuestionResponse(
        doc.getId(),
        questionText,
        choices,
        videoUrl,
        doc.getLong("level") == null ? 1L : doc.getLong("level"),
        attemptCount,
        correctCount,
        correctRate,
        difficultyLevel);
  }

  private String normalizeChoiceId(String value) {
    return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
  }

  private boolean isBlank(String value) {
    return value == null || value.trim().isEmpty();
  }

  private List<String> toStringList(Object value) {
    if (!(value instanceof List<?> raw)) {
      return List.of();
    }

    List<String> result = new ArrayList<>();
    for (Object item : raw) {
      if (item instanceof String text && !text.isBlank()) {
        result.add(text);
      }
    }
    return result;
  }

  private String safeString(String value) {
    return isBlank(value) ? "" : value;
  }

  private void updateQuizStats(String quizId, boolean isCorrect) {
    try {
      var quizRef = firestore.collection(COLLECTION_NAME).document(quizId);
      Map<String, Object> updates = new java.util.HashMap<>();
      updates.put("attempt_count", FieldValue.increment(1));
      if (isCorrect) {
        updates.put("correct_count", FieldValue.increment(1));
      } else {
        updates.put("wrong_count", FieldValue.increment(1));
      }
      quizRef.update(updates).get();
    } catch (Exception ignored) {
      // Keep answer flow available even if stats aggregation temporarily fails.
    }
  }

  private Map<String, Integer> toStringIntegerMap(Object value) {
    if (!(value instanceof Map<?, ?> raw)) {
      return Map.of();
    }

    Map<String, Integer> result = new java.util.HashMap<>();
    for (Map.Entry<?, ?> entry : raw.entrySet()) {
      if (!(entry.getKey() instanceof String key)) {
        continue;
      }
      Object rawValue = entry.getValue();
      if (rawValue instanceof Number number) {
        result.put(key, number.intValue());
      }
    }
    return result;
  }

  private String choiceTextById(List<String> choices, String choiceId) {
    int index = switch (choiceId) {
      case "A" -> 0;
      case "B" -> 1;
      case "C" -> 2;
      case "D" -> 3;
      default -> -1;
    };
    if (index < 0 || index >= choices.size()) {
      return "";
    }
    return choices.get(index);
  }
}
