package com.wow.signlanguage.generation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.PriorityQueue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Embedding vectors of every drawable word, precomputed by {@link SynonymCacheBuilder} and read once at startup.
 * The cache must cover exactly the loaded vocabulary's mapping; otherwise (missing, stale, malformed) the
 * synonym step is off and generation behaves as before: out-of-table words pass through unchanged.
 *
 * <p>File: {@code {"schema_version":1, "model":..., "dimensions":N, "words":[...], "vectors":"<base64>"}},
 * vectors being row-major little-endian float32, one row per word.
 */
@Component
public class SynonymIndex {
  private static final Logger log = LoggerFactory.getLogger(SynonymIndex.class);
  static final int SCHEMA_VERSION = 1;

  private final String model;
  private final int dimensions;
  private final List<String> words;
  private final float[][] vectors;

  public SynonymIndex(@Value("${sign.generation.synonym.cache-path:}") String path, WordVocabulary vocabulary,
                      ObjectMapper mapper) {
    String loadedModel = "";
    int loadedDimensions = 0;
    List<String> loadedWords = List.of();
    float[][] loadedVectors = new float[0][];
    if (path == null || path.isBlank()) {
      log.info("sign.generation.synonym.cache-path is not set; out-of-table words stay unchanged");
    } else if (!vocabulary.available()) {
      log.warn("Synonym cache ignored because the word vocabulary is unavailable");
    } else {
      try {
        JsonNode root = mapper.readTree(Files.readString(Path.of(path.trim())));
        loadedModel = root.path("model").asText("");
        loadedDimensions = root.path("dimensions").asInt(0);
        loadedWords = readWords(root.get("words"));
        loadedVectors = decode(root.path("vectors").asText(""), loadedWords.size(), loadedDimensions);
        if (root.path("schema_version").asInt() != SCHEMA_VERSION || loadedModel.isBlank()) {
          throw new IllegalArgumentException("unexpected cache shape");
        }
        if (!new HashSet<>(loadedWords).equals(new HashSet<>(vocabulary.mappedWords()))) {
          throw new IllegalStateException("cache words differ from the vocabulary mapping");
        }
        log.info("Loaded synonym cache: {} words, {} ({} dims)", loadedWords.size(), loadedModel, loadedDimensions);
      } catch (Exception error) {
        log.warn("Synonym cache at {} is unusable ({}: {}); out-of-table words stay unchanged",
            path, error.getClass().getSimpleName(), error.getMessage());
        loadedModel = "";
        loadedDimensions = 0;
        loadedWords = List.of();
        loadedVectors = new float[0][];
      }
    }
    this.model = loadedModel;
    this.dimensions = loadedDimensions;
    this.words = loadedWords;
    this.vectors = loadedVectors;
  }

  public boolean available() {
    return !words.isEmpty();
  }

  /** Embedding model the cache was built with; queries must use the same one. */
  public String model() {
    return model;
  }

  public int dimensions() {
    return dimensions;
  }

  /** The {@code k} words with the highest cosine similarity to {@code query}, best first. */
  public List<String> nearest(float[] query, int k) {
    if (!available() || query == null || query.length != dimensions || k <= 0) return List.of();
    float[] q = unit(query.clone());
    if (q == null) return List.of();
    // Min-heap of the best k; on equal scores the later word is dropped first, so ties keep cache order.
    PriorityQueue<double[]> top = new PriorityQueue<>(Comparator.comparingDouble((double[] entry) -> entry[0])
        .thenComparing(Comparator.comparingDouble((double[] entry) -> entry[1]).reversed()));
    for (int i = 0; i < vectors.length; i++) {
      double score = 0;
      for (int d = 0; d < dimensions; d++) score += q[d] * vectors[i][d];
      top.add(new double[] {score, i});
      if (top.size() > k) top.poll();
    }
    List<double[]> ranked = new ArrayList<>(top);
    ranked.sort(Comparator.comparingDouble((double[] entry) -> entry[0]).reversed()
        .thenComparingDouble(entry -> entry[1]));
    return ranked.stream().map(entry -> words.get((int) entry[1])).toList();
  }

  /** Writes a cache file atomically (temp file, then move). Used by {@link SynonymCacheBuilder} and tests. */
  static void write(Path out, String model, List<String> words, List<float[]> vectors, ObjectMapper mapper)
      throws Exception {
    if (words.isEmpty() || words.size() != vectors.size()) throw new IllegalArgumentException("words/vectors");
    int dims = vectors.get(0).length;
    ByteBuffer buffer = ByteBuffer.allocate(words.size() * dims * Float.BYTES).order(ByteOrder.LITTLE_ENDIAN);
    for (float[] vector : vectors) {
      if (vector.length != dims) throw new IllegalArgumentException("ragged vectors");
      for (float value : vector) buffer.putFloat(value);
    }
    ObjectNode root = mapper.createObjectNode();
    root.put("schema_version", SCHEMA_VERSION);
    root.put("model", model);
    root.put("dimensions", dims);
    words.forEach(root.putArray("words")::add);
    root.put("vectors", Base64.getEncoder().encodeToString(buffer.array()));
    Path absolute = out.toAbsolutePath();
    if (absolute.getParent() != null) Files.createDirectories(absolute.getParent());
    Path temp = Files.createTempFile(absolute.getParent(), "synonym-cache", ".tmp");
    try {
      mapper.writeValue(temp.toFile(), root);
      Files.move(temp, absolute, StandardCopyOption.REPLACE_EXISTING);
    } finally {
      Files.deleteIfExists(temp);
    }
  }

  private static List<String> readWords(JsonNode node) {
    if (node == null || !node.isArray() || node.isEmpty()) throw new IllegalArgumentException("no words");
    List<String> words = new ArrayList<>();
    for (JsonNode word : node) {
      if (!word.isTextual() || word.textValue().isBlank()) throw new IllegalArgumentException("bad word");
      words.add(word.textValue());
    }
    if (new HashSet<>(words).size() != words.size()) throw new IllegalArgumentException("duplicate words");
    return List.copyOf(words);
  }

  private static float[][] decode(String base64, int rows, int dims) {
    if (dims <= 0) throw new IllegalArgumentException("bad dimensions");
    byte[] bytes = Base64.getDecoder().decode(base64);
    if (bytes.length != (long) rows * dims * Float.BYTES) throw new IllegalArgumentException("vector size");
    ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
    float[][] vectors = new float[rows][dims];
    for (int r = 0; r < rows; r++) {
      for (int d = 0; d < dims; d++) vectors[r][d] = buffer.getFloat();
      if (unit(vectors[r]) == null) throw new IllegalArgumentException("zero or non-finite vector");
    }
    return vectors;
  }

  /** Scales to length 1 in place; null for a zero or non-finite vector. */
  private static float[] unit(float[] vector) {
    double norm = 0;
    for (float value : vector) norm += (double) value * value;
    norm = Math.sqrt(norm);
    if (!(norm > 0) || Double.isInfinite(norm)) return null;
    for (int i = 0; i < vector.length; i++) vector[i] /= (float) norm;
    return vector;
  }
}
