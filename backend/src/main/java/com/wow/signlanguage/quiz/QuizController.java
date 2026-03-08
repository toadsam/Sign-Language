package com.wow.signlanguage.quiz;

import com.wow.signlanguage.quiz.dto.QuizAnswerRequest;
import com.wow.signlanguage.quiz.dto.QuizAnswerResponse;
import com.wow.signlanguage.quiz.dto.QuizSessionResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/quiz")
public class QuizController {
  private final QuizService quizService;

  public QuizController(QuizService quizService) {
    this.quizService = quizService;
  }

  @GetMapping("/session")
  public QuizSessionResponse session(@RequestParam(defaultValue = "10") int count) {
    return quizService.getSession(count);
  }

  @GetMapping("/session/wrong")
  public QuizSessionResponse wrongSession(
      @RequestParam String uid,
      @RequestParam(defaultValue = "10") int count) {
    return quizService.getWrongSession(uid, count);
  }

  @PostMapping("/answer")
  public QuizAnswerResponse answer(@RequestBody QuizAnswerRequest request) {
    return quizService.checkAnswer(request);
  }
}
