package com.wow.signlanguage.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageOptions;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.cloud.FirestoreClient;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FirebaseConfig {

  @Value("${firebase.project-id:}")
  private String firebaseProjectId;

  @Value("${firebase.service-account-path}")
  private String firestoreServiceAccountPath;

  @Value("${firebase.service-account-key-json:}")
  private String firestoreServiceAccountKeyJson;

  /**
   * Storage 서비스 계정 키 — 로컬 개발 시 파일 경로.
   * Cloud Run 배포 시에는 비워두고 storage-key-json 을 사용.
   */
  @Value("${firebase.storage-service-account-path:}")
  private String storageServiceAccountPath;

  /**
   * Storage 서비스 계정 키 JSON 내용 그 자체.
   * Secret Manager 값을 Cloud Run 환경변수로 주입할 때 사용.
   * 로컬에서는 비워둬도 됨.
   */
  @Value("${firebase.storage-key-json:}")
  private String storageKeyJson;

  @Value("${firebase.storage-bucket}")
  private String storageBucket;

  /** Firestore 전용 FirebaseApp (signhand-2641 프로젝트) */
  @Bean
  public FirebaseApp firebaseApp() throws IOException {
    if (!FirebaseApp.getApps().isEmpty()) {
      return FirebaseApp.getInstance();
    }

    FirebaseOptions.Builder optionsBuilder =
        FirebaseOptions.builder()
            .setCredentials(resolveFirestoreCredentials());

    if (firebaseProjectId != null && !firebaseProjectId.isBlank()) {
      optionsBuilder.setProjectId(firebaseProjectId);
    }

    return FirebaseApp.initializeApp(optionsBuilder.build());
  }

  /** Firestore 빈 */
  @Bean
  public Firestore firestore(FirebaseApp firebaseApp) {
    return FirestoreClient.getFirestore(firebaseApp);
  }

  /**
   * Google Cloud Storage 빈 (signhand-data-311b7 프로젝트).
   *
   * 우선순위:
   *   1. FIREBASE_STORAGE_KEY_JSON (JSON 내용 직접) — Cloud Run + Secret Manager
   *   2. FIREBASE_STORAGE_SERVICE_ACCOUNT_PATH (파일 경로) — 로컬 개발
   */
  @Bean
  public Storage googleCloudStorage() throws IOException {
    try (InputStream credentialStream = resolveStorageCredentialStream()) {
      GoogleCredentials credentials = GoogleCredentials.fromStream(credentialStream)
          .createScoped("https://www.googleapis.com/auth/cloud-platform");
      return StorageOptions.newBuilder()
          .setCredentials(credentials)
          .build()
          .getService();
    }
  }

  private InputStream resolveStorageCredentialStream() throws IOException {
    // 1순위: JSON 내용이 환경변수로 직접 주입된 경우 (Cloud Run + Secret Manager)
    if (storageKeyJson != null && !storageKeyJson.isBlank()) {
      return new ByteArrayInputStream(storageKeyJson.getBytes(StandardCharsets.UTF_8));
    }
    // 2순위: 로컬 파일 경로
    if (storageServiceAccountPath != null && !storageServiceAccountPath.isBlank()) {
      return new FileInputStream(storageServiceAccountPath);
    }
    throw new IllegalStateException(
        "Firebase Storage 인증 정보가 없습니다. " +
        "FIREBASE_STORAGE_KEY_JSON 또는 FIREBASE_STORAGE_SERVICE_ACCOUNT_PATH 를 설정하세요.");
  }

  private GoogleCredentials resolveFirestoreCredentials() throws IOException {
    if (firestoreServiceAccountKeyJson != null && !firestoreServiceAccountKeyJson.isBlank()) {
      try (InputStream serviceAccount =
          new ByteArrayInputStream(firestoreServiceAccountKeyJson.getBytes(StandardCharsets.UTF_8))) {
        return GoogleCredentials.fromStream(serviceAccount);
      }
    }

    if (firestoreServiceAccountPath != null && !firestoreServiceAccountPath.isBlank()) {
      try (InputStream serviceAccount = new FileInputStream(firestoreServiceAccountPath)) {
        return GoogleCredentials.fromStream(serviceAccount);
      }
    }

    return GoogleCredentials.getApplicationDefault();
  }
}
