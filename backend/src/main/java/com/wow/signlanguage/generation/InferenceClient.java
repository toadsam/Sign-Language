package com.wow.signlanguage.generation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

@Component
public class InferenceClient {
  private static final List<String> FIELDS = List.of(
      "fps", "joints", "frames", "units", "data", "tokens", "segments", "unknown", "source");
  private final GenerationSettings settings;
  private final ObjectMapper mapper;
  private final HttpClient http;

  public InferenceClient(GenerationSettings settings, ObjectMapper mapper) {
    this.settings = settings;
    this.mapper = mapper;
    this.http = HttpClient.newBuilder().connectTimeout(settings.connectTimeout())
        .followRedirects(HttpClient.Redirect.NEVER).build();
  }

  public ObjectNode generate(List<String> gloss, boolean question) throws InferenceUnavailable {
    CompletableFuture<HttpResponse<byte[]>> pending = null;
    try {
      byte[] body = mapper.writeValueAsBytes(Map.of("gloss", gloss,
          "nonmanual", question ? List.of("의문") : List.of()));
      HttpRequest request = HttpRequest.newBuilder(settings.url())
          .header("Content-Type", "application/json").header("Accept", "application/json")
          .timeout(settings.responseTimeout()).POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
      // Bound both response allocation and the full response deadline, including body reads.
      int maxBytes = Math.toIntExact((long) settings.maxFrames() * 2000 + 65_536);
      pending = http.sendAsync(request, info -> new LimitedBody(maxBytes));
      HttpResponse<byte[]> response = pending.get(settings.responseTimeout().toMillis(), TimeUnit.MILLISECONDS);
      if (response.statusCode() != 200) {
        throw new IOException("Inference HTTP error");
      }
      JsonNode node = mapper.readTree(response.body());
      validate(node, gloss);
      ObjectNode result = mapper.createObjectNode();
      FIELDS.forEach(field -> result.set(field, node.get(field)));
      return result;
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new InferenceUnavailable();
    } catch (Exception error) {
      throw new InferenceUnavailable();
    } finally {
      if (pending != null && !pending.isDone()) {
        pending.cancel(true);
      }
    }
  }

  private void validate(JsonNode node, List<String> gloss) throws IOException {
    require(node != null && node.isObject() && FIELDS.stream().allMatch(node::hasNonNull));
    require(integer(node.get("fps"), 30, 30) && integer(node.get("joints"), 125, 125)
        && integer(node.get("frames"), 0, settings.maxFrames())
        && node.get("units").isTextual() && node.get("units").textValue().equals("shoulder")
        && node.get("data").isTextual() && node.get("source").isTextual()
        && List.of("model", "baseline").contains(node.get("source").textValue())
        && node.get("tokens").isArray() && node.get("unknown").isArray()
        && node.get("segments").isArray() && node.get("segments").isEmpty());
    for (JsonNode token : node.get("tokens")) {
      require(integer(token, 0, Integer.MAX_VALUE));
    }
    if (node.get("source").textValue().equals("baseline")) {
      require(node.get("tokens").isEmpty());
    }
    for (JsonNode word : node.get("unknown")) {
      require(word.isTextual() && gloss.contains(word.textValue()));
    }
    boolean allUnknown = gloss.stream().allMatch(word -> {
      for (JsonNode unknown : node.get("unknown")) {
        if (word.equals(unknown.textValue())) return true;
      }
      return false;
    });
    int frames = node.get("frames").intValue();
    require((frames == 0) == allUnknown && (!allUnknown || node.get("tokens").isEmpty()));
    String data = node.get("data").textValue();
    long byteCount = (long) frames * 125 * 3 * Float.BYTES;
    require(data.length() == (byteCount + 2) / 3 * 4);
    byte[] raw = Base64.getDecoder().decode(data);
    require(raw.length == byteCount && Base64.getEncoder().encodeToString(raw).equals(data));
    ByteBuffer coordinates = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
    while (coordinates.hasRemaining()) {
      require(Float.isFinite(coordinates.getFloat()));
    }
  }

  private static boolean integer(JsonNode node, int min, int max) {
    return node.isIntegralNumber() && node.canConvertToInt() && node.intValue() >= min && node.intValue() <= max;
  }

  private static void require(boolean valid) throws IOException {
    if (!valid) throw new IOException("Invalid inference response");
  }

  public static class InferenceUnavailable extends Exception {
    public InferenceUnavailable() { super("Inference unavailable"); }
  }

  private static class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
    private final int limit;
    private long received;
    private Flow.Subscription subscription;

    LimitedBody(int limit) { this.limit = limit; }
    public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
    public void onSubscribe(Flow.Subscription subscription) {
      this.subscription = subscription;
      delegate.onSubscribe(subscription);
    }
    public void onNext(List<ByteBuffer> items) {
      received += items.stream().mapToLong(ByteBuffer::remaining).sum();
      if (received > limit) {
        subscription.cancel();
        delegate.onError(new IOException("Inference response too large"));
      } else {
        delegate.onNext(items);
      }
    }
    public void onError(Throwable error) { delegate.onError(error); }
    public void onComplete() { delegate.onComplete(); }
  }
}
