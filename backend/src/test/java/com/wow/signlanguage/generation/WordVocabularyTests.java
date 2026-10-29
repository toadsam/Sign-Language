package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Synthetic vocabularies only; the real word_vocab_v1.json is never committed. */
class WordVocabularyTests {
  static final String VALID = """
      {"schema_version": 1, "name": "synthetic", "draft": true,
       "mapping": {"화장실": "WORD0001", "친구": "WORD0002", "어쩔 수 없다": "WORD0003"},
       "ambiguous": {"눈": ["WORD0004", "WORD0005"]}, "unmapped": [], "entries": []}
      """;

  @TempDir Path dir;

  static WordVocabulary load(Path dir, String json) throws Exception {
    Path file = dir.resolve("vocab.json");
    Files.writeString(file, json);
    return new WordVocabulary(file.toString(), new ObjectMapper());
  }

  @Test void loadsMappedAndAmbiguousWords() throws Exception {
    WordVocabulary vocabulary = load(dir, VALID);
    assertThat(vocabulary.available()).isTrue();
    assertThat(vocabulary.isMapped("화장실")).isTrue();
    assertThat(vocabulary.isMapped("어쩔 수 없다")).isTrue();
    assertThat(vocabulary.isMapped("눈")).isFalse();
    assertThat(vocabulary.contains("눈")).isTrue();
    assertThat(vocabulary.contains("고양이")).isFalse();
  }

  @ParameterizedTest @ValueSource(strings = {"", "  "})
  void unsetPathIsUnavailable(String path) {
    WordVocabulary vocabulary = new WordVocabulary(path, new ObjectMapper());
    assertThat(vocabulary.available()).isFalse();
    assertThat(vocabulary.contains("화장실")).isFalse();
  }

  @Test void missingFileIsUnavailable() {
    assertThat(new WordVocabulary(dir.resolve("absent.json").toString(), new ObjectMapper()).available()).isFalse();
  }

  @ParameterizedTest @ValueSource(strings = {
      "{",
      "[]",
      "{\"schema_version\": 2, \"mapping\": {\"화장실\": \"WORD0001\"}, \"ambiguous\": {}}",
      "{\"schema_version\": 1, \"ambiguous\": {}}",
      "{\"schema_version\": 1, \"mapping\": {}, \"ambiguous\": {}}",
      "{\"schema_version\": 1, \"mapping\": {\"화장실\": 1}, \"ambiguous\": {}}",
      "{\"schema_version\": 1, \"mapping\": {\"화장실\": \"WORD0001\"}}",
      "{\"schema_version\": 1, \"mapping\": {\"화장실\": \"WORD0001\"}, \"ambiguous\": {\"눈\": [\"WORD0004\"]}}",
      "{\"schema_version\": 1, \"mapping\": {\"눈\": \"WORD0001\"}, \"ambiguous\": {\"눈\": [\"WORD0004\", \"WORD0005\"]}}"})
  void malformedFileIsUnavailable(String json) throws Exception {
    WordVocabulary vocabulary = load(dir, json);
    assertThat(vocabulary.available()).isFalse();
    assertThat(vocabulary.isMapped("화장실")).isFalse();
  }

  @Test @EnabledIfEnvironmentVariable(named = "SIGN_WORD_VOCAB_PATH", matches = ".+")
  void configuredRealVocabularyLoads() {
    WordVocabulary vocabulary = new WordVocabulary(System.getenv("SIGN_WORD_VOCAB_PATH"), new ObjectMapper());
    assertThat(vocabulary.available()).isTrue();
  }
}
