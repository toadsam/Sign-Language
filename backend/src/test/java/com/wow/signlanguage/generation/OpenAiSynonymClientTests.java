package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

/** No network: a mock server stands in for OpenAI. */
class OpenAiSynonymClientTests {
  static final String CHAT = "http://openai.test/chat";
  static final String EMBED = "http://openai.test/embeddings";
  static final ObjectMapper JSON = new ObjectMapper();

  RestTemplate http = new RestTemplate();
  MockRestServiceServer server;
  OpenAiSynonymClient client;
  AtomicReference<JsonNode> sent = new AtomicReference<>();

  @BeforeEach void setUp() {
    server = MockRestServiceServer.bindTo(http).build();
    client = new OpenAiSynonymClient(JSON, http, "test-key", "chat-model", CHAT, EMBED);
  }

  void capture(org.springframework.http.client.ClientHttpRequest request) throws java.io.IOException {
    sent.set(JSON.readTree(((MockClientHttpRequest) request).getBodyAsString()));
  }

  @Test void embedSendsModelDimensionsAndInputsAndReordersByIndex() {
    server.expect(requestTo(EMBED)).andExpect(method(HttpMethod.POST))
        .andExpect(header("Authorization", "Bearer test-key"))
        .andExpect(this::capture)
        .andRespond(withSuccess("""
            {"data": [{"index": 1, "embedding": [0, 1]}, {"index": 0, "embedding": [1, 0]}]}
            """, MediaType.APPLICATION_JSON));

    Optional<List<float[]>> vectors = client.embed(List.of("변소", "벗"), "embed-model", 2);

    server.verify();
    assertThat(sent.get().path("model").asText()).isEqualTo("embed-model");
    assertThat(sent.get().path("dimensions").asInt()).isEqualTo(2);
    assertThat(sent.get().path("input").toString()).isEqualTo("[\"변소\",\"벗\"]");
    assertThat(vectors).isPresent();
    assertThat(vectors.get().get(0)).containsExactly(1f, 0f);
    assertThat(vectors.get().get(1)).containsExactly(0f, 1f);
  }

  @Test void embedRejectsWrongCountsOrSizes() {
    server.expect(requestTo(EMBED)).andRespond(withSuccess(
        "{\"data\": [{\"index\": 0, \"embedding\": [1, 0]}]}", MediaType.APPLICATION_JSON));
    assertThat(client.embed(List.of("a", "b"), "m", 2)).isEmpty();
    server.reset();
    server.expect(requestTo(EMBED)).andRespond(withSuccess(
        "{\"data\": [{\"index\": 0, \"embedding\": [1, 0, 0]}]}", MediaType.APPLICATION_JSON));
    assertThat(client.embed(List.of("a"), "m", 2)).isEmpty();
  }

  @Test void embedServerErrorIsEmpty() {
    server.expect(requestTo(EMBED)).andRespond(withServerError());
    assertThat(client.embed(List.of("a"), "m", 2)).isEmpty();
  }

  @Test void chooseSendsSentenceAndCandidatesAtTemperatureZeroAsJson() {
    server.expect(requestTo(CHAT)).andExpect(method(HttpMethod.POST))
        .andExpect(this::capture)
        .andRespond(withSuccess(chatReply(
            "{\"choices\":[{\"word\":\"변소\",\"choice\":\"화장실\"},{\"word\":\"벗\",\"choice\":\"none\"}]}"),
            MediaType.APPLICATION_JSON));
    Map<String, List<String>> candidates = new LinkedHashMap<>();
    candidates.put("변소", List.of("화장실", "개"));
    candidates.put("벗", List.of("친구"));

    Optional<Map<String, String>> answers = client.choose("변소에서 벗을 만났다", candidates);

    server.verify();
    JsonNode request = sent.get();
    assertThat(request.path("model").asText()).isEqualTo("chat-model");
    assertThat(request.path("temperature").asInt()).isZero();
    assertThat(request.path("response_format").path("type").asText()).isEqualTo("json_object");
    assertThat(request.path("messages").path(0).path("content").asText()).isEqualTo(OpenAiSynonymClient.SYSTEM_PROMPT);
    assertThat(request.path("messages").path(1).path("content").asText()).isEqualTo(
        "{\"sentence\":\"변소에서 벗을 만났다\",\"words\":[{\"word\":\"변소\",\"candidates\":[\"화장실\",\"개\"]},"
            + "{\"word\":\"벗\",\"candidates\":[\"친구\"]}]}");
    assertThat(answers).contains(Map.of("변소", "화장실", "벗", "none"));
  }

  @Test void chooseMalformedContentIsEmpty() {
    server.expect(requestTo(CHAT)).andRespond(withSuccess(chatReply("not json"), MediaType.APPLICATION_JSON));
    assertThat(client.choose("s", Map.of("변소", List.of("화장실")))).isEmpty();
  }

  @Test void noKeyMeansNoRequest() {
    OpenAiSynonymClient keyless = new OpenAiSynonymClient(JSON, http, " ", "m", CHAT, EMBED);
    assertThat(keyless.configured()).isFalse();
    assertThat(keyless.embed(List.of("a"), "m", 2)).isEmpty();
    assertThat(keyless.choose("s", Map.of("a", List.of("b")))).isEmpty();
    server.verify();  // nothing expected, nothing sent
  }

  static String chatReply(String content) {
    try {
      return JSON.writeValueAsString(Map.of("choices", List.of(Map.of("message", Map.of("content", content)))));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }
}
