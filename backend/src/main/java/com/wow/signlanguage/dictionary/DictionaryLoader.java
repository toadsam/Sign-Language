package com.wow.signlanguage.dictionary;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import jakarta.annotation.PostConstruct;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
public class DictionaryLoader {

  private final ObjectMapper objectMapper;
  private Map<String, SignDictionaryEntry> byWord = Map.of();
  private List<SignDictionaryEntry> entries = List.of();

  public DictionaryLoader(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  @PostConstruct
  public void load() {
    try (InputStream inputStream = new ClassPathResource("sign_dictionary.json").getInputStream()) {
      List<SignDictionaryEntry> loaded = objectMapper.readValue(
          inputStream,
          new TypeReference<>() {
          }
      );

      List<SignDictionaryEntry> mutableEntries = new ArrayList<>(loaded);
      Map<String, SignDictionaryEntry> mutableMap = new LinkedHashMap<>();
      for (SignDictionaryEntry entry : mutableEntries) {
        mutableMap.put(entry.word(), entry);
      }

      this.entries = Collections.unmodifiableList(mutableEntries);
      this.byWord = Collections.unmodifiableMap(mutableMap);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to load sign_dictionary.json", e);
    }
  }

  public Optional<SignDictionaryEntry> findByWord(String word) {
    return Optional.ofNullable(byWord.get(word));
  }

  public List<SignDictionaryEntry> entries() {
    return entries;
  }
}
