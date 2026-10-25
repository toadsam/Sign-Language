package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wow.signlanguage.service.TranslationService;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** Actual CPU model checkpoints -> A loader -> B adapter -> FastAPI -> Spring. */
@EnabledIfEnvironmentVariable(named = "SIGN_TEST_MODELS_FILE", matches = ".+")
class ModelHttpFlowTests {
  private static final ObjectMapper JSON = new ObjectMapper();

  static JsonNode manifest() throws Exception {
    return JSON.readTree(Files.readString(Path.of(System.getenv("SIGN_TEST_MODELS_FILE"))));
  }

  static MockMvc mvc(TranslationService translation, String address, int timeoutMillis) {
    URI url = URI.create(address);
    assertThat(url.getScheme()).isEqualTo("http");
    assertThat(url.getHost()).isEqualTo("127.0.0.1");
    GenerationSettings settings = new GenerationSettings(url, Duration.ofSeconds(1),
        Duration.ofMillis(timeoutMillis), 4096, 1800);
    return MockMvcBuilders.standaloneSetup(new GenerationController(
        new GenerationService(translation, new InferenceClient(settings, JSON), settings)))
        .setControllerAdvice(new GenerationErrorHandler()).build();
  }

  static Stream<Arguments> sequences() {
    List<Arguments> cases = new ArrayList<>();
    for (String kind : List.of("word_gpt", "word_regress")) {
      for (List<String> gloss : List.of(List.of("화장실", "있다"), List.of("있다", "화장실", "있다"),
          List.of("미등록", "있다", "미등록"), List.of("미등록", "미등록"))) {
        cases.add(Arguments.of(kind, gloss));
      }
    }
    return cases.stream();
  }

  @ParameterizedTest @MethodSource("sequences")
  void realModelResponsePreservesContract(String kind, List<String> gloss) throws Exception {
    JsonNode model = manifest().get("models").get(kind);
    TranslationService translation = mock(TranslationService.class);
    when(translation.translate("합성 입력")).thenReturn(BaselineHttpFlowTests.translated(gloss, true));
    MockMvc mvc = mvc(translation, model.get("url").textValue(), 3000);
    List<String> known = gloss.stream().filter(word -> !word.equals("미등록")).toList();
    List<String> unknown = gloss.stream().filter(word -> word.equals("미등록")).toList();
    for (int repeat = 0; repeat < 2; repeat++) {
      String body = mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
          .content("{\"text\":\"합성 입력\"}"))
          .andExpect(status().isOk()).andExpect(jsonPath("$.source").value("model"))
          .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
      JsonNode result = JSON.readTree(body);
      assertThat(result.size()).isEqualTo(9);
      assertThat(result.get("fps").intValue()).isEqualTo(30);
      assertThat(result.get("joints").intValue()).isEqualTo(125);
      assertThat(result.get("units").textValue()).isEqualTo("shoulder");
      assertThat(result.get("segments")).isEqualTo(JSON.createArrayNode());
      assertThat(result.get("unknown")).isEqualTo(JSON.valueToTree(unknown));
      int frames = result.get("frames").intValue();
      JsonNode tokens = result.get("tokens");
      assertThat(tokens.isArray()).isTrue();
      byte[] raw = Base64.getDecoder().decode(result.get("data").textValue());
      assertThat(raw).hasSize(frames * 125 * 3 * Float.BYTES);
      ByteBuffer coordinates = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
      while (coordinates.hasRemaining()) assertThat(Float.isFinite(coordinates.getFloat())).isTrue();
      if (kind.equals("word_gpt")) {
        assertThat(tokens.size()).isEqualTo(known.size() * model.get("max_len").intValue());
        assertThat(frames).isEqualTo(tokens.size() * model.get("down").intValue());
        for (JsonNode token : tokens) {
          assertThat(token.isIntegralNumber()).isTrue();
          assertThat(token.intValue()).isBetween(0, model.get("nb_code").intValue() - 1);
        }
        // Unseeded GPT draws are checked independently; repeated responses need not match.
      } else {
        assertThat(tokens).isEqualTo(JSON.createArrayNode());
        assertThat(frames).isEqualTo(known.size() * model.get("length").intValue());
        ByteArrayOutputStream expected = new ByteArrayOutputStream();
        for (String word : known) expected.write(Base64.getDecoder().decode(model.get("oracle").get(word).textValue()));
        assertThat(raw).isEqualTo(expected.toByteArray()); // independent A forward-pass word-order oracle
      }
    }
    verify(translation, times(2)).translate("합성 입력");
    verifyNoMoreInteractions(translation);
  }

  static Stream<Arguments> failures() throws Exception {
    List<Arguments> cases = new ArrayList<>();
    for (JsonNode failure : manifest().get("failures")) {
      cases.add(Arguments.of(failure.get("kind").textValue(), failure.get("failure").textValue(),
          failure.get("url").textValue(), failure.get("timeout_ms").intValue(),
          failure.get("status").intValue(), failure.get("code").textValue(),
          failure.has("recovery_url") ? failure.get("recovery_url").textValue() : ""));
    }
    return cases.stream();
  }

  @ParameterizedTest @MethodSource("failures")
  void modelFailuresReturnErrorsAndAllowExplicitUserRetry(
      String kind, String failure, String url, int timeoutMillis, int expectedStatus,
      String expectedCode, String recoveryUrl) throws Exception {
    assertThat(kind).isIn("word_gpt", "word_regress");
    assertThat(failure).isNotBlank();
    TranslationService translation = mock(TranslationService.class);
    when(translation.translate("합성 입력")).thenReturn(
        BaselineHttpFlowTests.translated(List.of("화장실", "있다"), true));
    MockMvc mvc = mvc(translation, url, timeoutMillis);
    mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
        .content("{\"text\":\"합성 입력\"}"))
        .andExpect(status().is(expectedStatus)).andExpect(jsonPath("$.error.code").value(expectedCode))
        .andExpect(jsonPath("$.error.retryable").value(true))
        .andExpect(jsonPath("$.error.message").isNotEmpty())
        .andExpect(jsonPath("$.source").doesNotExist()).andExpect(jsonPath("$.items").doesNotExist())
        .andExpect(jsonPath("$.data").doesNotExist());
    verify(translation, times(1)).translate("합성 입력");
    if (!recoveryUrl.isEmpty()) {
      URI control = URI.create(recoveryUrl);
      assertThat(control.getHost()).isEqualTo("127.0.0.1");
      HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
      var recovered = http.send(HttpRequest.newBuilder(control).timeout(Duration.ofSeconds(10))
          .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
      assertThat(recovered.statusCode()).isEqualTo(200);
      mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
          .content("{\"text\":\"합성 입력\"}"))
          .andExpect(status().isOk()).andExpect(jsonPath("$.source").value("model"));
      verify(translation, times(2)).translate("합성 입력");
    }
    verifyNoMoreInteractions(translation);
  }
}
