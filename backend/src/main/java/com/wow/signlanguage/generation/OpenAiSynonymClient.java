package com.wow.signlanguage.generation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * The two OpenAI calls of the synonym step: embeddings (to find candidate words) and one chat completion
 * (to decide, in context, whether a candidate means the same thing). Every failure is an empty result;
 * the caller then keeps the original words.
 */
@Component
public class OpenAiSynonymClient {
  private static final Logger log = LoggerFactory.getLogger(OpenAiSynonymClient.class);
  private static final Duration TIMEOUT = Duration.ofSeconds(10);
  static final String NONE = "none";

  static final String SYSTEM_PROMPT = String.join("\n",
      "You map Korean words onto a fixed Korean Sign Language vocabulary.",
      "For each word you get the sentence it came from and candidate words from the vocabulary.",
      "Pick a candidate only if, in this sentence, it means essentially the same thing as the word:",
      "a synonym, a different register or spelling, or another dictionary form of the same concept",
      "(e.g. 변소 -> 화장실, 뵙다 -> 만나다).",
      "Never pick a word that is only related, broader, narrower, or opposite (e.g. 고양이 -> 개, 사과 -> 과일).",
      "If no candidate means the same thing, or you are unsure, answer \"none\".",
      "Copy candidates exactly. Return JSON only, in this shape:",
      "{\"choices\":[{\"word\":\"<word>\",\"choice\":\"<one candidate or none>\"}]}");

  private final ObjectMapper mapper;
  private final RestTemplate http;
  private final String apiKey;
  private final String chatModel;
  private final String chatUrl;
  private final String embeddingsUrl;

  @Autowired
  public OpenAiSynonymClient(ObjectMapper mapper,
                             @Value("${openai.api-key:}") String apiKey,
                             @Value("${openai.model:gpt-4o-mini}") String chatModel,
                             @Value("${openai.chat-completions-url:https://api.openai.com/v1/chat/completions}")
                             String chatUrl,
                             @Value("${openai.embeddings-url:https://api.openai.com/v1/embeddings}")
                             String embeddingsUrl) {
    this(mapper, defaultHttp(), apiKey, chatModel, chatUrl, embeddingsUrl);
  }

  OpenAiSynonymClient(ObjectMapper mapper, RestTemplate http, String apiKey, String chatModel, String chatUrl,
                      String embeddingsUrl) {
    this.mapper = mapper;
    this.http = http;
    this.apiKey = apiKey == null ? "" : apiKey.trim();
    this.chatModel = chatModel;
    this.chatUrl = chatUrl;
    this.embeddingsUrl = embeddingsUrl;
  }

  private static RestTemplate defaultHttp() {
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout((int) TIMEOUT.toMillis());
    factory.setReadTimeout((int) TIMEOUT.toMillis());
    return new RestTemplate(factory);
  }

  public boolean configured() {
    return !apiKey.isEmpty();
  }

  /** One vector per input, in input order; empty on any failure. */
  public Optional<List<float[]>> embed(List<String> inputs, String model, int dimensions) {
    if (!configured() || inputs.isEmpty()) return Optional.empty();
    try {
      ObjectNode request = mapper.createObjectNode();
      request.put("model", model);
      if (dimensions > 0) request.put("dimensions", dimensions);
      inputs.forEach(request.putArray("input")::add);
      JsonNode data = post(embeddingsUrl, request).path("data");
      if (!data.isArray() || data.size() != inputs.size()) throw new IllegalStateException("embedding count");
      float[][] vectors = new float[inputs.size()][];
      for (JsonNode item : data) {
        int index = item.path("index").asInt(-1);
        JsonNode values = item.path("embedding");
        if (index < 0 || index >= vectors.length || vectors[index] != null || !values.isArray()
            || (dimensions > 0 && values.size() != dimensions)) {
          throw new IllegalStateException("embedding shape");
        }
        float[] vector = new float[values.size()];
        for (int i = 0; i < vector.length; i++) vector[i] = (float) values.get(i).asDouble();
        vectors[index] = vector;
      }
      return Optional.of(List.of(vectors));
    } catch (Exception error) {
      log.warn("OpenAI embeddings failed ({})", error.getClass().getSimpleName());
      return Optional.empty();
    }
  }

  /**
   * Asks which candidate, if any, means the same as each word in {@code sentence}.
   * Returns word -> raw answer (a candidate, or anything else for "keep"); the caller validates it.
   */
  public Optional<Map<String, String>> choose(String sentence, Map<String, List<String>> candidates) {
    if (!configured() || candidates.isEmpty()) return Optional.empty();
    try {
      ObjectNode question = mapper.createObjectNode();
      question.put("sentence", sentence);
      ArrayNode words = question.putArray("words");
      candidates.forEach((word, options) -> {
        ObjectNode item = words.addObject().put("word", word);
        options.forEach(item.putArray("candidates")::add);
      });

      ObjectNode request = mapper.createObjectNode();
      request.put("model", chatModel);
      request.put("temperature", 0);
      request.set("response_format", mapper.createObjectNode().put("type", "json_object"));
      ArrayNode messages = request.putArray("messages");
      messages.addObject().put("role", "system").put("content", SYSTEM_PROMPT);
      messages.addObject().put("role", "user").put("content", mapper.writeValueAsString(question));

      String content = post(chatUrl, request).path("choices").path(0).path("message").path("content").asText("");
      JsonNode choices = mapper.readTree(content).path("choices");
      if (!choices.isArray()) throw new IllegalStateException("no choices");
      Map<String, String> answers = new LinkedHashMap<>();
      for (JsonNode item : choices) {
        String word = item.path("word").asText("");
        String choice = item.path("choice").asText("").trim();
        if (!word.isEmpty() && !answers.containsKey(word)) answers.put(word, choice);
      }
      return Optional.of(answers);
    } catch (Exception error) {
      log.warn("OpenAI synonym choice failed ({})", error.getClass().getSimpleName());
      return Optional.empty();
    }
  }

  private JsonNode post(String url, ObjectNode body) throws Exception {
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    headers.setBearerAuth(apiKey);
    String response = http.postForObject(url, new HttpEntity<>(mapper.writeValueAsString(body), headers), String.class);
    if (response == null || response.isBlank()) throw new IllegalStateException("empty response");
    return mapper.readTree(response);
  }

  /** Splits words into request-sized batches for the cache builder. */
  static List<List<String>> batches(List<String> words, int size) {
    List<List<String>> batches = new ArrayList<>();
    for (int i = 0; i < words.size(); i += size) batches.add(words.subList(i, Math.min(words.size(), i + size)));
    return batches;
  }
}
