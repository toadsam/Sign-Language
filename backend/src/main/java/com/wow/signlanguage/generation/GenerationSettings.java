package com.wow.signlanguage.generation;

import java.net.URI;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public record GenerationSettings(URI url, Duration connectTimeout, Duration responseTimeout,
                                 int maxTextChars, int maxFrames) {
  public GenerationSettings(
      @Value("${sign.generation.url:http://127.0.0.1:8000/generate}") URI url,
      @Value("${sign.generation.connect-timeout:PT1S}") Duration connectTimeout,
      @Value("${sign.generation.response-timeout:PT10S}") Duration responseTimeout,
      @Value("${sign.generation.max-text-chars:4096}") int maxTextChars,
      @Value("${sign.generation.max-frames:1800}") int maxFrames) {
    if (url == null || !("http".equals(url.getScheme()) || "https".equals(url.getScheme()))
        || url.getHost() == null || url.getUserInfo() != null || url.getFragment() != null
        || connectTimeout == null || connectTimeout.isNegative() || connectTimeout.isZero()
        || responseTimeout == null || responseTimeout.isNegative() || responseTimeout.isZero()
        || maxTextChars <= 0 || maxFrames <= 0 || maxFrames > 100_000) {
      throw new IllegalArgumentException("Invalid generation configuration");
    }
    this.url = url;
    this.connectTimeout = connectTimeout;
    this.responseTimeout = responseTimeout;
    this.maxTextChars = maxTextChars;
    this.maxFrames = maxFrames;
  }
}
