package com.wow.signlanguage.generation;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Builds the synonym embedding cache for {@link SynonymIndex} from the word vocabulary (mapping words only).
 * Calls the OpenAI embeddings API (OPENAI_API_KEY); ~2600 short words cost well under one US cent.
 *
 * <pre>
 * OPENAI_API_KEY=... ./gradlew buildSynonymCache -Pvocab=PATH/word_vocab_v1.json -Pout=PATH/synonym_cache_v1.json
 *   [-Pmodel=text-embedding-3-small] [-Pdimensions=512]
 * </pre>
 * The output is a local file (do not commit it). Point sign.generation.synonym.cache-path at it.
 */
public final class SynonymCacheBuilder {
  static final String DEFAULT_MODEL = "text-embedding-3-small";
  static final int DEFAULT_DIMENSIONS = 512;
  static final int BATCH = 500;

  private SynonymCacheBuilder() {}

  public static void main(String[] args) throws Exception {
    if (args.length < 2 || args[0].isBlank() || args[1].isBlank()) {
      System.err.println("usage: SynonymCacheBuilder <vocab.json> <out.json> [model] [dimensions]");
      System.exit(2);
    }
    String model = args.length > 2 && !args[2].isBlank() ? args[2] : DEFAULT_MODEL;
    int dimensions = args.length > 3 && !args[3].isBlank() ? Integer.parseInt(args[3]) : DEFAULT_DIMENSIONS;
    ObjectMapper mapper = new ObjectMapper();
    OpenAiSynonymClient client = new OpenAiSynonymClient(mapper, System.getenv("OPENAI_API_KEY"), "unused", "unused",
        Optional.ofNullable(System.getenv("OPENAI_EMBEDDINGS_URL")).orElse("https://api.openai.com/v1/embeddings"));
    int words = build(Path.of(args[0]), Path.of(args[1]), model, dimensions, client, mapper);
    System.out.printf("wrote %d words (%s, %d dims) to %s%n", words, model, dimensions, args[1]);
  }

  /** Returns the number of words written. Fails without writing anything if any batch fails. */
  static int build(Path vocabPath, Path out, String model, int dimensions, OpenAiSynonymClient client,
                   ObjectMapper mapper) throws Exception {
    if (!Files.isRegularFile(vocabPath)) throw new IllegalArgumentException("vocabulary file not found");
    WordVocabulary vocabulary = new WordVocabulary(vocabPath.toString(), mapper);
    if (!vocabulary.available()) throw new IllegalArgumentException("vocabulary is unreadable");
    if (!client.configured()) throw new IllegalStateException("OPENAI_API_KEY is not set");
    List<String> words = vocabulary.mappedWords();
    List<float[]> vectors = new ArrayList<>(words.size());
    for (List<String> batch : OpenAiSynonymClient.batches(words, BATCH)) {
      List<float[]> embedded = client.embed(batch, model, dimensions)
          .orElseThrow(() -> new IllegalStateException("embedding request failed"));
      vectors.addAll(embedded);
    }
    SynonymIndex.write(out, model, words, vectors, mapper);
    return words.size();
  }
}
