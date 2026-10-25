package com.wow.signlanguage.generation;

import org.springframework.http.HttpStatus;

/** Safe public errors for this API only; never retain upstream messages or input. */
public final class GenerationFailure extends RuntimeException {
  public enum Reason {
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "올바른 문장을 입력해 주세요.", false),
    NO_GENERATABLE_INPUT(HttpStatus.UNPROCESSABLE_ENTITY, "생성할 수 있는 입력이 없습니다. 입력을 확인해 주세요.", false),
    TRANSLATION_UNAVAILABLE(HttpStatus.BAD_GATEWAY, "문장을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", true),
    GENERATION_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "동작을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.", true),
    GENERATION_TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "동작 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", true),
    GENERATION_FAILED(HttpStatus.BAD_GATEWAY, "동작을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.", true);

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

  public GenerationFailure(Reason reason) { this(reason, false); }

  public GenerationFailure(Reason reason, boolean retryAfter) {
    super(reason.name());
    this.reason = reason;
    this.retryAfter = retryAfter && reason == Reason.GENERATION_UNAVAILABLE;
  }
}
