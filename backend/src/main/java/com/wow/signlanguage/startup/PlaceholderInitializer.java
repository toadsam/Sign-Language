package com.wow.signlanguage.startup;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.dictionary.SignDictionaryEntry;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class PlaceholderInitializer implements ApplicationRunner {

  private final DictionaryLoader dictionaryLoader;
  private final ClipPathResolver clipPathResolver;

  public PlaceholderInitializer(DictionaryLoader dictionaryLoader, ClipPathResolver clipPathResolver) {
    this.dictionaryLoader = dictionaryLoader;
    this.clipPathResolver = clipPathResolver;
  }

  @Override
  public void run(ApplicationArguments args) throws Exception {
    Path clipsDirectory = clipPathResolver.resolveClipsDirectory();
    Files.createDirectories(clipsDirectory);

    for (SignDictionaryEntry entry : dictionaryLoader.entries()) {
      Path filePath = clipsDirectory.resolve(entry.file());
      if (Files.notExists(filePath)) {
        Files.writeString(
            filePath,
            "",
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE_NEW
        );
      }
    }
  }
}
