package com.wow.signlanguage.user.service;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.jackson2.JacksonFactory;
import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.WriteResult;
import com.google.firebase.cloud.FirestoreClient;
import com.wow.signlanguage.user.model.UserInfo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;

@Service
public class UserService {

    private static final String COLLECTION_NAME = "users";
    private static final String COUNTER_DOC = "userCounter";
    private static final String COUNTER_FIELD = "lastUserId";

    @Value("${google.client-id}")
    private String googleClientId;

    private int getNextUserId(Firestore db) throws ExecutionException, InterruptedException {
        DocumentReference counterRef = db.collection(COLLECTION_NAME).document(COUNTER_DOC);
        // Firestore 트랜잭션으로 안전하게 증가
        return db.runTransaction((com.google.cloud.firestore.Transaction transaction) -> {
            DocumentSnapshot snapshot = transaction.get(counterRef).get(); // ApiFuture<DocumentSnapshot> -> DocumentSnapshot
            Long lastUserId = snapshot.exists() ? snapshot.getLong(COUNTER_FIELD) : null;
            int nextUserId = (lastUserId != null) ? lastUserId.intValue() + 1 : 1;
            transaction.set(counterRef, Map.of(COUNTER_FIELD, nextUserId));
            return nextUserId;
        }).get();
    }

    public UserInfo createUserIfNotExists(String username) throws ExecutionException, InterruptedException {
        Firestore db = FirestoreClient.getFirestore();
        DocumentReference docRef = db.collection(COLLECTION_NAME).document(username);
        try {
            DocumentSnapshot document = docRef.get().get();
            if (!document.exists()) {
                int newUserId = getNextUserId(db); // userId를 트랜잭션으로 생성
                UserInfo newUser = new UserInfo(newUserId, 0, 0, 1);
                Map<String, Object> userData = new HashMap<>();
                userData.put("correctQuestionNum", newUser.getCorrectQuestionNum());
                userData.put("incorrectQuestions", newUser.getIncorrectQuestions());
                userData.put("userId", newUser.getUserId());
                userData.put("totalQuestionNum", newUser.getTotalQuestionNum());
                userData.put("userLevel", newUser.getUserLevel());
                userData.put("totalQuestions", newUser.getTotalQuestions());
                docRef.set(userData).get();
                return newUser;
            } else {
                return document.toObject(UserInfo.class);
            }
        } catch (Exception e) {
            System.out.println("Firestore 저장 중 에러 발생: " + e.getMessage());
            e.printStackTrace();
            throw e;
        }
    }

    public UserInfo getUserInfo(String username) throws ExecutionException, InterruptedException {
        Firestore db = FirestoreClient.getFirestore();
        DocumentReference docRef = db.collection(COLLECTION_NAME).document(username);
        DocumentSnapshot document = docRef.get().get();

        if (document.exists()) {
            return document.toObject(UserInfo.class);
        }
        return null;
    }

    public UserInfo updateUser(String uid, UserInfo userInfo) throws ExecutionException, InterruptedException {
        Firestore db = FirestoreClient.getFirestore();
        DocumentReference docRef = db.collection(COLLECTION_NAME).document(uid);

        ApiFuture<DocumentSnapshot> future = docRef.get();
        DocumentSnapshot document = future.get();
        if (!document.exists()) {
            throw new RuntimeException("User with UID '" + uid + "' not found");
        }

        Map<String, Object> updateData = new HashMap<>();
        updateData.put("correctQuestionNum", userInfo.getCorrectQuestionNum());
        updateData.put("incorrectQuestions", userInfo.getIncorrectQuestions());
        updateData.put("userId", userInfo.getUserId());
        updateData.put("totalQuestionNum", userInfo.getTotalQuestionNum());
        updateData.put("userLevel", userInfo.getUserLevel());

        ApiFuture<WriteResult> updateFuture = docRef.update(updateData);
        updateFuture.get();

        return userInfo;
    }

    public UserInfo updateUserPartial(String uid, Map<String, Object> updates) throws ExecutionException, InterruptedException {
        Firestore db = FirestoreClient.getFirestore();
        DocumentReference docRef = db.collection(COLLECTION_NAME).document(uid);

        ApiFuture<DocumentSnapshot> future = docRef.get();
        DocumentSnapshot document = future.get();
        if (!document.exists()) {
            throw new RuntimeException("User with UID '" + uid + "' not found");
        }

        Map<String, Object> updateData = new HashMap<>();
        UserInfo currentUser = document.toObject(UserInfo.class);

        for (Map.Entry<String, Object> entry : updates.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if ("incorrectQuestions".equals(key) && value instanceof Map) {
                Map<?, ?> valueMap = (Map<?, ?>) value;
                if (valueMap.containsKey("append")) {
                    Object appendObj = valueMap.get("append");
                    java.util.List<String> currentList = currentUser != null && currentUser.getIncorrectQuestions() != null
                            ? new java.util.ArrayList<>(currentUser.getIncorrectQuestions())
                            : new java.util.ArrayList<>();
                    if (appendObj instanceof String) {
                        currentList.add((String) appendObj);
                    } else if (appendObj instanceof java.util.List) {
                        for (Object o : (java.util.List<?>) appendObj) {
                            if (o instanceof String) currentList.add((String) o);
                        }
                    }
                    updateData.put(key, currentList);
                    continue;
                }
            }
            if ("totalQuestions".equals(key) && value instanceof Map) {
                Map<?, ?> valueMap = (Map<?, ?>) value;
                if (valueMap.containsKey("append")) {
                    Object appendObj = valueMap.get("append");
                    java.util.List<String> currentList = currentUser != null && currentUser.getTotalQuestions() != null
                            ? new java.util.ArrayList<>(currentUser.getTotalQuestions())
                            : new java.util.ArrayList<>();
                    if (appendObj instanceof String) {
                        currentList.add((String) appendObj);
                    } else if (appendObj instanceof java.util.List) {
                        for (Object o : (java.util.List<?>) appendObj) {
                            if (o instanceof String) currentList.add((String) o);
                        }
                    }
                    updateData.put(key, currentList);
                    continue;
                }
            }
            if (value instanceof Map) {
                Map<?, ?> valueMap = (Map<?, ?>) value;
                if (valueMap.containsKey("increment") && valueMap.get("increment") instanceof Number) {
                    Number inc = (Number) valueMap.get("increment");
                    if ("totalQuestionNum".equals(key)) {
                        updateData.put(key, currentUser.getTotalQuestionNum() + inc.intValue());
                    } else if ("correctQuestionNum".equals(key)) {
                        updateData.put(key, currentUser.getCorrectQuestionNum() + inc.intValue());
                    } else if ("userLevel".equals(key)) {
                        updateData.put(key, currentUser.getUserLevel() + inc.intValue());
                    } else if ("userId".equals(key)) {
                        updateData.put(key, currentUser.getUserId() + inc.intValue());
                    }
                } else {
                }
            } else {
                updateData.put(key, value);
            }
        }

        ApiFuture<WriteResult> updateFuture = docRef.update(updateData);
        updateFuture.get();

        DocumentSnapshot updatedDoc = docRef.get().get();
        return updatedDoc.toObject(UserInfo.class);
    }

    public UserInfo tryQuestion(String uid, String questionId, boolean isCorrect) throws ExecutionException, InterruptedException {
        Firestore db = FirestoreClient.getFirestore();
        DocumentReference docRef = db.collection(COLLECTION_NAME).document(uid);
        DocumentSnapshot document = docRef.get().get();
        if (!document.exists()) {
            throw new RuntimeException("User not found");
        }
        UserInfo user = document.toObject(UserInfo.class);

        List<String> totalQuestions = user.getTotalQuestions() != null ? new ArrayList<>(user.getTotalQuestions()) : new ArrayList<>();
        List<String> incorrectQuestions = user.getIncorrectQuestions() != null ? new ArrayList<>(user.getIncorrectQuestions()) : new ArrayList<>();
        int totalQuestionNum = user.getTotalQuestionNum();
        int correctQuestionNum = user.getCorrectQuestionNum();

        if (totalQuestions.contains(questionId)) {
            return user;
        }

        totalQuestions.add(questionId);
        totalQuestionNum++;

        Map<String, Object> updateData = new HashMap<>();
        updateData.put("totalQuestions", totalQuestions);
        updateData.put("totalQuestionNum", totalQuestionNum);

        if (!isCorrect) {
            if (!incorrectQuestions.contains(questionId)) {
                incorrectQuestions.add(questionId);
                updateData.put("incorrectQuestions", incorrectQuestions);
            }
        } else {
            correctQuestionNum++;
            updateData.put("correctQuestionNum", correctQuestionNum);
        }

        docRef.update(updateData).get();
        DocumentSnapshot updatedDoc = docRef.get().get();
        return updatedDoc.toObject(UserInfo.class);
    }

    public UserInfo createUserWithGoogleIdToken(String idTokenString) throws Exception {
        GoogleIdTokenVerifier verifier = new GoogleIdTokenVerifier.Builder(new NetHttpTransport(), new JacksonFactory())
                .setAudience(Collections.singletonList(googleClientId)) // 환경변수에서 읽은 실제 클라이언트 ID 사용
                .build();
        GoogleIdToken idToken = verifier.verify(idTokenString);
        if (idToken == null) {
            System.out.println("idToken 검증 실패: Invalid idToken");
            throw new IllegalArgumentException("Invalid idToken");
        }
        GoogleIdToken.Payload payload = idToken.getPayload();
        String googleUserId = payload.getSubject(); // 구글 고유 ID
        System.out.println("구글 로그인 성공, googleUserId: " + googleUserId);
        return createUserIfNotExists(googleUserId);
    }
}