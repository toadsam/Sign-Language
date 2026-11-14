package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** sign.generation.translator=serve: the inference server's own POST /translate replaces GlossTranslator. */
class ServeTranslatorTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();
  private static final Map<String, Stub> STUBS = new ConcurrentHashMap<>();
  private static final Map<String, JsonNode> RECEIVED = new ConcurrentHashMap<>();
  private static final Map<String, Integer> REQUESTS = new ConcurrentHashMap<>();
  private static HttpServer server;
  private GlossTranslator glossTranslator;
  private MockMvc mvc;

  record Stub(int status, String body) {}

  @BeforeAll static void startServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(EXECUTOR);
    for (String path : List.of("/generate", "/translate")) {
      server.createContext(path, exchange -> {
        try {
          REQUESTS.merge(path, 1, Integer::sum);
          RECEIVED.put(path, JSON.readTree(exchange.getRequestBody()));
          Stub stub = STUBS.get(path);
          byte[] body = stub.body().getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().set("Content-Type", "application/json");
          exchange.sendResponseHeaders(stub.status(), body.length);
          exchange.getResponseBody().write(body);
        } finally {
          exchange.close();
        }
      });
    }
    server.start();
  }

  @AfterAll static void stopServer() {
    server.stop(0);
    EXECUTOR.shutdownNow();
  }

  @BeforeEach void prepare() {
    STUBS.clear();
    RECEIVED.clear();
    REQUESTS.clear();
    STUBS.put("/translate", new Stub(200, translation(List.of("화장실", "있다"), List.of()).toString()));
    STUBS.put("/generate", new Stub(200, GenerationApiTests.motion().toString()));
    glossTranslator = mock(GlossTranslator.class);
    GenerationSettings settings = settings("serve", null);
    mvc = MockMvcBuilders.standaloneSetup(new GenerationController(
        new GenerationService(glossTranslator, new InferenceClient(settings, JSON), settings)))
        .setControllerAdvice(new GenerationErrorHandler()).build();
  }

  static GenerationSettings settings(String translator, String translateUrl) {
    URI url = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/generate");
    return new GenerationSettings(url, Duration.ofSeconds(1), Duration.ofSeconds(2), 64, 2, translator,
        translateUrl == null ? null : URI.create(translateUrl));
  }

  static ObjectNode translation(List<String> gloss, List<String> unknown) {
    ObjectNode node = JSON.createObjectNode();
    node.set("gloss", JSON.valueToTree(gloss));
    node.set("units", JSON.valueToTree(gloss));
    node.set("senses", JSON.valueToTree(gloss));
    node.set("unknown", JSON.valueToTree(unknown));
    node.putArray("dropped").add("요");
    node.put("translator", "madi");
    return node;
  }

  ResultActions send(String text) throws Exception {
    return mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
        .content(JSON.writeValueAsString(Map.of("text", text))));
  }

  int requests(String path) {
    return REQUESTS.getOrDefault(path, 0);
  }

  @Test void translatesOnServerAndGeneratesWithoutSpringTranslator() throws Exception {
    String content = send("화장실 있어요").andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();
    assertThat(JSON.readTree(content)).isEqualTo(GenerationApiTests.motion());
    assertThat(RECEIVED.get("/translate")).isEqualTo(JSON.valueToTree(Map.of("text", "화장실 있어요")));
    assertThat(RECEIVED.get("/generate").get("gloss")).isEqualTo(JSON.valueToTree(List.of("화장실", "있다")));
    assertThat(RECEIVED.get("/generate").get("nonmanual").isEmpty()).isTrue();
    verifyNoInteractions(glossTranslator);
  }

  @Test void unknownFragmentsAreAppendedAndComeBackAsUnknown() throws Exception {
    STUBS.put("/translate", new Stub(200, translation(List.of("화장실"), List.of("미등록", "모름")).toString()));
    ObjectNode motion = GenerationApiTests.motion();
    motion.withArray("unknown").add("미등록").add("모름");
    STUBS.put("/generate", new Stub(200, motion.toString()));
    send("미등록 화장실 모름").andExpect(status().isOk())
        .andExpect(jsonPath("$.unknown[0]").value("미등록")).andExpect(jsonPath("$.unknown[1]").value("모름"));
    assertThat(RECEIVED.get("/generate").get("gloss"))
        .isEqualTo(JSON.valueToTree(List.of("화장실", "미등록", "모름")));
  }

  @Test void allDroppedIsNoGeneratableInput() throws Exception {
    STUBS.put("/translate", new Stub(200, translation(List.of(), List.of()).toString()));
    send("요").andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.error.code").value("NO_GENERATABLE_INPUT"));
    assertThat(requests("/generate")).isZero();
  }

  @Test void tooManyWordsIsNoGeneratableInput() throws Exception {
    List<String> many = IntStream.range(0, GenerationService.MAX_WORDS + 1).mapToObj(i -> "w" + i)
        .collect(Collectors.toList());
    STUBS.put("/translate", new Stub(200, translation(many, List.of()).toString()));
    send("긴 문장").andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.error.code").value("NO_GENERATABLE_INPUT"));
    assertThat(requests("/generate")).isZero();
  }

  @Test void translator422IsNoGeneratableInput() throws Exception {
    STUBS.put("/translate", new Stub(422, "{\"detail\":\"x\"}"));
    send("문장").andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.error.code").value("NO_GENERATABLE_INPUT"));
    assertThat(requests("/generate")).isZero();
  }

  @Test void translatorUnavailableIs503() throws Exception {
    STUBS.put("/translate", new Stub(503, "{\"detail\":\"Translator unavailable\"}"));
    send("문장").andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.error.code").value("GENERATION_UNAVAILABLE"))
        .andExpect(jsonPath("$.error.retryable").value(true));
    assertThat(requests("/generate")).isZero();
  }

  @Test void translatorServerErrorIs502() throws Exception {
    STUBS.put("/translate", new Stub(500, "{\"detail\":\"SECRET\"}"));
    send("문장").andExpect(status().isBadGateway())
        .andExpect(jsonPath("$.error.code").value("GENERATION_FAILED"))
        .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("SECRET"))));
  }

  @ParameterizedTest @ValueSource(strings = {"{", "[]", "{}", "{\"gloss\":[\"a\"]}", "{\"gloss\":\"a\",\"unknown\":[]}",
      "{\"gloss\":[\" \"],\"unknown\":[]}", "{\"gloss\":[1],\"unknown\":[]}", "{\"gloss\":[null],\"unknown\":[]}",
      "{\"gloss\":[\"a\"],\"unknown\":[2]}", "{\"gloss\":[\"a\"],\"unknown\":null}"})
  void malformedTranslationIsTranslationUnavailable(String body) throws Exception {
    STUBS.put("/translate", new Stub(200, body));
    send("문장").andExpect(status().isBadGateway())
        .andExpect(jsonPath("$.error.code").value("TRANSLATION_UNAVAILABLE"))
        .andExpect(jsonPath("$.error.retryable").value(true));
    assertThat(requests("/generate")).isZero();
  }

  @ParameterizedTest @ValueSource(strings = {"화장실 있어요?", "화장실 있어요？", "화장실 있어요?  "})
  void questionMarkSetsQuestionNonmanual(String text) throws Exception {
    send(text).andExpect(status().isOk());
    assertThat(RECEIVED.get("/generate").get("nonmanual")).isEqualTo(JSON.valueToTree(List.of("의문")));
  }

  @Test void connectionRefusedIsUnavailable() throws Exception {
    int port;
    try (java.net.ServerSocket temporary = new java.net.ServerSocket(0, 0, java.net.InetAddress.getByName("127.0.0.1"))) {
      port = temporary.getLocalPort();
    }
    GenerationSettings settings = settings("serve", "http://127.0.0.1:" + port + "/translate");
    MockMvc isolated = MockMvcBuilders.standaloneSetup(new GenerationController(
        new GenerationService(glossTranslator, new InferenceClient(settings, JSON), settings)))
        .setControllerAdvice(new GenerationErrorHandler()).build();
    isolated.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"문장\"}"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.error.code").value("GENERATION_UNAVAILABLE"));
    assertThat(requests("/generate")).isZero();
  }

  @Test void springModeStillUsesGlossTranslator() throws Exception {
    when(glossTranslator.translate("문장")).thenReturn(new GlossTranslator.Gloss(List.of("화장실", "있다"), false));
    GenerationSettings settings = settings(null, null);
    assertThat(settings.translator()).isEqualTo("spring");
    MockMvc spring = MockMvcBuilders.standaloneSetup(new GenerationController(
        new GenerationService(glossTranslator, new InferenceClient(settings, JSON), settings)))
        .setControllerAdvice(new GenerationErrorHandler()).build();
    spring.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"문장\"}"))
        .andExpect(status().isOk());
    verify(glossTranslator, times(1)).translate("문장");
    assertThat(requests("/translate")).isZero();
  }

  @Test void translateUrlIsDerivedFromGenerateUrl() {
    Duration second = Duration.ofSeconds(1);
    assertThat(new GenerationSettings(URI.create("http://10.0.0.5:8000/generate"), second, second, 10, 10)
        .translateUrl()).isEqualTo(URI.create("http://10.0.0.5:8000/translate"));
    assertThat(new GenerationSettings(URI.create("https://host/api/generate"), second, second, 10, 10, "SERVE", null)
        .translateUrl()).isEqualTo(URI.create("https://host/api/translate"));
    assertThat(new GenerationSettings(URI.create("http://h:1/generate"), second, second, 10, 10, "serve",
        URI.create("http://other:2/tr")).translateUrl()).isEqualTo(URI.create("http://other:2/tr"));
    // Spring mode keeps working with a generate URL that does not end in /generate.
    assertThat(new GenerationSettings(URI.create("http://h:1/motion"), second, second, 10, 10).translateUrl()).isNull();
  }

  @Test void invalidTranslatorConfigurationFailsAtStartup() {
    Duration second = Duration.ofSeconds(1);
    URI generate = URI.create("http://h:1/generate");
    assertThatThrownBy(() -> new GenerationSettings(generate, second, second, 10, 10, "openai", null))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new GenerationSettings(URI.create("http://h:1/motion"), second, second, 10, 10, "serve", null))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new GenerationSettings(generate, second, second, 10, 10, "serve", URI.create("ftp://h/translate")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new GenerationSettings(generate, second, second, 10, 10, "serve", URI.create("http://u@h/translate")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
