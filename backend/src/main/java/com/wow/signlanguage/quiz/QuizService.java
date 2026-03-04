package com.wow.signlanguage.quiz;

import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.QuerySnapshot;
import com.wow.signlanguage.quiz.dto.QuizAnswerRequest;
import com.wow.signlanguage.quiz.dto.QuizAnswerResponse;
import com.wow.signlanguage.quiz.dto.QuizSessionQuestionResponse;
import com.wow.signlanguage.quiz.dto.QuizSessionResponse;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutionException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class QuizService {
  private static final String COLLECTION_NAME = "quiz_items";
  private static final int DEFAULT_COUNT = 10;
  private static final int MAX_COUNT = 50;

  private final Firestore firestore;

  public QuizService(Firestore firestore) {
    this.firestore = firestore;
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
        String questionText = doc.getString("questionText");
        String videoUrl = doc.getString("videoUrl");
        List<String> choices = toStringList(doc.get("choices"));

        if (isBlank(questionText) || isBlank(videoUrl) || choices.size() != 4) {
          continue;
        }

        questions.add(
            new QuizSessionQuestionResponse(
                doc.getId(),
                questionText,
                choices,
                videoUrl,
                doc.getLong("level") == null ? 1L : doc.getLong("level")));
      }
      return questions;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Firestore read interrupted.", e);
    } catch (ExecutionException e) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to load quiz session.", e);
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

  private int normalizeCount(int count) {
    if (count <= 0) {
      return DEFAULT_COUNT;
    }
    return Math.min(count, MAX_COUNT);
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
