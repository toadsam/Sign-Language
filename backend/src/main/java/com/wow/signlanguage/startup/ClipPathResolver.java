package com.wow.signlanguage.startup;

import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.stereotype.Component;

@Component
public class ClipPathResolver {

  public Path resolveClipsDirectory() {
    Path workingDirectory = Paths.get(System.getProperty("user.dir")).toAbsolutePath();

    if (workingDirectory.resolve("pom.xml").toFile().exists()) {
      return workingDirectory.resolve("src/main/resources/static/clips");
    }

    if (workingDirectory.resolve("backend/pom.xml").toFile().exists()) {
      return workingDirectory.resolve("backend/src/main/resources/static/clips");
    }

    return workingDirectory.resolve("src/main/resources/static/clips");
  }
}
