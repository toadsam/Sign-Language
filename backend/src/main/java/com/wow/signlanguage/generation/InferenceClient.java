package com.wow.signlanguage.generation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.net.ConnectException;
import java.net.UnknownHostException;
import java.nio.channels.UnresolvedAddressException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.net.ssl.SSLException;
import org.springframework.stereotype.Component;

@Component
public class InferenceClient {
  private static final List<String> FIELDS = List.of(
      "fps", "joints", "frames", "units", "data", "tokens", "segments", "unknown", "source");
  private static final int TRANSLATION_MAX_BYTES = 1_048_576;
  private final GenerationSettings settings;
  private final ObjectMapper mapper;
  private final HttpClient http;

  public InferenceClient(GenerationSettings settings, ObjectMapper mapper) {
    this.settings = settings;
    this.mapper = mapper;
    this.http = HttpClient.newBuilder().connectTimeout(settings.connectTimeout())
        .followRedirects(HttpClient.Redirect.NEVER).build();
  }

  /** Words from the inference server's own translator; other response fields are ignored. */
  public record Translation(List<String> gloss, List<String> unknown) {}

  private interface Reader<T> {
    T read(JsonNode node) throws IOException;
  }

  public ObjectNode generate(List<String> gloss, boolean question) {
    int maxBytes = Math.toIntExact((long) settings.maxFrames() * 2000 + 65_536);
    return post(settings.url(), Map.of("gloss", gloss, "nonmanual", question ? List.of("의문") : List.of()),
        maxBytes, GenerationFailure.Reason.GENERATION_FAILED, node -> {
          validate(node, gloss);
          ObjectNode result = mapper.createObjectNode();
          FIELDS.forEach(field -> result.set(field, node.get(field)));
          return result;
        });
  }

  /** {@code POST /translate} on the inference server (serve translator mode). */
  public Translation translate(String text) {
    return post(settings.translateUrl(), Map.of("text", text), TRANSLATION_MAX_BYTES,
        GenerationFailure.Reason.TRANSLATION_UNAVAILABLE, InferenceClient::readTranslation);
  }

  private static Translation readTranslation(JsonNode node) throws IOException {
    require(node != null && node.isObject() && node.hasNonNull("gloss") && node.get("gloss").isArray()
        && node.hasNonNull("unknown") && node.get("unknown").isArray());
    List<String> gloss = new ArrayList<>();
    for (JsonNode word : node.get("gloss")) {
      require(word.isTextual() && !word.textValue().isBlank());
      gloss.add(word.textValue());
    }
    List<String> unknown = new ArrayList<>();
    for (JsonNode word : node.get("unknown")) {
      require(word.isTextual());
      unknown.add(word.textValue());
    }
    return new Translation(List.copyOf(gloss), List.copyOf(unknown));
  }

  /** One POST with bounded body size and deadline, no redirects; never keeps upstream bodies in errors. */
  private <T> T post(URI url, Object payload, int maxBytes, GenerationFailure.Reason malformed, Reader<T> reader) {
    CompletableFuture<HttpResponse<byte[]>> pending = null;
    try {
      byte[] body = mapper.writeValueAsBytes(payload);
      HttpRequest request = HttpRequest.newBuilder(url)
          .header("Content-Type", "application/json").header("Accept", "application/json")
          .timeout(settings.responseTimeout()).POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
      // Bound both response allocation and the full response deadline, including body reads.
      pending = http.sendAsync(request, info -> new LimitedBody(maxBytes));
      HttpResponse<byte[]> response = pending.get(settings.responseTimeout().toMillis(), TimeUnit.MILLISECONDS);
      checkStatus(response.statusCode());
      return reader.read(mapper.readTree(response.body()));
    } catch (GenerationFailure error) {
      throw error;
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new GenerationFailure(GenerationFailure.Reason.GENERATION_UNAVAILABLE);
    } catch (Exception error) {
      for (Throwable cause = error; cause != null; cause = cause.getCause()) {
        if (cause instanceof TimeoutException || cause instanceof HttpTimeoutException) {
          throw new GenerationFailure(GenerationFailure.Reason.GENERATION_TIMEOUT);
        }
        if (cause instanceof ConnectException || cause instanceof UnknownHostException
            || cause instanceof UnresolvedAddressException || cause instanceof SSLException) {
          throw new GenerationFailure(GenerationFailure.Reason.GENERATION_UNAVAILABLE);
        }
      }
      throw new GenerationFailure(malformed);
    } finally {
      if (pending != null && !pending.isDone()) {
        pending.cancel(true);
      }
    }
  }

  private static void checkStatus(int status) {
    switch (status) {
      case 200 -> { }
      case 429, 503 -> throw new GenerationFailure(GenerationFailure.Reason.GENERATION_UNAVAILABLE, true);
      case 408, 504 -> throw new GenerationFailure(GenerationFailure.Reason.GENERATION_TIMEOUT);
      case 400, 413, 422 -> throw new GenerationFailure(GenerationFailure.Reason.NO_GENERATABLE_INPUT);
      default -> throw new GenerationFailure(GenerationFailure.Reason.GENERATION_FAILED);
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
        && node.get("segments").isArray());
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
    validateSegments(node.get("segments"), gloss, frames);
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

  /** Sentence mode: [{"gloss", "start", "end"}] in time order, end exclusive, no overlap (ml/serve check_segments). */
  private static void validateSegments(JsonNode segments, List<String> gloss, int frames) throws IOException {
    require(segments.size() <= gloss.size() && (frames > 0 || segments.isEmpty()));
    int last = 0;
    for (JsonNode segment : segments) {
      require(segment.isObject() && segment.size() == 3 && segment.hasNonNull("gloss")
          && segment.hasNonNull("start") && segment.hasNonNull("end"));
      JsonNode word = segment.get("gloss");
      require(word.isTextual() && !word.textValue().isBlank() && gloss.contains(word.textValue()));
      require(integer(segment.get("start"), last, frames - 1) && integer(segment.get("end"), 1, frames));
      int start = segment.get("start").intValue();
      int end = segment.get("end").intValue();
      require(start < end);
      last = end;
    }
  }

  private static boolean integer(JsonNode node, int min, int max) {
    return node.isIntegralNumber() && node.canConvertToInt() && node.intValue() >= min && node.intValue() <= max;
  }

  private static void require(boolean valid) throws IOException {
    if (!valid) throw new IOException("Invalid inference response");
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
