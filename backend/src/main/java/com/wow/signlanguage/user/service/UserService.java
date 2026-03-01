package com.wow.signlanguage.user.service;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.jackson2.JacksonFactory;
import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.FieldValue;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.Query;
import com.google.cloud.firestore.QueryDocumentSnapshot;
import com.google.cloud.firestore.QuerySnapshot;
import com.google.cloud.firestore.WriteResult;
import com.google.firebase.cloud.FirestoreClient;
import com.wow.signlanguage.user.dto.BookmarkResponse;
import com.wow.signlanguage.user.dto.WrongNoteResponse;
import com.wow.signlanguage.user.dto.WrongNoteSavedResponse;
import com.wow.signlanguage.user.model.UserInfo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;

@Service
public class UserService {

    private static final String COLLECTION_NAME = "users";
    private static final String QUIZ_COLLECTION_NAME = "quiz_items";
    private static final String TRANSLATOR_BOOKMARKS_COLLECTION_NAME = "translator_bookmarks";
    private static final String WRONG_NOTE_SAVED_COLLECTION_NAME = "wrong_note_saved";
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
                userData.put("dailySolvedCounts", newUser.getDailySolvedCounts());
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
        updateData.put("dailySolvedCounts", userInfo.getDailySolvedCounts());

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
        Map<String, Object> incorrectQuestionDates = toStringObjectMap(document.get("incorrectQuestionDates"));
        Map<String, Integer> dailySolvedCounts = toStringIntegerMap(document.get("dailySolvedCounts"));
        int totalQuestionNum = user.getTotalQuestionNum();
        int correctQuestionNum = user.getCorrectQuestionNum();
        totalQuestionNum++;
        if (!totalQuestions.contains(questionId)) {
            totalQuestions.add(questionId);
        }

        String todayKst = LocalDate.now(ZoneId.of("Asia/Seoul")).toString();
        int solvedToday = dailySolvedCounts.getOrDefault(todayKst, 0) + 1;
        dailySolvedCounts.put(todayKst, solvedToday);

        Map<String, Object> updateData = new HashMap<>();
        updateData.put("totalQuestions", totalQuestions);
        updateData.put("totalQuestionNum", totalQuestionNum);
        updateData.put("dailySolvedCounts", dailySolvedCounts);

        if (!isCorrect) {
            if (!incorrectQuestions.contains(questionId)) {
                incorrectQuestions.add(questionId);
                updateData.put("incorrectQuestions", incorrectQuestions);
                incorrectQuestionDates.put(questionId, new Date());
                updateData.put("incorrectQuestionDates", incorrectQuestionDates);
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

    public BookmarkResponse saveBookmark(String uid, String quizId) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank() || quizId == null || quizId.isBlank()) {
            throw new IllegalArgumentException("uid and quizId are required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentReference userRef = db.collection(COLLECTION_NAME).document(uid);
        DocumentSnapshot userDoc = userRef.get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        DocumentSnapshot quizDoc = db.collection(QUIZ_COLLECTION_NAME).document(quizId).get().get();
        if (!quizDoc.exists()) {
            throw new RuntimeException("Quiz not found");
        }

        String questionText = safeString(quizDoc.getString("questionText"));
        String videoUrl = safeString(quizDoc.getString("videoUrl"));
        String correctChoiceId = normalizeChoiceId(quizDoc.getString("correctChoiceId"));
        String word = resolveCorrectChoiceText(quizDoc.get("choices"), correctChoiceId);

        Map<String, Object> bookmarkData = new HashMap<>();
        bookmarkData.put("quizId", quizId);
        bookmarkData.put("questionText", questionText);
        bookmarkData.put("word", word);
        bookmarkData.put("videoUrl", videoUrl);
        bookmarkData.put("savedAt", FieldValue.serverTimestamp());

        DocumentReference bookmarkRef = userRef.collection(TRANSLATOR_BOOKMARKS_COLLECTION_NAME).document(quizId);
        bookmarkRef.set(bookmarkData).get();

        DocumentSnapshot saved = bookmarkRef.get().get();
        return toBookmarkResponse(saved);
    }

    public List<BookmarkResponse> getBookmarks(String uid) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank()) {
            throw new IllegalArgumentException("uid is required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentSnapshot userDoc = db.collection(COLLECTION_NAME).document(uid).get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        QuerySnapshot snapshot = db.collection(COLLECTION_NAME)
                .document(uid)
                .collection(TRANSLATOR_BOOKMARKS_COLLECTION_NAME)
                .orderBy("savedAt", Query.Direction.DESCENDING)
                .get()
                .get();

        List<BookmarkResponse> result = new ArrayList<>();
        for (QueryDocumentSnapshot doc : snapshot.getDocuments()) {
            result.add(toBookmarkResponse(doc));
        }
        return result;
    }

    public void deleteBookmark(String uid, String quizId) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank() || quizId == null || quizId.isBlank()) {
            throw new IllegalArgumentException("uid and quizId are required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentSnapshot userDoc = db.collection(COLLECTION_NAME).document(uid).get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        db.collection(COLLECTION_NAME)
                .document(uid)
                .collection(TRANSLATOR_BOOKMARKS_COLLECTION_NAME)
                .document(quizId)
                .delete()
                .get();
    }

    public List<WrongNoteResponse> getWrongNotes(String uid) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank()) {
            throw new IllegalArgumentException("uid is required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentSnapshot userDoc = db.collection(COLLECTION_NAME).document(uid).get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        List<String> incorrectQuestions = toStringList(userDoc.get("incorrectQuestions"));
        Map<String, Object> incorrectQuestionDates = toStringObjectMap(userDoc.get("incorrectQuestionDates"));
        List<WrongNoteResponse> result = new ArrayList<>();
        for (String quizId : incorrectQuestions) {
            DocumentSnapshot quizDoc = db.collection(QUIZ_COLLECTION_NAME).document(quizId).get().get();
            if (!quizDoc.exists()) {
                continue;
            }
            String questionText = safeString(quizDoc.getString("questionText"));
            String videoUrl = safeString(quizDoc.getString("videoUrl"));
            String correctChoiceId = normalizeChoiceId(quizDoc.getString("correctChoiceId"));
            String word = resolveCorrectChoiceText(quizDoc.get("choices"), correctChoiceId);
            Object wrongAt = incorrectQuestionDates.get(quizId);
            result.add(new WrongNoteResponse(quizId, questionText, word, videoUrl, wrongAt));
        }
        return result;
    }

    public WrongNoteSavedResponse saveWrongNote(String uid, String quizId) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank() || quizId == null || quizId.isBlank()) {
            throw new IllegalArgumentException("uid and quizId are required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentReference userRef = db.collection(COLLECTION_NAME).document(uid);
        DocumentSnapshot userDoc = userRef.get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        List<String> incorrectQuestions = toStringList(userDoc.get("incorrectQuestions"));
        if (!incorrectQuestions.contains(quizId)) {
            throw new IllegalArgumentException("Only wrong questions can be saved.");
        }

        DocumentSnapshot quizDoc = db.collection(QUIZ_COLLECTION_NAME).document(quizId).get().get();
        if (!quizDoc.exists()) {
            throw new RuntimeException("Quiz not found");
        }

        Map<String, Object> incorrectQuestionDates = toStringObjectMap(userDoc.get("incorrectQuestionDates"));
        Object wrongAt = incorrectQuestionDates.get(quizId);

        String questionText = safeString(quizDoc.getString("questionText"));
        String videoUrl = safeString(quizDoc.getString("videoUrl"));
        String correctChoiceId = normalizeChoiceId(quizDoc.getString("correctChoiceId"));
        String word = resolveCorrectChoiceText(quizDoc.get("choices"), correctChoiceId);

        Map<String, Object> data = new HashMap<>();
        data.put("quizId", quizId);
        data.put("questionText", questionText);
        data.put("word", word);
        data.put("videoUrl", videoUrl);
        data.put("wrongAt", wrongAt);
        data.put("savedAt", FieldValue.serverTimestamp());

        DocumentReference savedRef = userRef.collection(WRONG_NOTE_SAVED_COLLECTION_NAME).document(quizId);
        savedRef.set(data).get();

        DocumentSnapshot savedDoc = savedRef.get().get();
        return toWrongNoteSavedResponse(savedDoc);
    }

    public List<WrongNoteSavedResponse> getSavedWrongNotes(String uid) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank()) {
            throw new IllegalArgumentException("uid is required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentSnapshot userDoc = db.collection(COLLECTION_NAME).document(uid).get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        QuerySnapshot snapshot = db.collection(COLLECTION_NAME)
                .document(uid)
                .collection(WRONG_NOTE_SAVED_COLLECTION_NAME)
                .orderBy("savedAt", Query.Direction.DESCENDING)
                .get()
                .get();

        List<WrongNoteSavedResponse> result = new ArrayList<>();
        for (QueryDocumentSnapshot doc : snapshot.getDocuments()) {
            result.add(toWrongNoteSavedResponse(doc));
        }
        return result;
    }

    public void deleteSavedWrongNote(String uid, String quizId) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank() || quizId == null || quizId.isBlank()) {
            throw new IllegalArgumentException("uid and quizId are required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentSnapshot userDoc = db.collection(COLLECTION_NAME).document(uid).get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        db.collection(COLLECTION_NAME)
                .document(uid)
                .collection(WRONG_NOTE_SAVED_COLLECTION_NAME)
                .document(quizId)
                .delete()
                .get();
    }

    private BookmarkResponse toBookmarkResponse(DocumentSnapshot doc) {
        return new BookmarkResponse(
                doc.getId(),
                safeString(doc.getString("questionText")),
                safeString(doc.getString("word")),
                safeString(doc.getString("videoUrl")),
                doc.get("savedAt"));
    }

    private WrongNoteSavedResponse toWrongNoteSavedResponse(DocumentSnapshot doc) {
        return new WrongNoteSavedResponse(
                doc.getId(),
                safeString(doc.getString("questionText")),
                safeString(doc.getString("word")),
                safeString(doc.getString("videoUrl")),
                doc.get("wrongAt"),
                doc.get("savedAt"));
    }

    private String safeString(String value) {
        return value == null ? "" : value;
    }

    private String normalizeChoiceId(String value) {
        return value == null ? "" : value.trim().toUpperCase();
    }

    private String resolveCorrectChoiceText(Object rawChoices, String correctChoiceId) {
        if (!(rawChoices instanceof List<?> choices)) {
            return "";
        }
        int index = switch (correctChoiceId) {
            case "A" -> 0;
            case "B" -> 1;
            case "C" -> 2;
            case "D" -> 3;
            default -> -1;
        };
        if (index < 0 || index >= choices.size()) {
            return "";
        }
        Object value = choices.get(index);
        return value instanceof String ? (String) value : "";
    }

    private List<String> toStringList(Object value) {
        if (!(value instanceof List<?> raw)) {
            return List.of();
        }
        List<String> result = new ArrayList<>();
        for (Object item : raw) {
            if (item instanceof String text && !text.isBlank()) {
                result.add(text);
            }
        }
        return result;
    }

    private Map<String, Object> toStringObjectMap(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return new HashMap<>();
        }
        Map<String, Object> result = new HashMap<>();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            if (entry.getKey() instanceof String key) {
                result.put(key, entry.getValue());
            }
        }
        return result;
    }

    private Map<String, Integer> toStringIntegerMap(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return new HashMap<>();
        }
        Map<String, Integer> result = new HashMap<>();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            if (!(entry.getKey() instanceof String key)) {
                continue;
            }
            Object rawValue = entry.getValue();
            if (rawValue instanceof Number number) {
                result.put(key, number.intValue());
            }
        }
        return result;
    }
}
