package com.wow.signlanguage.recognition;

import org.springframework.http.HttpStatus;

/** Safe public errors for the reading API; never carries upstream messages, coordinates or paths. */
public final class RecognitionFailure extends RuntimeException {
  public enum Reason {
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "동작 좌표가 올바르지 않습니다.", false),
    RECOGNITION_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "읽는 모델을 쓸 수 없습니다. 잠시 후 다시 시도해 주세요.", true),
    RECOGNITION_TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "읽는 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", true),
    RECOGNITION_FAILED(HttpStatus.BAD_GATEWAY, "동작을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.", true);

    final HttpStatus status;
    final String message;
    final boolean retryable;

    Reason(HttpStatus status, String message, boolean retryable) {
      this.status = status;
      this.message = message;
      this.retryable = retryable;
    }
  }

  final Reason reason;
  final boolean retryAfter;

  public RecognitionFailure(Reason reason) { this(reason, false); }

  public RecognitionFailure(Reason reason, boolean retryAfter) {
    super(reason.name());
    this.reason = reason;
    this.retryAfter = retryAfter && reason == Reason.RECOGNITION_UNAVAILABLE;
  }
}
