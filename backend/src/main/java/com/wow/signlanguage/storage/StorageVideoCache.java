package com.wow.signlanguage.storage;

import com.google.cloud.storage.Blob;
import com.google.cloud.storage.Storage;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class StorageVideoCache {

  private static final Logger log = LoggerFactory.getLogger(StorageVideoCache.class);
  private static final String DEFAULT_FOLDER_PREFIX = "necessory_json_files/Model_videos/";
  private static final String ALTERNATE_FOLDER_PREFIX = "necessary_json_files/Model_videos/";
  private static final String DOWNLOAD_TOKEN_METADATA_KEY = "firebaseStorageDownloadTokens";

  private final Storage storage;
  private final String storageBucket;
  private final List<String> folderPrefixes;
  private final Map<String, String> cache = new ConcurrentHashMap<>();

  public StorageVideoCache(
      Storage storage,
      @Value("${firebase.storage-bucket}") String storageBucket,
      @Value("${firebase.storage-video-prefix:" + DEFAULT_FOLDER_PREFIX + "}") String storageVideoPrefix) {
    this.storage = storage;
    this.storageBucket = storageBucket;
    this.folderPrefixes = buildFolderPrefixes(storageVideoPrefix);
  }

  public String findUrl(String word) {
    if (word == null || word.isBlank()) {
      return null;
    }

    String normalizedWord = word.trim();
    String cachedUrl = cache.get(normalizedWord);
    if (cachedUrl != null) {
      return cachedUrl;
    }

    String loadedUrl = loadUrl(normalizedWord);
    if (loadedUrl == null || loadedUrl.isBlank()) {
      return null;
    }

    String previousUrl = cache.putIfAbsent(normalizedWord, loadedUrl);
    return previousUrl == null ? loadedUrl : previousUrl;
  }

  public String findUrlOrFallback(String word, String fallbackUrl) {
    String storageUrl = findUrl(word);
    if (storageUrl != null && !storageUrl.isBlank()) {
      return storageUrl;
    }
    return fallbackUrl == null ? "" : fallbackUrl.trim();
  }

  private String loadUrl(String word) {
    for (String folderPrefix : folderPrefixes) {
      String searchPrefix = folderPrefix + word;
      log.info("[StorageVideoCache] Looking up Firebase Storage video bucket='{}', prefix='{}'", storageBucket, searchPrefix);

      try {
        Iterable<Blob> blobs = storage.list(
            storageBucket,
            Storage.BlobListOption.prefix(searchPrefix)
        ).iterateAll();

        for (Blob blob : blobs) {
          String blobName = blob.getName();
          if (blobName.equals(folderPrefix) || blobName.endsWith("/")) {
            continue;
          }

          String fileName = blobName.substring(folderPrefix.length());
          String extractedWord = extractWord(fileName);
          if (word.equals(extractedWord)) {
            return buildDownloadUrl(blob);
          }
        }
      } catch (Exception e) {
        log.warn("[StorageVideoCache] Storage lookup failed for prefix='{}'.", searchPrefix, e);
      }
    }

    return null;
  }

  private String extractWord(String fileName) {
    int dotIndex = fileName.lastIndexOf('.');
    String nameWithoutExt = dotIndex >= 0 ? fileName.substring(0, dotIndex) : fileName;

    int underscoreIndex = nameWithoutExt.indexOf('_');
    if (underscoreIndex <= 0) {
      return nameWithoutExt;
    }
    return nameWithoutExt.substring(0, underscoreIndex);
  }

  private String buildDownloadUrl(Blob blob) {
    String encodedPath = urlEncode(blob.getName());
    String downloadUrl = String.format(
        "https://firebasestorage.googleapis.com/v0/b/%s/o/%s?alt=media",
        storageBucket, encodedPath);

    String downloadToken = findDownloadToken(blob);
    if (downloadToken == null || downloadToken.isBlank()) {
      return buildSignedUrlOrFallback(blob, downloadUrl);
    }

    return downloadUrl + "&token=" + urlEncode(downloadToken);
  }

  private String buildSignedUrlOrFallback(Blob blob, String fallbackUrl) {
    try {
      URL signedUrl = blob.signUrl(365, TimeUnit.DAYS);
      return signedUrl.toString();
    } catch (Exception e) {
      log.warn("[StorageVideoCache] Could not sign Storage URL for '{}'. Using direct media URL.", blob.getName());
      return fallbackUrl;
    }
  }

  private String findDownloadToken(Blob blob) {
    Map<String, String> metadata = blob.getMetadata();
    if (metadata == null) {
      return null;
    }

    String rawTokens = metadata.get(DOWNLOAD_TOKEN_METADATA_KEY);
    if (rawTokens == null || rawTokens.isBlank()) {
      return null;
    }

    return rawTokens.split(",", 2)[0].trim();
  }

  private String urlEncode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  private List<String> buildFolderPrefixes(String configuredPrefix) {
    LinkedHashSet<String> prefixes = new LinkedHashSet<>();
    addPrefix(prefixes, configuredPrefix);
    addPrefix(prefixes, DEFAULT_FOLDER_PREFIX);
    addPrefix(prefixes, ALTERNATE_FOLDER_PREFIX);
    return List.copyOf(prefixes);
  }

  private void addPrefix(LinkedHashSet<String> prefixes, String prefix) {
    if (prefix == null || prefix.isBlank()) {
      return;
    }

    String normalized = prefix.trim().replace('\\', '/');
    if (!normalized.endsWith("/")) {
      normalized += "/";
    }
    prefixes.add(normalized);
  }
}
