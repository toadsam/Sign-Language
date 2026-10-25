package com.wow.signlanguage.generation;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GenerationController {
  private final GenerationService generation;

  public GenerationController(GenerationService generation) {
    this.generation = generation;
  }

  @PostMapping("/api/sign/generate")
  public Object generate(@RequestBody JsonNode request) {
    if (request == null || !request.isObject() || request.size() != 1
        || !request.hasNonNull("text") || !request.get("text").isTextual()) {
      throw new GenerationFailure(GenerationFailure.Reason.INVALID_REQUEST);
    }
    return generation.generate(request.get("text").textValue());
  }
}
