package com.wow.signlanguage.recognition;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import com.wow.signlanguage.config.SecurityConfig;
import com.wow.signlanguage.config.WebConfig;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** 읽기 API 검사. 추론 서버는 localhost HTTP 스텁이고 좌표는 0 으로 채운 가짜다 (모델 · 데이터 없음). */
@WebMvcTest(controllers = RecognitionController.class,
    excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = WebConfig.class))
@Import({RecognitionClient.class, RecognitionSettings.class, SecurityConfig.class})
class RecognitionApiTests {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final AtomicReference<Stub> STUB = new AtomicReference<>();
  private static final AtomicReference<JsonNode> RECEIVED = new AtomicReference<>();
  private static final AtomicInteger REQUESTS = new AtomicInteger();
  private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();
  private static final HttpServer SERVER = startServer();
  @Autowired MockMvc mvc;
  @MockBean ClientRegistrationRepository registrations;

  record Stub(int status, String body, long delayMillis) {}

  static HttpServer startServer() {
    try {
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(EXECUTOR);
      server.createContext("/recognize", exchange -> {
        Stub stub = STUB.get();
        REQUESTS.incrementAndGet();
        RECEIVED.set(JSON.readTree(exchange.getRequestBody()));
        try {
          Thread.sleep(stub.delayMillis());
          byte[] body = stub.body().getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().set("Content-Type", "application/json");
          if (stub.status() == 503) exchange.getResponseHeaders().set("Retry-After", "999999999999");
          exchange.sendResponseHeaders(stub.status(), body.length);
          exchange.getResponseBody().write(body);
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        } catch (IOException ignored) {
          // 시간 초과 검사에서는 스텁이 끝나기 전에 클라이언트가 먼저 끊는다
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
    // 주소를 따로 주지 않는다: generation.url 의 /generate 에서 /recognize 가 만들어지는지도 같이 본다
    properties.add("sign.generation.url", () -> "http://127.0.0.1:" + SERVER.getAddress().getPort() + "/generate");
    properties.add("sign.generation.response-timeout", () -> "PT0.8S");
    properties.add("sign.generation.max-frames", () -> "40");
    properties.add("app.oauth2-success-url", () -> "http://localhost/home");
  }

  @AfterAll static void stopServer() {
    SERVER.stop(0);
    EXECUTOR.shutdownNow();
  }

  @BeforeEach void prepare() {
    STUB.set(new Stub(200, reading(), 0));
    RECEIVED.set(null);
    REQUESTS.set(0);
  }

  static String reading() {
    return """
        {"classes": 3000, "secret": "C:/data/work/model.pt",
         "results": [{"start": 0, "end": 8, "top": [{"item": "WORD0773", "name": "병원", "prob": 0.82, "extra": 1},
                                                      {"item": "WORD0002", "name": null, "prob": 0.1}]},
                     {"start": 12, "end": 20, "top": [{"item": "WORD0002", "name": "학교", "prob": 0.6}]}]}
        """;
  }

  static ObjectNode motion(int frames, int joints) {
    ObjectNode node = JSON.createObjectNode();
    node.put("joints", joints);
    node.put("frames", frames);
    node.put("data", Base64.getEncoder().encodeToString(new byte[frames * joints * 12]));
    return node;
  }

  static ObjectNode motion() {
    ObjectNode node = motion(20, 55);
    node.putArray("spans").addArray().add(0).add(8);
    ((com.fasterxml.jackson.databind.node.ArrayNode) node.get("spans")).addArray().add(12).add(20);
    return node;
  }

  private org.springframework.test.web.servlet.ResultActions send(JsonNode body) throws Exception {
    return mvc.perform(post("/api/sign/recognize").contentType(MediaType.APPLICATION_JSON).content(body.toString()));
  }

  @Test void forwardsMotionWithoutLoginAndReturnsOnlyPromisedFields() throws Exception {
    send(motion())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.classes").value(3000))
        .andExpect(jsonPath("$.secret").doesNotExist())
        .andExpect(jsonPath("$.results.length()").value(2))
        .andExpect(jsonPath("$.results[0].start").value(0))
        .andExpect(jsonPath("$.results[0].end").value(8))
        .andExpect(jsonPath("$.results[0].top[0].item").value("WORD0773"))
        .andExpect(jsonPath("$.results[0].top[0].name").value("병원"))
        .andExpect(jsonPath("$.results[0].top[0].prob").value(0.82))
        .andExpect(jsonPath("$.results[0].top[0].extra").doesNotExist())
        .andExpect(jsonPath("$.results[0].top[1].name").isEmpty())
        .andExpect(jsonPath("$.results[1].top[0].name").value("학교"));
    JsonNode sent = RECEIVED.get();
    assertThat(sent.get("joints").intValue()).isEqualTo(55);
    assertThat(sent.get("frames").intValue()).isEqualTo(20);
    assertThat(sent.get("data").textValue()).isEqualTo(motion().get("data").textValue());
    assertThat(sent.get("spans").toString()).isEqualTo("[[0,8],[12,20]]");
    assertThat(REQUESTS.get()).isEqualTo(1);
  }

  @Test void wholeMotionNeedsNoSpansAndFullBodyIsAccepted() throws Exception {
    STUB.set(new Stub(200, "{\"classes\":20,\"results\":[{\"start\":0,\"end\":4,\"top\":[{\"item\":\"WORD1501\",\"name\":null,\"prob\":1}]}]}", 0));
    send(motion(4, 125)).andExpect(status().isOk()).andExpect(jsonPath("$.results[0].top[0].item").value("WORD1501"));
    assertThat(RECEIVED.get().has("spans")).isFalse();
  }

  static Stream<JsonNode> invalidRequests() {
    ObjectNode wrongJoints = motion(20, 60);
    ObjectNode shortData = motion(20, 55);
    shortData.put("data", shortData.get("data").textValue().substring(4));
    ObjectNode tooShort = motion(3, 55);
    ObjectNode tooLong = motion(41, 55);
    ObjectNode extra = motion(20, 55);
    extra.put("text", "문장");
    ObjectNode badSpan = motion(20, 55);
    badSpan.putArray("spans").addArray().add(0).add(3);
    ObjectNode outside = motion(20, 55);
    outside.putArray("spans").addArray().add(10).add(21);
    ObjectNode triple = motion(20, 55);
    triple.putArray("spans").addArray().add(0).add(8).add(9);
    ObjectNode noData = JSON.createObjectNode().put("joints", 55).put("frames", 20);
    ObjectNode textFrames = motion(20, 55);
    textFrames.put("frames", "20");
    return Stream.of(wrongJoints, shortData, tooShort, tooLong, extra, badSpan, outside, triple, noData, textFrames,
        JSON.createArrayNode(), JSON.getNodeFactory().textNode("x"));
  }

  @ParameterizedTest @MethodSource("invalidRequests")
  void invalidRequestsAreRejectedBeforeTheModel(JsonNode body) throws Exception {
    send(body)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
        .andExpect(jsonPath("$.error.retryable").value(false));
    assertThat(REQUESTS.get()).isZero();
  }

  @Test void unreadableBodyIsInvalid() throws Exception {
    mvc.perform(post("/api/sign/recognize").contentType(MediaType.APPLICATION_JSON).content("{not json"))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    assertThat(REQUESTS.get()).isZero();
  }

  @Test void busyOrMissingModelIsUnavailableWithAFixedRetryAfter() throws Exception {
    STUB.set(new Stub(503, "{\"detail\":\"Recognizer unavailable at C:/secret\"}", 0));
    String body = send(motion())
        .andExpect(status().isServiceUnavailable())
        .andExpect(header().string("Retry-After", "1"))
        .andExpect(jsonPath("$.error.code").value("RECOGNITION_UNAVAILABLE"))
        .andExpect(jsonPath("$.error.retryable").value(true))
        .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertThat(body).doesNotContain("secret");
    assertThat(REQUESTS.get()).isEqualTo(1);  // 서버가 몰래 다시 시도하지 않는다
  }

  @Test void upstreamRejectionOfTheCoordinatesIsAnInvalidRequest() throws Exception {
    STUB.set(new Stub(422, "{\"detail\":\"this recognizer needs face joints\"}", 0));
    send(motion()).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
  }

  static Stream<String> malformedResponses() {
    return Stream.of(
        "not json",
        "{\"classes\":3000}",
        "{\"classes\":3000,\"results\":[]}",
        "{\"classes\":0,\"results\":[{\"start\":0,\"end\":8,\"top\":[{\"item\":\"W\",\"name\":null,\"prob\":0.5}]}]}",
        "{\"classes\":3000,\"results\":[{\"start\":8,\"end\":8,\"top\":[{\"item\":\"W\",\"name\":null,\"prob\":0.5}]}]}",
        "{\"classes\":3000,\"results\":[{\"start\":0,\"end\":99,\"top\":[{\"item\":\"W\",\"name\":null,\"prob\":0.5}]}]}",
        "{\"classes\":3000,\"results\":[{\"start\":0,\"end\":8,\"top\":[]}]}",
        "{\"classes\":3000,\"results\":[{\"start\":0,\"end\":8,\"top\":[{\"item\":\"\",\"name\":null,\"prob\":0.5}]}]}",
        "{\"classes\":3000,\"results\":[{\"start\":0,\"end\":8,\"top\":[{\"item\":\"W\",\"name\":7,\"prob\":0.5}]}]}",
        "{\"classes\":3000,\"results\":[{\"start\":0,\"end\":8,\"top\":[{\"item\":\"W\",\"name\":null,\"prob\":1.5}]}]}",
        "{\"classes\":3000,\"results\":[{\"start\":0,\"end\":8,\"top\":[{\"item\":\"W\",\"name\":null,\"prob\":\"0.5\"}]}]}");
  }

  @ParameterizedTest @MethodSource("malformedResponses")
  void malformedModelAnswersAreFailuresNotResults(String upstream) throws Exception {
    STUB.set(new Stub(200, upstream, 0));
    send(motion()).andExpect(status().isBadGateway()).andExpect(jsonPath("$.error.code").value("RECOGNITION_FAILED"))
        .andExpect(jsonPath("$.results").doesNotExist());
  }

  @Test void unexpectedStatusIsAFailureAndSlowModelIsATimeout() throws Exception {
    STUB.set(new Stub(500, "{\"detail\":\"Recognition failed\"}", 0));
    send(motion()).andExpect(status().isBadGateway()).andExpect(jsonPath("$.error.code").value("RECOGNITION_FAILED"));
    STUB.set(new Stub(200, reading(), 1500));
    send(motion()).andExpect(status().isGatewayTimeout()).andExpect(jsonPath("$.error.code").value("RECOGNITION_TIMEOUT"))
        .andExpect(jsonPath("$.error.retryable").value(true));
  }

  @Test void recoversOnTheNextRequestAfterAFailure() throws Exception {
    STUB.set(new Stub(503, "{}", 0));
    send(motion()).andExpect(status().isServiceUnavailable());
    STUB.set(new Stub(200, reading(), 0));
    send(motion()).andExpect(status().isOk());
  }

  @Test void urlIsDerivedFromTheGenerationUrlAndAMissingUrlOnlyDisablesReading() {
    assertThat(RecognitionSettings.resolve("", URI.create("http://127.0.0.1:8000/generate")))
        .isEqualTo(URI.create("http://127.0.0.1:8000/recognize"));
    assertThat(RecognitionSettings.resolve(null, URI.create("http://host:9/x/generate")))
        .isEqualTo(URI.create("http://host:9/x/recognize"));
    assertThat(RecognitionSettings.resolve(" http://other:1/recognize ", URI.create("http://127.0.0.1:8000/generate")))
        .isEqualTo(URI.create("http://other:1/recognize"));
    assertThat(RecognitionSettings.resolve("", URI.create("http://127.0.0.1:8000/custom"))).isNull();

    // 주소를 정할 수 없어도 설정은 만들어지고(서버가 켜진다), 읽기만 503 이다
    RecognitionSettings none = new RecognitionSettings(null, Duration.ofSeconds(1), Duration.ofSeconds(1), 40);
    RecognitionClient client = new RecognitionClient(none, JSON);
    try {
      client.recognize(motion());
      throw new AssertionError("expected RecognitionFailure");
    } catch (RecognitionFailure failure) {
      assertThat(failure.reason).isEqualTo(RecognitionFailure.Reason.RECOGNITION_UNAVAILABLE);
    }
  }
}
