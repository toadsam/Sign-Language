package com.wow.signlanguage.generation;

import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = GenerationController.class)
public class GenerationErrorHandler {
  public record ErrorDetail(String code, String message, boolean retryable) {}
  public record ErrorEnvelope(ErrorDetail error) {}

  @ExceptionHandler(GenerationFailure.class)
  public ResponseEntity<ErrorEnvelope> generationFailure(GenerationFailure failure) {
    var response = ResponseEntity.status(failure.reason.status);
    if (failure.retryAfter) response.header("Retry-After", "1");
    return response.body(new ErrorEnvelope(new ErrorDetail(
        failure.reason.name(), failure.reason.message, failure.reason.retryable)));
  }

  @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
  public ResponseEntity<ErrorEnvelope> invalidRequest(Exception ignored) {
    return generationFailure(new GenerationFailure(GenerationFailure.Reason.INVALID_REQUEST));
  }
}
