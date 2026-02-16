package com.wow.signlanguage.api;

import com.wow.signlanguage.service.TranslationService;
import com.wow.signlanguage.translate.TranslateRequest;
import com.wow.signlanguage.translate.TranslateResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class TranslateController {

  private final TranslationService translationService;

  public TranslateController(TranslationService translationService) {
    this.translationService = translationService;
  }

  @PostMapping("/translate")
  public TranslateResponse translate(@RequestBody TranslateRequest request) {
    String text = request == null ? "" : request.text();
    return translationService.translate(text);
  }
}
