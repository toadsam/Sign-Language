package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wow.signlanguage.service.TranslationService;
import com.wow.signlanguage.translate.SimplificationMetadata;
import com.wow.signlanguage.translate.TranslatePlaybackItem;
import com.wow.signlanguage.translate.TranslateResponse;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** Production FastAPI loader -> actual B Generator; every input coordinate is synthetic. */
@EnabledIfEnvironmentVariable(named = "SIGN_TEST_BASELINE_URL", matches = ".+")
class BaselineHttpFlowTests {
  private static final ObjectMapper JSON = new ObjectMapper();

  static URI localUrl(String variable) {
    URI url = URI.create(System.getenv(variable));
    assertThat(url.getScheme()).isEqualTo("http");
    assertThat(url.getHost()).isIn("127.0.0.1", "localhost", "::1");
    return url;
  }

  static Stream<Arguments> sequences() {
    return Stream.of(
        Arguments.of(List.of("화장실", "있다"), List.of(1, 2), List.of(), true),
        Arguments.of(List.of("있다", "화장실", "있다"), List.of(2, 1, 2), List.of(), false),
        Arguments.of(List.of("미등록", "있다", "미등록"), List.of(2), List.of("미등록", "미등록"), true),
        Arguments.of(List.of("미등록", "미등록"), List.of(), List.of("미등록", "미등록"), false));
  }

  static TranslateResponse translated(List<String> gloss, boolean question) {
    return new TranslateResponse("합성 입력", "합성 번역", gloss, List.of(),
        new SimplificationMetadata(question, false, "present"), List.of(),
        List.of(new TranslatePlaybackItem("화장실", 1, "synthetic.mp4", "https://example.invalid/synthetic.mp4", true),
            new TranslatePlaybackItem("미등록", 0, "", "", false)), List.of("미등록"), List.of());
  }

  static MockMvc mvc(TranslationService translation, URI url) {
    GenerationSettings settings = new GenerationSettings(url, Duration.ofSeconds(1), Duration.ofSeconds(3), 4096, 1800);
    return MockMvcBuilders.standaloneSetup(new GenerationController(
        new GenerationService(translation, new InferenceClient(settings, JSON), settings)))
        .setControllerAdvice(new GenerationErrorHandler()).build();
  }

  @ParameterizedTest @MethodSource("sequences")
  void actualBaselinePreservesWordOrderAndEveryFloat(List<String> gloss, List<Integer> markers,
                                                   List<String> unknown, boolean question) throws Exception {
    TranslationService translation = mock(TranslationService.class);
    when(translation.translate("합성 입력")).thenReturn(translated(gloss, question));
    MockMvc mvc = mvc(translation, localUrl("SIGN_TEST_BASELINE_URL"));
    String first = null;
    // Repeat the HTTP request too, independently of repeated words within one request.
    for (int repeat = 0; repeat < 2; repeat++) {
      String body = mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
          .content("{\"text\":\"합성 입력\"}"))
          .andExpect(status().isOk()).andExpect(jsonPath("$.source").value("baseline"))
          .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
      JsonNode result = JSON.readTree(body);
      assertThat(result.size()).isEqualTo(9);
      assertThat(result.get("fps").intValue()).isEqualTo(30);
      assertThat(result.get("joints").intValue()).isEqualTo(125);
      assertThat(result.get("units").textValue()).isEqualTo("shoulder");
      int frames = markers.size() * 13; // source [2:15], active [6,10] with padding 4
      assertThat(result.get("frames").intValue()).isEqualTo(frames);
      assertThat(result.get("tokens")).isEqualTo(JSON.createArrayNode());
      assertThat(result.get("segments")).isEqualTo(JSON.createArrayNode());
      assertThat(result.get("unknown")).isEqualTo(JSON.valueToTree(unknown));
      byte[] raw = Base64.getDecoder().decode(result.get("data").textValue());
      assertThat(raw).hasSize(frames * 125 * 3 * Float.BYTES);
      ByteBuffer coordinates = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
      for (int frame = 0; frame < frames; frame++) {
        float marker = markers.get(frame / 13);
        int sourceFrame = frame % 13 + 2;
        for (int joint = 0; joint < 125; joint++) {
          for (int axis = 0; axis < 3; axis++) {
            assertThat(coordinates.getFloat()).isEqualTo(
                marker * 8f + sourceFrame / 32f + joint / 512f + axis / 4096f);
          }
        }
      }
      assertThat(coordinates.hasRemaining()).isFalse();
      if (first != null) assertThat(body).isEqualTo(first);
      first = body;
    }
    verify(translation, times(2)).translate("합성 입력");
    verifyNoMoreInteractions(translation);
  }

  @Test @EnabledIfEnvironmentVariable(named = "SIGN_TEST_UNAVAILABLE_URL", matches = ".+")
  void badProductionConfigReturnsUnavailableWithoutVideo() throws Exception {
    TranslationService translation = mock(TranslationService.class);
    when(translation.translate("합성 입력")).thenReturn(translated(List.of("화장실", "미등록"), true));
    MockMvc mvc = mvc(translation, localUrl("SIGN_TEST_UNAVAILABLE_URL"));
    mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
        .content("{\"text\":\"합성 입력\"}"))
        .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.error.code").value("GENERATION_UNAVAILABLE"))
        .andExpect(jsonPath("$.error.retryable").value(true))
        .andExpect(jsonPath("$.source").doesNotExist()).andExpect(jsonPath("$.items").doesNotExist())
        .andExpect(jsonPath("$.data").doesNotExist());
    verify(translation, times(1)).translate("합성 입력");
  }
}
