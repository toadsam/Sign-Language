package com.wow.signlanguage.recognition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.wow.signlanguage.recognition.RecognitionFailure.Reason;
import java.io.IOException;
import java.net.ConnectException;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.channels.UnresolvedAddressException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.net.ssl.SSLException;
import org.springframework.stereotype.Component;

/**
 * Forwards an already validated motion to the inference server's {@code POST /recognize} and returns only
 * the fields this API promises. One request, no retries, no redirects, bounded time and response size.
 */
@Component
public class RecognitionClient {
  static final int MAX_SPANS = 32;
  private static final int MAX_RESPONSE_BYTES = 262_144;
  private final RecognitionSettings settings;
  private final ObjectMapper mapper;
  private final HttpClient http;

  public RecognitionClient(RecognitionSettings settings, ObjectMapper mapper) {
    this.settings = settings;
    this.mapper = mapper;
    this.http = HttpClient.newBuilder().connectTimeout(settings.connectTimeout())
        .followRedirects(HttpClient.Redirect.NEVER).build();
  }

  public ObjectNode recognize(ObjectNode motion) {
    if (settings.url() == null) throw new RecognitionFailure(Reason.RECOGNITION_UNAVAILABLE);
    CompletableFuture<HttpResponse<byte[]>> pending = null;
    try {
      HttpRequest request = HttpRequest.newBuilder(settings.url())
          .header("Content-Type", "application/json").header("Accept", "application/json")
          .timeout(settings.responseTimeout())
          .POST(HttpRequest.BodyPublishers.ofByteArray(mapper.writeValueAsBytes(motion))).build();
      pending = http.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray());
      HttpResponse<byte[]> response = pending.get(settings.responseTimeout().toMillis(), TimeUnit.MILLISECONDS);
      switch (response.statusCode()) {
        case 200 -> { }
        case 429, 503 -> throw new RecognitionFailure(Reason.RECOGNITION_UNAVAILABLE, true);
        case 408, 504 -> throw new RecognitionFailure(Reason.RECOGNITION_TIMEOUT);
        case 400, 413, 422 -> throw new RecognitionFailure(Reason.INVALID_REQUEST);
        default -> throw new RecognitionFailure(Reason.RECOGNITION_FAILED);
      }
      if (response.body().length > MAX_RESPONSE_BYTES) throw new IOException("Recognition response too large");
      return read(mapper.readTree(response.body()), motion.get("frames").intValue());
    } catch (RecognitionFailure error) {
      throw error;
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new RecognitionFailure(Reason.RECOGNITION_UNAVAILABLE);
    } catch (Exception error) {
      for (Throwable cause = error; cause != null; cause = cause.getCause()) {
        if (cause instanceof TimeoutException || cause instanceof HttpTimeoutException) {
          throw new RecognitionFailure(Reason.RECOGNITION_TIMEOUT);
        }
        if (cause instanceof ConnectException || cause instanceof UnknownHostException
            || cause instanceof UnresolvedAddressException || cause instanceof SSLException) {
          throw new RecognitionFailure(Reason.RECOGNITION_UNAVAILABLE);
        }
      }
      throw new RecognitionFailure(Reason.RECOGNITION_FAILED);
    } finally {
      if (pending != null && !pending.isDone()) pending.cancel(true);
    }
  }

  /** {"classes": n, "results": [{"start", "end", "top": [{"item", "name" | null, "prob"}]}]} */
  private ObjectNode read(JsonNode node, int frames) throws IOException {
    require(node != null && node.isObject() && integer(node.get("classes"), 1, 1_000_000));
    JsonNode results = node.get("results");
    require(results != null && results.isArray() && results.size() >= 1 && results.size() <= MAX_SPANS);
    ObjectNode out = mapper.createObjectNode();
    out.put("classes", node.get("classes").intValue());
    ArrayNode spans = out.putArray("results");
    for (JsonNode result : results) {
      require(result.isObject() && integer(result.get("start"), 0, frames) && integer(result.get("end"), 1, frames)
          && result.get("start").intValue() < result.get("end").intValue());
      JsonNode top = result.get("top");
      require(top != null && top.isArray() && top.size() >= 1 && top.size() <= 10);
      ObjectNode span = spans.addObject();
      span.put("start", result.get("start").intValue());
      span.put("end", result.get("end").intValue());
      ArrayNode candidates = span.putArray("top");
      for (JsonNode candidate : top) {
        JsonNode item = candidate.get("item");
        JsonNode name = candidate.get("name");
        JsonNode prob = candidate.get("prob");
        require(candidate.isObject() && item != null && item.isTextual() && !item.textValue().isBlank()
            && item.textValue().length() <= 100 && (name == null || name.isNull() || name.isTextual() && name.textValue().length() <= 100)
            && prob != null && prob.isNumber() && prob.doubleValue() >= 0 && prob.doubleValue() <= 1.000001);
        ObjectNode entry = candidates.addObject();
        entry.put("item", item.textValue());
        if (name != null && name.isTextual()) entry.put("name", name.textValue()); else entry.putNull("name");
        entry.put("prob", Math.min(1.0, prob.doubleValue()));
      }
    }
    return out;
  }

  static boolean integer(JsonNode node, int min, int max) {
    return node != null && node.isIntegralNumber() && node.canConvertToInt() && node.intValue() >= min && node.intValue() <= max;
  }

  private static void require(boolean valid) throws IOException {
    if (!valid) throw new IOException("Invalid recognition response");
  }
}
