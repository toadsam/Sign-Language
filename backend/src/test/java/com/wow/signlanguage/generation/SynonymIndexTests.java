package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Synthetic 3-dimensional vectors; no OpenAI call. */
class SynonymIndexTests {
  static final String VOCAB = """
      {"schema_version": 1,
       "mapping": {"화장실": "WORD0001", "친구": "WORD0002", "만나다": "WORD0003", "개": "WORD0004"},
       "ambiguous": {"눈": ["WORD0005", "WORD0006"]}}
      """;
  static final List<String> WORDS = List.of("개", "만나다", "친구", "화장실");
  static final List<float[]> VECTORS = List.of(
      new float[] {0, 0, 1}, new float[] {0, 0.8f, 0.6f}, new float[] {0, 1, 0}, new float[] {2, 0, 0});
  static final ObjectMapper JSON = new ObjectMapper();

  @TempDir Path dir;

  /** A vocabulary plus a cache that matches it. */
  static SynonymIndex index(Path dir) throws Exception {
    WordVocabulary vocabulary = WordVocabularyTests.load(dir, VOCAB);
    Path cache = dir.resolve("cache.json");
    SynonymIndex.write(cache, "test-embedding", WORDS, VECTORS, JSON);
    return new SynonymIndex(cache.toString(), vocabulary, JSON);
  }

  @Test void loadsAMatchingCacheAndRanksByCosine() throws Exception {
    SynonymIndex index = index(dir);
    assertThat(index.available()).isTrue();
    assertThat(index.model()).isEqualTo("test-embedding");
    assertThat(index.dimensions()).isEqualTo(3);
    // Length does not matter (화장실 is stored as [2,0,0]); direction does.
    assertThat(index.nearest(new float[] {5, 0.1f, 0}, 1)).containsExactly("화장실");
    assertThat(index.nearest(new float[] {0, 1, 0.1f}, 3)).containsExactly("친구", "만나다", "개");
    assertThat(index.nearest(new float[] {0, 1, 0}, 10)).hasSize(4);
  }

  @Test void badQueriesReturnNothing() throws Exception {
    SynonymIndex index = index(dir);
    assertThat(index.nearest(new float[] {1, 0}, 3)).isEmpty();
    assertThat(index.nearest(new float[] {0, 0, 0}, 3)).isEmpty();
    assertThat(index.nearest(new float[] {1, 0, 0}, 0)).isEmpty();
  }

  @Test void noPathMeansOff() throws Exception {
    assertThat(new SynonymIndex("", WordVocabularyTests.load(dir, VOCAB), JSON).available()).isFalse();
  }

  @Test void missingFileMeansOff() throws Exception {
    WordVocabulary vocabulary = WordVocabularyTests.load(dir, VOCAB);
    assertThat(new SynonymIndex(dir.resolve("nope.json").toString(), vocabulary, JSON).available()).isFalse();
  }

  @Test void cacheForAnotherVocabularyIsRejected() throws Exception {
    WordVocabulary vocabulary = WordVocabularyTests.load(dir, VOCAB);
    Path cache = dir.resolve("stale.json");
    SynonymIndex.write(cache, "test-embedding", WORDS.subList(0, 3), VECTORS.subList(0, 3), JSON);
    assertThat(new SynonymIndex(cache.toString(), vocabulary, JSON).available()).isFalse();
  }

  @Test void malformedCachesAreRejected() throws Exception {
    WordVocabulary vocabulary = WordVocabularyTests.load(dir, VOCAB);
    String words = JSON.writeValueAsString(WORDS);
    for (String body : List.of(
        "not json",
        "{\"schema_version\":2,\"model\":\"m\",\"dimensions\":1,\"words\":" + words + ",\"vectors\":\"AACAPwAAgD8AAIA/AACAPw==\"}",
        "{\"schema_version\":1,\"model\":\"m\",\"dimensions\":1,\"words\":" + words + ",\"vectors\":\"AACAPw==\"}",
        "{\"schema_version\":1,\"model\":\"m\",\"dimensions\":1,\"words\":" + words + ",\"vectors\":\"AAAAAAAAAAAAAAAAAAAAAA==\"}",
        "{\"schema_version\":1,\"model\":\"\",\"dimensions\":1,\"words\":" + words + ",\"vectors\":\"AACAPwAAgD8AAIA/AACAPw==\"}")) {
      Path cache = dir.resolve("bad.json");
      Files.writeString(cache, body);
      assertThat(new SynonymIndex(cache.toString(), vocabulary, JSON).available()).as(body).isFalse();
    }
  }

  @Test void unavailableVocabularyMeansOff() throws Exception {
    Path cache = dir.resolve("cache.json");
    SynonymIndex.write(cache, "test-embedding", WORDS, VECTORS, JSON);
    assertThat(new SynonymIndex(cache.toString(), new WordVocabulary("", JSON), JSON).available()).isFalse();
  }

  @Test void builderEmbedsMappingWordsOnlyAndWritesALoadableCache() throws Exception {
    Path vocabPath = dir.resolve("vocab.json");
    Files.writeString(vocabPath, VOCAB);
    OpenAiSynonymClient client = mock(OpenAiSynonymClient.class);
    when(client.configured()).thenReturn(true);
    when(client.embed(anyList(), anyString(), anyInt())).thenReturn(Optional.of(VECTORS));
    Path out = dir.resolve("built.json");

    assertThat(SynonymCacheBuilder.build(vocabPath, out, "test-embedding", 3, client, JSON)).isEqualTo(4);
    verify(client).embed(WORDS, "test-embedding", 3);  // sorted mapping words; ambiguous 눈 is not embedded
    SynonymIndex index = new SynonymIndex(out.toString(), new WordVocabulary(vocabPath.toString(), JSON), JSON);
    assertThat(index.available()).isTrue();
    assertThat(index.nearest(new float[] {1, 0, 0}, 1)).containsExactly("화장실");
  }

  @Test void builderWritesNothingWhenEmbeddingFails() throws Exception {
    Path vocabPath = dir.resolve("vocab.json");
    Files.writeString(vocabPath, VOCAB);
    OpenAiSynonymClient client = mock(OpenAiSynonymClient.class);
    when(client.configured()).thenReturn(true);
    when(client.embed(anyList(), anyString(), anyInt())).thenReturn(Optional.empty());
    Path out = dir.resolve("built.json");
    assertThatThrownBy(() -> SynonymCacheBuilder.build(vocabPath, out, "m", 3, client, JSON))
        .isInstanceOf(IllegalStateException.class);
    assertThat(out).doesNotExist();
  }

  @Test void batchesSplitEvenly() {
    assertThat(OpenAiSynonymClient.batches(List.of("a", "b", "c", "d", "e"), 2))
        .containsExactly(List.of("a", "b"), List.of("c", "d"), List.of("e"));
  }
}
