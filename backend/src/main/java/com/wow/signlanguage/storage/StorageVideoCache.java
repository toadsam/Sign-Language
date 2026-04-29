package com.wow.signlanguage.storage;

import com.google.cloud.storage.Blob;
import com.google.cloud.storage.Storage;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * 앱 시작 시 Firebase Storage의 "Model_videos/" 폴더를 스캔하여
 * Map<단어명, 다운로드URL> 형태로 메모리에 캐시합니다.
 *
 * 파일명 규칙: "가깝다_NIA_SL_WORD0948_REAL01.mp4" → 첫 번째 '_' 앞이 단어명
 */
@Component
public class StorageVideoCache implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(StorageVideoCache.class);
  private static final String FOLDER_PREFIX = "necessory_json_files/Model_videos/";

  private final Storage storage;
  private final String storageBucket;

  // Map<단어명, Firebase Storage 다운로드 URL>
  private final Map<String, String> cache = new ConcurrentHashMap<>();

  public StorageVideoCache(
      Storage storage,
      @Value("${firebase.storage-bucket}") String storageBucket) {
    this.storage = storage;
    this.storageBucket = storageBucket;
  }

  @Override
  public void run(ApplicationArguments args) {
    log.info("[StorageVideoCache] Firebase Storage '{}' 폴더 스캔 시작...", FOLDER_PREFIX);
    int loaded = 0;

    try {
      Iterable<Blob> blobs = storage.list(
          storageBucket,
          Storage.BlobListOption.prefix(FOLDER_PREFIX)
      ).iterateAll();

      for (Blob blob : blobs) {
        String blobName = blob.getName(); // e.g. "Model_videos/가깝다_NIA_SL_WORD0948_REAL01.mp4"

        // 폴더 자체(접미사 없는 항목) 제외
        if (blobName.equals(FOLDER_PREFIX) || blobName.endsWith("/")) {
          continue;
        }

        // 파일명만 추출: "가깝다_NIA_SL_WORD0948_REAL01.mp4"
        String fileName = blobName.substring(FOLDER_PREFIX.length());

        // 단어명 추출: 첫 번째 '_' 앞 부분
        String word = extractWord(fileName);
        if (word == null || word.isBlank()) {
          continue;
        }

        // Firebase Storage 다운로드 URL 생성
        // 형식: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media
        String encodedPath = URLEncoder.encode(blobName, StandardCharsets.UTF_8)
            .replace("+", "%20");
        String downloadUrl = String.format(
            "https://firebasestorage.googleapis.com/v0/b/%s/o/%s?alt=media",
            storageBucket, encodedPath);

        cache.put(word, downloadUrl);
        loaded++;
      }

      log.info("[StorageVideoCache] 캐시 완료: {}개 단어 로드됨", loaded);
    } catch (Exception e) {
      log.error("[StorageVideoCache] Storage 스캔 실패 - 퀴즈 영상은 Firestore videoUrl로 fallback됩니다.", e);
    }
  }

  /**
   * 단어명으로 다운로드 URL 조회.
   * 없으면 null 반환 → QuizService에서 Firestore videoUrl로 fallback.
   */
  public String findUrl(String word) {
    if (word == null || word.isBlank()) return null;
    return cache.get(word.trim());
  }

  /**
   * 파일명에서 단어명 추출.
   * "가깝다_NIA_SL_WORD0948_REAL01.mp4" → "가깝다"
   */
  private String extractWord(String fileName) {
    // .mp4 등 확장자 제거
    int dotIndex = fileName.lastIndexOf('.');
    String nameWithoutExt = dotIndex >= 0 ? fileName.substring(0, dotIndex) : fileName;

    // 첫 번째 '_' 앞 부분이 단어명
    int underscoreIndex = nameWithoutExt.indexOf('_');
    if (underscoreIndex <= 0) {
      // '_'가 없으면 파일명 전체를 단어명으로 사용
      return nameWithoutExt;
    }
    return nameWithoutExt.substring(0, underscoreIndex);
  }
}

