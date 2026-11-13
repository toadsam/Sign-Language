package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** Opt-in test against serve.demo on localhost; no real translation/model services. */
@EnabledIfEnvironmentVariable(named = "SIGN_TEST_FASTAPI_URL", matches = ".+")
class GenerationHttpFlowTests {
  @Test void springControllerThroughRealFastApiAndBack() throws Exception {
    URI url = URI.create(System.getenv("SIGN_TEST_FASTAPI_URL"));
    assertThat(url.getHost()).isIn("127.0.0.1", "localhost", "::1");
    ObjectMapper json = new ObjectMapper();
    GlossTranslator translation = mock(GlossTranslator.class);
    when(translation.translate("화장실 있어요?")).thenReturn(new GlossTranslator.Gloss(List.of("화장실", "있다"), true));
    GenerationSettings settings = new GenerationSettings(url, Duration.ofSeconds(1), Duration.ofSeconds(3), 4096, 1800);
    MockMvc mvc = MockMvcBuilders.standaloneSetup(new GenerationController(
        new GenerationService(translation, new InferenceClient(settings, json), settings)))
        .setControllerAdvice(new GenerationErrorHandler()).build();
    String body = mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
        .content("{\"text\":\"화장실 있어요?\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.source").value("baseline"))
        .andExpect(jsonPath("$.frames").value(1)).andReturn().getResponse().getContentAsString();
    JsonNode result = json.readTree(body);
    byte[] raw = Base64.getDecoder().decode(result.get("data").textValue());
    assertThat(raw).hasSize(1500);
    ByteBuffer coordinates = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
    for (int joint = 0; joint < 125; joint++) {
      assertThat(coordinates.getFloat()).isEqualTo(joint / 125f);
      assertThat(coordinates.getFloat()).isZero();
      assertThat(coordinates.getFloat()).isZero();
    }
    verify(translation, times(1)).translate("화장실 있어요?");
  }
}
