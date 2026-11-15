package com.wow.signlanguage.generation;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code translator}: {@code spring} (default) uses {@link GlossTranslator}; {@code serve} asks the inference
 * server's own {@code POST /translate} at {@code translateUrl} (default: the generate URL with its trailing
 * {@code /generate} replaced by {@code /translate}).
 */
@Component
public record GenerationSettings(URI url, Duration connectTimeout, Duration responseTimeout,
                                 int maxTextChars, int maxFrames, String translator, URI translateUrl) {
  public static final String SPRING = "spring";
  public static final String SERVE = "serve";

  @Autowired
  public GenerationSettings(
      @Value("${sign.generation.url:http://127.0.0.1:8000/generate}") URI url,
      @Value("${sign.generation.connect-timeout:PT1S}") Duration connectTimeout,
      @Value("${sign.generation.response-timeout:PT10S}") Duration responseTimeout,
      @Value("${sign.generation.max-text-chars:4096}") int maxTextChars,
      @Value("${sign.generation.max-frames:1800}") int maxFrames,
      @Value("${sign.generation.translator:spring}") String translator,
      @Value("${sign.generation.translate-url:#{null}}") URI translateUrl) {
    if (!validUrl(url)
        || connectTimeout == null || connectTimeout.isNegative() || connectTimeout.isZero()
        || responseTimeout == null || responseTimeout.isNegative() || responseTimeout.isZero()
        || maxTextChars <= 0 || maxFrames <= 0 || maxFrames > 100_000) {
      throw new IllegalArgumentException("Invalid generation configuration");
    }
    String mode = translator == null || translator.isBlank() ? SPRING : translator.strip().toLowerCase(Locale.ROOT);
    if (!mode.equals(SPRING) && !mode.equals(SERVE)) {
      throw new IllegalArgumentException("Invalid generation configuration");
    }
    URI translate = translateUrl == null || translateUrl.toString().isBlank() ? derive(url) : translateUrl;
    if (translate != null && !validUrl(translate) || mode.equals(SERVE) && translate == null) {
      throw new IllegalArgumentException("Invalid generation configuration");
    }
    this.url = url;
    this.connectTimeout = connectTimeout;
    this.responseTimeout = responseTimeout;
    this.maxTextChars = maxTextChars;
    this.maxFrames = maxFrames;
    this.translator = mode;
    this.translateUrl = translate;
  }

  /** Spring translator, derived translate URL (same as before the serve mode existed). */
  public GenerationSettings(URI url, Duration connectTimeout, Duration responseTimeout,
                            int maxTextChars, int maxFrames) {
    this(url, connectTimeout, responseTimeout, maxTextChars, maxFrames, SPRING, null);
  }

  public boolean serveTranslator() {
    return SERVE.equals(translator);
  }

  private static boolean validUrl(URI url) {
    return url != null && ("http".equals(url.getScheme()) || "https".equals(url.getScheme()))
        && url.getHost() != null && url.getUserInfo() == null && url.getFragment() == null;
  }

  /** {@code http://host:port/x/generate} -> {@code http://host:port/x/translate}; null when not derivable. */
  private static URI derive(URI url) {
    String path = url == null ? null : url.getRawPath();
    if (path == null || !path.endsWith("/generate")) return null;
    try {
      return new URI(url.getScheme() + "://" + url.getRawAuthority()
          + path.substring(0, path.length() - "/generate".length()) + "/translate");
    } catch (URISyntaxException error) {
      return null;
    }
  }
}
