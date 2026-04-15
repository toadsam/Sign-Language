package com.wow.signlanguage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class OpenAiMorphologyNormalizerService {

  private static final Duration TIMEOUT = Duration.ofSeconds(10);

  private final ObjectMapper objectMapper;
  private final RestTemplate restTemplate;

  @Value("${openai.morphology.enabled:true}")
  private boolean enabled;

  @Value("${openai.api-key:}")
  private String apiKey;

  @Value("${openai.model:gpt-4o-mini}")
  private String model;

  @Value("${openai.chat-completions-url:https://api.openai.com/v1/chat/completions}")
  private String chatCompletionsUrl;

  public OpenAiMorphologyNormalizerService(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
    SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
    requestFactory.setConnectTimeout((int) TIMEOUT.toMillis());
    requestFactory.setReadTimeout((int) TIMEOUT.toMillis());
    this.restTemplate = new RestTemplate(requestFactory);
  }

  public Optional<MorphologyNormalizationResult> normalize(String input) {
    if (!enabled || apiKey == null || apiKey.isBlank() || input == null || input.isBlank()) {
      return Optional.empty();
    }

    try {
      String response = restTemplate.postForObject(
          chatCompletionsUrl,
          new HttpEntity<>(buildRequest(input), buildHeaders()),
          String.class
      );

      if (response == null || response.isBlank()) {
        return Optional.empty();
      }

      JsonNode root = objectMapper.readTree(response);
      String content = root.path("choices").path(0).path("message").path("content").asText("");
      if (content.isBlank()) {
        return Optional.empty();
      }

      JsonNode normalized = objectMapper.readTree(content);
      List<String> tokens = extractTokens(normalized.path("tokens"));
      if (tokens.isEmpty()) {
        return Optional.empty();
      }

      return Optional.of(new MorphologyNormalizationResult(
          normalized.path("simplifiedSentence").asText(String.join(" ", tokens)),
          tokens,
          normalized.path("tense").asText("")
      ));
    } catch (Exception ignored) {
      return Optional.empty();
    }
  }

  private HttpHeaders buildHeaders() {
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    headers.setBearerAuth(apiKey);
    return headers;
  }

  private String buildRequest(String input) throws Exception {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("model", model);
    root.put("temperature", 0);
    root.set("response_format", objectMapper.createObjectNode().put("type", "json_object"));

    ArrayNode messages = root.putArray("messages");
    messages.addObject()
        .put("role", "system")
        .put("content", String.join("\n",
            "You normalize Korean text for a Korean Sign Language lookup system.",
            "Return JSON only.",
            "Extract content words in natural order.",
            "Convert Korean verbs and adjectives to dictionary form ending in '-다'.",
            "Separate messy endings for tense, aspect, guess, intention, and politeness.",
            "Do not translate to English.",
            "Do not invent words not supported by the input.",
            "Return this shape exactly: {\"simplifiedSentence\":\"...\",\"tokens\":[\"...\"],\"tense\":\"past|present|future|unknown\"}."));
    messages.addObject()
        .put("role", "user")
        .put("content", input);

    return objectMapper.writeValueAsString(root);
  }

  private List<String> extractTokens(JsonNode tokensNode) {
    if (!tokensNode.isArray()) {
      return List.of();
    }

    LinkedHashSet<String> tokens = new LinkedHashSet<>();
    for (JsonNode tokenNode : tokensNode) {
      String token = tokenNode.asText("").trim();
      if (!token.isBlank()) {
        tokens.add(token);
      }
    }
    return new ArrayList<>(tokens);
  }

  public record MorphologyNormalizationResult(
      String simplifiedSentence,
      List<String> tokens,
      String tense
  ) {
  }
}
