package com.wow.signlanguage.generation;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** The synonym beans assemble from configuration alone (the full app context needs Firebase). */
class SynonymWiringTests {
  @TempDir Path dir;

  ApplicationContextRunner runner = new ApplicationContextRunner()
      .withBean(ObjectMapper.class)
      .withUserConfiguration(WordVocabulary.class, SynonymIndex.class, OpenAiSynonymClient.class, SynonymReplacer.class);

  @Test void wiresWithACacheAndKey() throws Exception {
    Path vocab = dir.resolve("vocab.json");
    Files.writeString(vocab, SynonymIndexTests.VOCAB);
    Path cache = dir.resolve("cache.json");
    SynonymIndex.write(cache, "test-embedding", SynonymIndexTests.WORDS, SynonymIndexTests.VECTORS, new ObjectMapper());
    runner.withPropertyValues("sign.generation.word-vocab-path=" + vocab, "sign.generation.synonym.cache-path=" + cache,
            "openai.api-key=test-key")
        .run(context -> {
          assertThat(context).hasNotFailed();
          assertThat(context.getBean(SynonymIndex.class).available()).isTrue();
          assertThat(context.getBean(OpenAiSynonymClient.class).configured()).isTrue();
        });
  }

  @Test void wiresAndStaysOffWithNothingConfigured() {
    runner.run(context -> {
      assertThat(context).hasNotFailed();
      assertThat(context.getBean(SynonymIndex.class).available()).isFalse();
      assertThat(context.getBean(SynonymReplacer.class).replace("문장", List.of("변소")).words())
          .containsExactly("변소");
    });
  }
}
