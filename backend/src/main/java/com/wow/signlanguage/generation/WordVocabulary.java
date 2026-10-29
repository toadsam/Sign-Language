package com.wow.signlanguage.generation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Words the word GPT can draw (word_vocab_v1.json, vocab_map schema 1). Read once at startup.
 * A missing or unreadable file keeps the server up; generation then answers GENERATION_UNAVAILABLE.
 */
@Component
public class WordVocabulary {
  private static final Logger log = LoggerFactory.getLogger(WordVocabulary.class);

  private final Set<String> mapped;
  private final Set<String> ambiguous;

  public WordVocabulary(@Value("${sign.generation.word-vocab-path:}") String path, ObjectMapper mapper) {
    Set<String> loadedMapped = Set.of();
    Set<String> loadedAmbiguous = Set.of();
    if (path == null || path.isBlank()) {
      log.warn("sign.generation.word-vocab-path is not set; /api/sign/generate will be unavailable");
    } else {
      try {
        JsonNode root = mapper.readTree(Files.readString(Path.of(path.trim())));
        loadedMapped = words(root.get("mapping"), false);
        loadedAmbiguous = words(root.get("ambiguous"), true);
        if (root.path("schema_version").asInt() != 1 || loadedMapped.isEmpty()
            || loadedMapped.stream().anyMatch(loadedAmbiguous::contains)) {
          throw new IllegalArgumentException("unexpected vocabulary shape");
        }
        log.info("Loaded word vocabulary: {} mapped, {} ambiguous", loadedMapped.size(), loadedAmbiguous.size());
      } catch (Exception error) {
        // Never echo file contents; the path is operator configuration.
        log.warn("Word vocabulary at {} is unreadable ({}); /api/sign/generate will be unavailable",
            path, error.getClass().getSimpleName());
        loadedMapped = Set.of();
        loadedAmbiguous = Set.of();
      }
    }
    this.mapped = loadedMapped;
    this.ambiguous = loadedAmbiguous;
  }

  private static Set<String> words(JsonNode node, boolean ids) {
    if (node == null || !node.isObject()) throw new IllegalArgumentException("not an object");
    Set<String> words = new HashSet<>();
    for (Iterator<Map.Entry<String, JsonNode>> it = node.fields(); it.hasNext(); ) {
      Map.Entry<String, JsonNode> entry = it.next();
      JsonNode value = entry.getValue();
      boolean valid = ids ? value.isArray() && value.size() > 1 : value.isTextual() && !value.textValue().isBlank();
      if (entry.getKey().isBlank() || !valid) throw new IllegalArgumentException("bad entry");
      words.add(entry.getKey());
    }
    return Set.copyOf(words);
  }

  public boolean available() {
    return !mapped.isEmpty();
  }

  /** One fixed sign: the generator can draw it. */
  public boolean isMapped(String word) {
    return mapped.contains(word);
  }

  /** In the table at all, including words with several signs that the generator leaves unknown. */
  public boolean contains(String word) {
    return mapped.contains(word) || ambiguous.contains(word);
  }
}
