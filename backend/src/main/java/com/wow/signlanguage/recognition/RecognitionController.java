package com.wow.signlanguage.recognition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.wow.signlanguage.recognition.RecognitionFailure.Reason;
import java.util.Iterator;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 읽기 API: 동작 좌표를 읽는 모델에 넣어 어떤 단어로 읽히는지 돌려준다.
 *
 * <pre>
 * POST /api/sign/recognize
 *   {"joints": 125 | 55, "frames": T, "data": "base64(float32 little-endian [T x joints x 3])",
 *    "spans": [[start, end], ...]}          // 생략하면 전체를 한 번 읽는다. end 는 끝 프레임 다음
 * -> {"classes": 3000, "results": [{"start", "end", "top": [{"item", "name", "prob"}]}]}
 * </pre>
 *
 * 좌표는 생성 응답(계약 ⑤)과 같은 단위다. 실패는 생성 API 와 같은 모양의 error 봉투로 돌려준다.
 */
@RestController
public class RecognitionController {
  private static final Set<String> FIELDS = Set.of("joints", "frames", "data", "spans");
  private static final int MIN_FRAMES = 4;
  private final RecognitionClient client;
  private final RecognitionSettings settings;

  public RecognitionController(RecognitionClient client, RecognitionSettings settings) {
    this.client = client;
    this.settings = settings;
  }

  public record ErrorDetail(String code, String message, boolean retryable) {}
  public record ErrorEnvelope(ErrorDetail error) {}

  @PostMapping("/api/sign/recognize")
  public Object recognize(@RequestBody JsonNode request) {
    return client.recognize(validated(request));
  }

  /** Checks everything that can be checked without the model, and copies only the known fields. */
  private ObjectNode validated(JsonNode request) {
    if (request == null || !request.isObject()) throw new RecognitionFailure(Reason.INVALID_REQUEST);
    for (Iterator<String> names = request.fieldNames(); names.hasNext(); ) {
      if (!FIELDS.contains(names.next())) throw new RecognitionFailure(Reason.INVALID_REQUEST);
    }
    JsonNode joints = request.get("joints");
    JsonNode frames = request.get("frames");
    JsonNode data = request.get("data");
    if (!(RecognitionClient.integer(joints, 55, 125) && (joints.intValue() == 55 || joints.intValue() == 125))
        || !RecognitionClient.integer(frames, MIN_FRAMES, settings.maxFrames())
        || data == null || !data.isTextual()) {
      throw new RecognitionFailure(Reason.INVALID_REQUEST);
    }
    long bytes = (long) frames.intValue() * joints.intValue() * 3 * Float.BYTES;
    if (data.textValue().length() != (bytes + 2) / 3 * 4) throw new RecognitionFailure(Reason.INVALID_REQUEST);

    ObjectNode out = JsonNodeFactory.instance.objectNode();
    out.put("joints", joints.intValue());
    out.put("frames", frames.intValue());
    out.put("data", data.textValue());
    JsonNode spans = request.get("spans");
    if (spans != null) {
      if (!spans.isArray() || spans.size() > RecognitionClient.MAX_SPANS) throw new RecognitionFailure(Reason.INVALID_REQUEST);
      ArrayNode copy = out.putArray("spans");
      for (JsonNode span : spans) {
        if (!span.isArray() || span.size() != 2
            || !RecognitionClient.integer(span.get(0), 0, frames.intValue())
            || !RecognitionClient.integer(span.get(1), 0, frames.intValue())
            || span.get(1).intValue() - span.get(0).intValue() < MIN_FRAMES) {
          throw new RecognitionFailure(Reason.INVALID_REQUEST);
        }
        copy.addArray().add(span.get(0).intValue()).add(span.get(1).intValue());
      }
    }
    return out;
  }

  @ExceptionHandler(RecognitionFailure.class)
  public ResponseEntity<ErrorEnvelope> failure(RecognitionFailure failure) {
    var response = ResponseEntity.status(failure.reason.status);
    if (failure.retryAfter) response.header("Retry-After", "1");
    return response.body(new ErrorEnvelope(new ErrorDetail(
        failure.reason.name(), failure.reason.message, failure.reason.retryable)));
  }

  @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
  public ResponseEntity<ErrorEnvelope> unreadable(Exception ignored) {
    return failure(new RecognitionFailure(Reason.INVALID_REQUEST));
  }
}
