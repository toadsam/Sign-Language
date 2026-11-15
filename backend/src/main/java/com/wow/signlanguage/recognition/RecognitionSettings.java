package com.wow.signlanguage.recognition;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Where the reading model lives. {@code sign.recognition.url} wins; when it is blank the URL is derived
 * from the generation URL by replacing its trailing {@code /generate} with {@code /recognize} (same
 * inference server). Timeouts and the frame limit are shared with generation.
 */
@Component
public record RecognitionSettings(URI url, Duration connectTimeout, Duration responseTimeout, int maxFrames) {

  public RecognitionSettings {
    // url 이 null 이면(주소를 정할 수 없음) 서버는 그대로 켜지고 읽기 API 만 503 을 돌려준다
    if (url != null && (!("http".equals(url.getScheme()) || "https".equals(url.getScheme()))
        || url.getHost() == null || url.getUserInfo() != null || url.getFragment() != null)
        || connectTimeout == null || connectTimeout.isNegative() || connectTimeout.isZero()
        || responseTimeout == null || responseTimeout.isNegative() || responseTimeout.isZero()
        || maxFrames <= 0 || maxFrames > 100_000) {
      throw new IllegalArgumentException("Invalid recognition configuration");
    }
  }

  @Autowired
  public RecognitionSettings(
      @Value("${sign.recognition.url:}") String url,
      @Value("${sign.generation.url:http://127.0.0.1:8000/generate}") URI generationUrl,
      @Value("${sign.generation.connect-timeout:PT1S}") Duration connectTimeout,
      @Value("${sign.generation.response-timeout:PT10S}") Duration responseTimeout,
      @Value("${sign.generation.max-frames:1800}") int maxFrames) {
    this(resolve(url, generationUrl), connectTimeout, responseTimeout, maxFrames);
  }

  /** Explicit URL, or {@code http://host:port/x/generate} -> {@code http://host:port/x/recognize}; null when neither works. */
  static URI resolve(String explicit, URI generationUrl) {
    try {
      if (explicit != null && !explicit.isBlank()) return new URI(explicit.strip());
      String path = generationUrl == null ? null : generationUrl.getRawPath();
      if (path == null || !path.endsWith("/generate")) return null;
      return new URI(generationUrl.getScheme() + "://" + generationUrl.getRawAuthority()
          + path.substring(0, path.length() - "/generate".length()) + "/recognize");
    } catch (URISyntaxException error) {
      return null;
    }
  }
}
