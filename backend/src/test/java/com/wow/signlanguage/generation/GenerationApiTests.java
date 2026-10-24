package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import com.wow.signlanguage.api.TranslateController;
import com.wow.signlanguage.config.SecurityConfig;
import com.wow.signlanguage.config.WebConfig;
import com.wow.signlanguage.service.TranslationService;
import com.wow.signlanguage.translate.*;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = {GenerationController.class, TranslateController.class},
    excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = WebConfig.class))
@Import({GenerationService.class, InferenceClient.class, GenerationSettings.class, SecurityConfig.class})
class GenerationApiTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final AtomicReference<Stub> STUB = new AtomicReference<>();
  private static final AtomicReference<JsonNode> RECEIVED = new AtomicReference<>();
  private static final AtomicInteger REQUESTS = new AtomicInteger();
  private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();
  private static final HttpServer SERVER = startServer();
  @Autowired MockMvc mvc;
  @Autowired InferenceClient inference;
  @MockBean TranslationService translation;
  @MockBean ClientRegistrationRepository registrations;

  record Stub(int status, String body, long delayMillis, boolean delayBody) {}

  static HttpServer startServer() {
    try {
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(EXECUTOR);
      server.createContext("/generate", exchange -> {
        Stub stub = STUB.get();
        REQUESTS.incrementAndGet();
        RECEIVED.set(JSON.readTree(exchange.getRequestBody()));
        try {
          if (!stub.delayBody()) Thread.sleep(stub.delayMillis());
          byte[] body = stub.body().getBytes(java.nio.charset.StandardCharsets.UTF_8);
          exchange.getResponseHeaders().set("Content-Type", "application/json");
          exchange.sendResponseHeaders(stub.status(), body.length);
          if (stub.delayBody()) Thread.sleep(stub.delayMillis());
          exchange.getResponseBody().write(body);
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        } catch (IOException ignored) {
          // A deadline intentionally closes the client before this stub finishes.
        } finally {
          exchange.close();
        }
      });
      server.start();
      return server;
    } catch (IOException error) {
      throw new ExceptionInInitializerError(error);
    }
  }

  @DynamicPropertySource
  static void settings(DynamicPropertyRegistry properties) {
    properties.add("sign.generation.url", () -> "http://127.0.0.1:" + SERVER.getAddress().getPort() + "/generate");
    properties.add("sign.generation.response-timeout", () -> "PT0.8S");
    properties.add("sign.generation.max-frames", () -> "2");
    properties.add("sign.generation.max-text-chars", () -> "32");
    properties.add("app.oauth2-success-url", () -> "http://localhost/home");
  }

  @AfterAll static void stopServer() {
    SERVER.stop(0);
    EXECUTOR.shutdownNow();
  }

  @BeforeEach void prepare() {
    STUB.set(new Stub(200, motion().toString(), 0, false));
    RECEIVED.set(null);
    REQUESTS.set(0);
    when(translation.translate(anyString())).thenReturn(translated());
  }

  static TranslateResponse translated() {
    return new TranslateResponse("화장실 있어요?", "화장실 있다", List.of("화장실", "있다"),
        List.of("question"), new SimplificationMetadata(true, false, "present"), List.of(),
        List.of(new TranslatePlaybackItem("화장실", 1, "test.mp4", "https://example.invalid/test.mp4", true),
            new TranslatePlaybackItem("있다", 0, "", "", false)), List.of("있다"), List.of());
  }

  static ObjectNode motion() {
    ByteBuffer bytes = ByteBuffer.allocate(1500).order(ByteOrder.LITTLE_ENDIAN);
    for (int index = 0; index < 375; index++) bytes.putFloat((index - 100) / 100f);
    ObjectNode node = JSON.createObjectNode();
    node.put("fps", 30).put("joints", 125).put("frames", 1).put("units", "shoulder")
        .put("data", Base64.getEncoder().encodeToString(bytes.array())).put("source", "baseline");
    node.putArray("tokens");
    node.putArray("segments");
    node.putArray("unknown");
    return node;
  }

  void assertFallback() throws Exception {
    mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
        .content("{\"text\":\"화장실 있어요?\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.source").value("video"))
        .andExpect(jsonPath("$.items[0].url").value("https://example.invalid/test.mp4"))
        .andExpect(jsonPath("$.items[1].hasVideo").value(false))
        .andExpect(jsonPath("$.unknown[0]").value("있다"))
        .andExpect(jsonPath("$.data").doesNotExist());
    verify(translation, times(1)).translate("화장실 있어요?");
  }

  @Test void publicEndpointForwardsGlossAndQuestionAndPreservesBytes() throws Exception {
    String content = mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON)
        .content("{\"text\":\"화장실 있어요?\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.source").value("baseline"))
        .andExpect(jsonPath("$.joints").value(125)).andReturn().getResponse().getContentAsString();
    assertThat(JSON.readTree(content)).isEqualTo(motion());
    assertThat(RECEIVED.get().get("gloss")).isEqualTo(JSON.valueToTree(List.of("화장실", "있다")));
    assertThat(RECEIVED.get().get("nonmanual")).isEqualTo(JSON.valueToTree(List.of("의문")));
    assertThat(REQUESTS.get()).isEqualTo(1);
    verify(translation, times(1)).translate("화장실 있어요?");
  }

  @Test void nonQuestionAndPartialUnknownPassThrough() throws Exception {
    TranslateResponse old = translated();
    when(translation.translate(anyString())).thenReturn(new TranslateResponse(old.input(), old.simplifiedSentence(),
        old.normalizedTokens(), old.appliedRules(), new SimplificationMetadata(false, true, "past"),
        old.clips(), old.items(), old.unknown(), old.noVideoWords()));
    ObjectNode node = motion();
    node.withArray("unknown").add("있다");
    STUB.set(new Stub(200, node.toString(), 0, false));
    mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"문장\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.unknown[0]").value("있다"));
    assertThat(RECEIVED.get().get("nonmanual").isEmpty()).isTrue();
  }

  @Test void allUnknownIsZeroFramesWithoutVideoFallback() throws Exception {
    ObjectNode node = motion().put("frames", 0).put("data", "");
    node.withArray("unknown").add("화장실").add("있다");
    STUB.set(new Stub(200, node.toString(), 0, false));
    mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"문장\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.frames").value(0))
        .andExpect(jsonPath("$.data").value("")).andExpect(jsonPath("$.source").value("baseline"));
  }

  @ParameterizedTest @ValueSource(ints = {302, 422, 500, 503})
  void httpFailuresFallbackWithoutRetry(int status) throws Exception {
    STUB.set(new Stub(status, "{}", 0, false));
    assertFallback();
    assertThat(REQUESTS.get()).isEqualTo(1);
  }

  @ParameterizedTest @ValueSource(booleans = {false, true})
  void fullResponseTimeoutIncludesBody(boolean bodyDelay) throws Exception {
    STUB.set(new Stub(200, motion().toString(), 2000, bodyDelay));
    long started = System.nanoTime();
    assertFallback();
    assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(3));
  }

  @ParameterizedTest @ValueSource(strings = {"base64", "shape", "nan", "inf", "missing", "dtype",
      "source", "segments", "unknown", "empty", "overlong", "fractional", "json", "huge"})
  void malformedResponsesFallback(String kind) throws Exception {
    ObjectNode node = motion();
    switch (kind) {
      case "base64" -> node.put("data", "!".repeat(2000));
      case "shape" -> node.put("joints", 124);
      case "nan", "inf" -> {
        byte[] bytes = Base64.getDecoder().decode(node.get("data").textValue());
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).putFloat(kind.equals("nan") ? Float.NaN : Float.POSITIVE_INFINITY);
        node.put("data", Base64.getEncoder().encodeToString(bytes));
      }
      case "missing" -> node.remove("tokens");
      case "dtype" -> node.put("data", Base64.getEncoder().encodeToString(new byte[3000]));
      case "source" -> node.put("source", "video");
      case "segments" -> node.withArray("segments").addObject().put("start", 0);
      case "unknown" -> node.withArray("unknown").add("invented");
      case "empty" -> node.put("frames", 0).put("data", "");
      case "overlong" -> node.put("frames", 3);
      case "fractional" -> node.put("frames", 1.5);
      default -> { }
    }
    String body = switch (kind) { case "json" -> "{"; case "huge" -> " ".repeat(100_000); default -> node.toString(); };
    STUB.set(new Stub(200, body, 0, false));
    assertFallback();
  }

  @Test void connectionRefusedFallsBack() throws Exception {
    HttpServer temporary = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    int port = temporary.getAddress().getPort();
    temporary.stop(0);
    GenerationSettings settings = new GenerationSettings(java.net.URI.create("http://127.0.0.1:" + port + "/generate"),
        Duration.ofMillis(100), Duration.ofMillis(300), 32, 2);
    GenerationService service = new GenerationService(translation, new InferenceClient(settings, JSON), settings);
    Object result = service.generate("화장실 있어요?");
    assertThat(result).isEqualTo(new GenerationService.VideoResponse("video", translated().items(), translated().unknown()));
    verify(translation, times(1)).translate(anyString());
  }

  @ParameterizedTest @ValueSource(strings = {"{}", "null", "{\"text\":null}", "{\"text\":12}",
      "{\"text\":[]}", "{\"text\":\" \"}", "{\"text\":\"\"}", "{\"text\":\"x\",\"url\":\"http://example.invalid\"}",
      "{\"text\":\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"}", "{"})
  void invalidTextNeverCallsTranslationOrInference(String body) throws Exception {
    mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isBadRequest());
    verifyNoInteractions(translation);
    assertThat(REQUESTS.get()).isZero();
  }

  @Test void translationFailureIsAnErrorWithoutFabricatedVideo() throws Exception {
    when(translation.translate(anyString())).thenThrow(new IllegalStateException("SECRET"));
    mvc.perform(post("/api/sign/generate").contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"문장\"}"))
        .andExpect(status().isBadGateway()).andExpect(jsonPath("$.items").doesNotExist());
    assertThat(REQUESTS.get()).isZero();
  }

  @Test void legacyTranslateRemainsPublicAndUsesOriginalDto() throws Exception {
    mvc.perform(post("/translate").contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"문장\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.normalizedTokens[0]").value("화장실"))
        .andExpect(jsonPath("$.metadata.question").value(true)).andExpect(jsonPath("$.noVideoWords").isArray())
        .andExpect(jsonPath("$.source").doesNotExist());
    assertThat(REQUESTS.get()).isZero();
  }

  @Test void unrelatedRouteStillRequiresAuthentication() throws Exception {
    mvc.perform(get("/api/sign/private")).andExpect(status().is3xxRedirection());
    verifyNoInteractions(translation);
  }
}
