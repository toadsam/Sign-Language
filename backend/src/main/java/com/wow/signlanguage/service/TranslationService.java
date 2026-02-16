package com.wow.signlanguage.service;

import com.wow.signlanguage.dictionary.DictionaryLoader;
import com.wow.signlanguage.dictionary.SignDictionaryEntry;
import com.wow.signlanguage.normalizer.TextNormalizer;
import com.wow.signlanguage.translate.ClipMatch;
import com.wow.signlanguage.translate.TranslateResponse;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class TranslationService {

  private final TextNormalizer textNormalizer;
  private final DictionaryLoader dictionaryLoader;

  public TranslationService(TextNormalizer textNormalizer, DictionaryLoader dictionaryLoader) {
    this.textNormalizer = textNormalizer;
    this.dictionaryLoader = dictionaryLoader;
  }

  public TranslateResponse translate(String input) {
    String safeInput = input == null ? "" : input;
    List<String> tokens = textNormalizer.normalizeTokens(safeInput);
    List<ClipMatch> clips = new ArrayList<>();
    List<String> unknown = new ArrayList<>();

    for (String token : tokens) {
      SignDictionaryEntry entry = dictionaryLoader.findByWord(token).orElse(null);
      if (entry == null) {
        unknown.add(token);
        continue;
      }

      clips.add(new ClipMatch(
          token,
          entry.id(),
          entry.file(),
          "/clips/" + entry.file()
      ));
    }

    return new TranslateResponse(safeInput, tokens, clips, unknown);
  }
}
