package com.wow.signlanguage.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class ExternalLexiconApiClient {

  private static final Pattern XML_WORD_PATTERN = Pattern.compile("<word>([^<]+)</word>");

  private final ObjectMapper objectMapper;
  private final RestTemplate restTemplate = new RestTemplate();

  @Value("${external.api.etri.enabled:true}")
  private boolean etriEnabled;
  @Value("${external.api.etri.access-key:}")
  private String etriAccessKey;
  @Value("${external.api.etri.url:http://aiopen.etri.re.kr:8000/WiseNLU_spoken}")
  private String etriUrl;

  @Value("${external.api.urimalsam.enabled:true}")
  private boolean urimalsamEnabled;
  @Value("${external.api.urimalsam.api-key:}")
  private String urimalsamApiKey;
  @Value("${external.api.urimalsam.url:https://opendict.korean.go.kr/api/search}")
  private String urimalsamUrl;

  @Value("${external.api.krdict.enabled:true}")
  private boolean krdictEnabled;
  @Value("${external.api.krdict.api-key:}")
  private String krdictApiKey;
  @Value("${external.api.krdict.url:https://krdict.korean.go.kr/api/search}")
  private String krdictUrl;

  public ExternalLexiconApiClient(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  public List<String> fetchCandidates(String token) {
    LinkedHashSet<String> candidates = new LinkedHashSet<>();
    candidates.addAll(fetchEtriLemmas(token));
    candidates.addAll(fetchUrimalsamWords(token));
    candidates.addAll(fetchKrDictWords(token));
    candidates.removeIf(String::isBlank);
    return new ArrayList<>(candidates);
  }

  private List<String> fetchEtriLemmas(String token) {
    if (!etriEnabled || etriAccessKey == null || etriAccessKey.isBlank()) {
      return List.of();
    }

    try {
      String body = objectMapper.writeValueAsString(
          objectMapper.createObjectNode()
              .put("access_key", etriAccessKey)
              .set("argument", objectMapper.createObjectNode()
                  .put("text", token)
                  .put("analysis_code", "morp"))
      );

      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(MediaType.APPLICATION_JSON);
      String response = restTemplate.postForObject(etriUrl, new HttpEntity<>(body, headers), String.class);
      if (response == null || response.isBlank()) {
        return List.of();
      }

      JsonNode root = objectMapper.readTree(response);
      JsonNode sentence = root.path("return_object").path("sentence");
      if (!sentence.isArray()) {
        return List.of();
      }

      Set<String> lemmas = new LinkedHashSet<>();
      for (JsonNode sentenceNode : sentence) {
        JsonNode morp = sentenceNode.path("morp");
        if (!morp.isArray()) {
          continue;
        }
        for (JsonNode morpNode : morp) {
          String lemma = morpNode.path("lemma").asText("");
          if (!lemma.isBlank()) {
            lemmas.add(lemma);
          }
        }
      }
      return new ArrayList<>(lemmas);
    } catch (Exception ignored) {
      return List.of();
    }
  }

  private List<String> fetchUrimalsamWords(String token) {
    if (!urimalsamEnabled || urimalsamApiKey == null || urimalsamApiKey.isBlank()) {
      return List.of();
    }
    try {
      String encoded = URLEncoder.encode(token, StandardCharsets.UTF_8);
      String url = urimalsamUrl + "?key=" + urimalsamApiKey + "&q=" + encoded + "&req_type=json&num=10";
      String response = restTemplate.getForObject(url, String.class);
      return extractWords(response);
    } catch (Exception ignored) {
      return List.of();
    }
  }

  private List<String> fetchKrDictWords(String token) {
    if (!krdictEnabled || krdictApiKey == null || krdictApiKey.isBlank()) {
      return List.of();
    }
    try {
      String encoded = URLEncoder.encode(token, StandardCharsets.UTF_8);
      String url = krdictUrl + "?key=" + krdictApiKey + "&q=" + encoded + "&translated=y&num=10";
      String response = restTemplate.getForObject(url, String.class);
      return extractWords(response);
    } catch (Exception ignored) {
      return List.of();
    }
  }

  private List<String> extractWords(String payload) {
    if (payload == null || payload.isBlank()) {
      return List.of();
    }

    LinkedHashSet<String> words = new LinkedHashSet<>();

    try {
      JsonNode root = objectMapper.readTree(payload);
      collectJsonWords(root, words);
      if (!words.isEmpty()) {
        return new ArrayList<>(words);
      }
    } catch (Exception ignored) {
      // fall back to xml pattern parsing
    }

    Matcher matcher = XML_WORD_PATTERN.matcher(payload);
    while (matcher.find()) {
      words.add(matcher.group(1).trim());
    }
    return new ArrayList<>(words);
  }

  private void collectJsonWords(JsonNode node, Set<String> words) {
    if (node == null || node.isNull()) {
      return;
    }

    if (node.isObject()) {
      if (node.has("word")) {
        String value = node.path("word").asText("");
        if (!value.isBlank()) {
          words.add(value);
        }
      }
      node.fields().forEachRemaining(entry -> collectJsonWords(entry.getValue(), words));
      return;
    }

    if (node.isArray()) {
      for (JsonNode child : node) {
        collectJsonWords(child, words);
      }
    }
  }
}
