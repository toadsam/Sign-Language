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
import com.wow.signlanguage.user.dto.DailySolvedCountPointResponse;
import com.wow.signlanguage.user.dto.DailySolvedTrendResponse;
import com.wow.signlanguage.user.dto.TopWrongWordResponse;
import com.wow.signlanguage.user.dto.TranslatorBookmarkResponse;
import com.wow.signlanguage.user.dto.WrongNoteResponse;
import com.wow.signlanguage.user.dto.WrongNoteSavedResponse;
import com.wow.signlanguage.user.model.UserInfo;
import com.wow.signlanguage.storage.StorageVideoCache;
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
import java.util.Comparator;
import java.util.UUID;
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

    private final StorageVideoCache storageVideoCache;

    public UserService(StorageVideoCache storageVideoCache) {
        this.storageVideoCache = storageVideoCache;
    }

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
                userData.put("incorrectQuestionCounts", newUser.getIncorrectQuestionCounts());
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
        updateData.put("incorrectQuestionCounts", userInfo.getIncorrectQuestionCounts());

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
        Map<String, Integer> incorrectQuestionCounts = toStringIntegerMap(document.get("incorrectQuestionCounts"));
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
            int wrongCount = incorrectQuestionCounts.getOrDefault(questionId, 0) + 1;
            incorrectQuestionCounts.put(questionId, wrongCount);
            updateData.put("incorrectQuestionCounts", incorrectQuestionCounts);
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
        String correctChoiceId = normalizeChoiceId(quizDoc.getString("correctChoiceId"));
        String word = resolveCorrectChoiceText(quizDoc.get("choices"), correctChoiceId);
        String videoUrl = resolveQuizVideoUrl(questionText, word, quizDoc.getString("videoUrl"));

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
            String correctChoiceId = normalizeChoiceId(quizDoc.getString("correctChoiceId"));
            String word = resolveCorrectChoiceText(quizDoc.get("choices"), correctChoiceId);
            String videoUrl = resolveQuizVideoUrl(questionText, word, quizDoc.getString("videoUrl"));
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

        DocumentSnapshot quizDoc = db.collection(QUIZ_COLLECTION_NAME).document(quizId).get().get();
        if (!quizDoc.exists()) {
            throw new RuntimeException("Quiz not found");
        }

        Map<String, Object> incorrectQuestionDates = toStringObjectMap(userDoc.get("incorrectQuestionDates"));
        Object wrongAt = incorrectQuestionDates.getOrDefault(quizId, new Date());

        String questionText = safeString(quizDoc.getString("questionText"));
        String correctChoiceId = normalizeChoiceId(quizDoc.getString("correctChoiceId"));
        String word = resolveCorrectChoiceText(quizDoc.get("choices"), correctChoiceId);
        String videoUrl = resolveQuizVideoUrl(questionText, word, quizDoc.getString("videoUrl"));

        Map<String, Object> data = new HashMap<>();
        data.put("quizId", quizId);
        data.put("questionText", questionText);
        data.put("word", word);
        data.put("videoUrl", videoUrl);
        data.put("wrongAt", wrongAt);
        data.put("savedAt", FieldValue.serverTimestamp());
        data.put("isHidden", false);
        data.put("hiddenAt", null);

        DocumentReference savedRef = userRef.collection(WRONG_NOTE_SAVED_COLLECTION_NAME).document(quizId);
        savedRef.set(data).get();

        DocumentSnapshot savedDoc = savedRef.get().get();
        return toWrongNoteSavedResponse(savedDoc);
    }

    public TranslatorBookmarkResponse saveTranslatorBookmark(
            String uid,
            String sentence,
            String word,
            String videoUrl
    ) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank()) {
            throw new IllegalArgumentException("uid is required");
        }
        if (sentence == null || sentence.isBlank()) {
            throw new IllegalArgumentException("sentence is required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentReference userRef = db.collection(COLLECTION_NAME).document(uid);
        DocumentSnapshot userDoc = userRef.get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        String bookmarkId = "txt_" + UUID.randomUUID();
        Map<String, Object> data = new HashMap<>();
        data.put("quizId", bookmarkId);
        data.put("questionText", safeString(sentence));
        data.put("word", resolveBookmarkWord(word, sentence));
        data.put("videoUrl", safeString(videoUrl));
        data.put("source", "translator");
        data.put("savedAt", FieldValue.serverTimestamp());

        DocumentReference bookmarkRef = userRef
                .collection(TRANSLATOR_BOOKMARKS_COLLECTION_NAME)
                .document(bookmarkId);
        bookmarkRef.set(data).get();

        DocumentSnapshot savedDoc = bookmarkRef.get().get();
        return toTranslatorBookmarkResponse(savedDoc);
    }

    public List<TranslatorBookmarkResponse> getTranslatorBookmarks(String uid) throws ExecutionException, InterruptedException {
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

        List<TranslatorBookmarkResponse> result = new ArrayList<>();
        for (QueryDocumentSnapshot doc : snapshot.getDocuments()) {
            String source = safeString(doc.getString("source"));
            String questionText = safeString(doc.getString("questionText"));

            // translator 전용 북마크만 반환
            // - 신규 데이터: source == "translator"
            // - 이전 데이터 호환: questionText가 존재하면 translator 문장 북마크로 간주
            if (!"translator".equals(source) && questionText.isBlank()) {
                continue;
            }
            result.add(toTranslatorBookmarkResponse(doc));
        }
        return result;
    }

    public void deleteTranslatorBookmark(String uid, String bookmarkId) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank() || bookmarkId == null || bookmarkId.isBlank()) {
            throw new IllegalArgumentException("uid and bookmarkId are required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentSnapshot userDoc = db.collection(COLLECTION_NAME).document(uid).get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        DocumentReference bookmarkRef = db.collection(COLLECTION_NAME)
                .document(uid)
                .collection(TRANSLATOR_BOOKMARKS_COLLECTION_NAME)
                .document(bookmarkId);

        DocumentSnapshot bookmarkDoc = bookmarkRef.get().get();
        if (!bookmarkDoc.exists()) {
            return;
        }

        String source = safeString(bookmarkDoc.getString("source"));
        String questionText = safeString(bookmarkDoc.getString("questionText"));
        if (!"translator".equals(source) && questionText.isBlank()) {
            throw new IllegalArgumentException("not a translator bookmark");
        }

        bookmarkRef.delete().get();
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
            if (isDocumentHidden(doc)) {
                continue;
            }
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

        DocumentReference wrongNoteRef = db.collection(COLLECTION_NAME)
                .document(uid)
                .collection(WRONG_NOTE_SAVED_COLLECTION_NAME)
                .document(quizId);

        DocumentSnapshot wrongNoteDoc = wrongNoteRef.get().get();
        if (!wrongNoteDoc.exists()) {
            return;
        }

        Map<String, Object> hideData = new HashMap<>();
        hideData.put("isHidden", true);
        hideData.put("hiddenAt", FieldValue.serverTimestamp());
        wrongNoteRef.update(hideData).get();
    }

    public DailySolvedTrendResponse getRecentDailySolvedCounts(String uid) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank()) {
            throw new IllegalArgumentException("uid is required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentSnapshot userDoc = db.collection(COLLECTION_NAME).document(uid).get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        Map<String, Integer> dailySolvedCounts = toStringIntegerMap(userDoc.get("dailySolvedCounts"));
        LocalDate todayKst = LocalDate.now(ZoneId.of("Asia/Seoul"));
        List<DailySolvedCountPointResponse> trend = new ArrayList<>();

        for (int dayOffset = 6; dayOffset >= 0; dayOffset--) {
            LocalDate date = todayKst.minusDays(dayOffset);
            String dateKey = date.toString();
            int solvedCount = dailySolvedCounts.getOrDefault(dateKey, 0);
            trend.add(new DailySolvedCountPointResponse(dateKey, solvedCount));
        }

        return new DailySolvedTrendResponse(uid, trend);
    }

    public List<TopWrongWordResponse> getTopWrongWords(String uid, int limit) throws ExecutionException, InterruptedException {
        if (uid == null || uid.isBlank()) {
            throw new IllegalArgumentException("uid is required");
        }

        Firestore db = FirestoreClient.getFirestore();
        DocumentSnapshot userDoc = db.collection(COLLECTION_NAME).document(uid).get().get();
        if (!userDoc.exists()) {
            throw new RuntimeException("User not found");
        }

        Map<String, Integer> incorrectQuestionCounts = toStringIntegerMap(userDoc.get("incorrectQuestionCounts"));
        if (incorrectQuestionCounts.isEmpty()) {
            for (String quizId : toStringList(userDoc.get("incorrectQuestions"))) {
                incorrectQuestionCounts.putIfAbsent(quizId, 1);
            }
        }

        List<Map.Entry<String, Integer>> sortedEntries = new ArrayList<>(incorrectQuestionCounts.entrySet());
        sortedEntries.sort(
                Comparator.comparingInt((Map.Entry<String, Integer> entry) -> entry.getValue()).reversed()
                        .thenComparing(Map.Entry::getKey));

        List<TopWrongWordResponse> result = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : sortedEntries) {
            if (result.size() >= limit) {
                break;
            }
            String quizId = entry.getKey();
            int wrongCount = entry.getValue();

            DocumentSnapshot quizDoc = db.collection(QUIZ_COLLECTION_NAME).document(quizId).get().get();
            if (!quizDoc.exists()) {
                continue;
            }

            String correctChoiceId = normalizeChoiceId(quizDoc.getString("correctChoiceId"));
            String word = resolveCorrectChoiceText(quizDoc.get("choices"), correctChoiceId);
            result.add(new TopWrongWordResponse(quizId, word, wrongCount));
        }

        return result;
    }

    private BookmarkResponse toBookmarkResponse(DocumentSnapshot doc) {
        String word = safeString(doc.getString("word"));
        return new BookmarkResponse(
                doc.getId(),
                safeString(doc.getString("questionText")),
                word,
                storageVideoCache.findUrlOrFallback(word, doc.getString("videoUrl")),
                doc.get("savedAt"));
    }

    private WrongNoteSavedResponse toWrongNoteSavedResponse(DocumentSnapshot doc) {
        String word = safeString(doc.getString("word"));
        return new WrongNoteSavedResponse(
                doc.getId(),
                safeString(doc.getString("questionText")),
                word,
                storageVideoCache.findUrlOrFallback(word, doc.getString("videoUrl")),
                doc.get("wrongAt"),
                doc.get("savedAt"));
    }

    private TranslatorBookmarkResponse toTranslatorBookmarkResponse(DocumentSnapshot doc) {
        String word = safeString(doc.getString("word"));
        return new TranslatorBookmarkResponse(
                doc.getId(),
                safeString(doc.getString("questionText")),
                word,
                storageVideoCache.findUrlOrFallback(word, doc.getString("videoUrl")),
                doc.get("savedAt"));
    }

    private boolean isDocumentHidden(DocumentSnapshot doc) {
        Object hidden = doc.get("isHidden");
        return hidden instanceof Boolean && (Boolean) hidden;
    }

    private String safeString(String value) {
        return value == null ? "" : value;
    }

    private String resolveQuizVideoUrl(String questionText, String word, String fallbackUrl) {
        String videoUrl = storageVideoCache.findUrl(questionText);
        if (videoUrl != null && !videoUrl.isBlank()) {
            return videoUrl;
        }
        return storageVideoCache.findUrlOrFallback(word, fallbackUrl);
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

    private String resolveBookmarkWord(String word, String sentence) {
        String safeWord = safeString(word).trim();
        if (!safeWord.isBlank()) {
            return safeWord;
        }

        String safeSentence = safeString(sentence).trim();
        if (safeSentence.isBlank()) {
            return "";
        }

        String[] tokens = safeSentence.split("\\s+");
        return tokens.length > 0 ? tokens[0] : "";
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


    // 구글 ID로 유저 존재 여부 확인
    public boolean existsByGoogleId(String googleId) {
        try {
            Firestore db = FirestoreClient.getFirestore();
            DocumentReference docRef = db.collection(COLLECTION_NAME).document(googleId);
            DocumentSnapshot document = docRef.get().get();
            return document.exists();
        } catch (Exception e) {
            System.out.println("existsByGoogleId 에러: " + e.getMessage());
            return false;
        }
    }

    // 새 유저 생성 (회원가입 미완료 상태)
    public UserInfo createUser(String googleId, String email) {
        try {
            Firestore db = FirestoreClient.getFirestore();
            DocumentReference docRef = db.collection(COLLECTION_NAME).document(googleId);

            // 새로운 userId 생성
            int newUserId = getNextUserId(db);

            // 기본 UserInfo 생성 (회원가입 미완료 상태)
            UserInfo newUser = new UserInfo(newUserId, 0, 0, 1);
            newUser.setEmail(email);
            newUser.setRegistered(false); // 아직 추가 정보 입력 안함

            Map<String, Object> userData = new HashMap<>();
            userData.put("userId", newUser.getUserId());
            userData.put("correctQuestionNum", newUser.getCorrectQuestionNum());
            userData.put("incorrectQuestions", newUser.getIncorrectQuestions());
            userData.put("totalQuestionNum", newUser.getTotalQuestionNum());
            userData.put("userLevel", newUser.getUserLevel());
            userData.put("totalQuestions", newUser.getTotalQuestions());
            userData.put("dailySolvedCounts", newUser.getDailySolvedCounts());
            userData.put("incorrectQuestionCounts", newUser.getIncorrectQuestionCounts());
            userData.put("email", newUser.getEmail());
            userData.put("isRegistered", newUser.isRegistered());

            docRef.set(userData).get();
            return newUser;
        } catch (Exception e) {
            System.out.println("createUser 에러: " + e.getMessage());
            e.printStackTrace();
            throw new RuntimeException("Failed to create user", e);
        }
    }

    // 구글 ID로 유저 정보 조회
    public UserInfo getUserByGoogleId(String googleId) {
        try {
            Firestore db = FirestoreClient.getFirestore();
            DocumentReference docRef = db.collection(COLLECTION_NAME).document(googleId);
            DocumentSnapshot document = docRef.get().get();

            if (document.exists()) {
                UserInfo userInfo = document.toObject(UserInfo.class);

                // isRegistered 필드가 Firestore에 없는 경우 false로 설정
                Boolean isRegisteredField = document.getBoolean("isRegistered");
                if (isRegisteredField == null) {
                    System.out.println("getUserByGoogleId - isRegistered 필드 없음, false로 설정");
                    userInfo.setRegistered(false);
                } else {
                    userInfo.setRegistered(isRegisteredField);
                }

                System.out.println("getUserByGoogleId - googleId: " + googleId);
                System.out.println("getUserByGoogleId - isRegistered 필드값: " + isRegisteredField);
                System.out.println("getUserByGoogleId - UserInfo.isRegistered(): " + userInfo.isRegistered());

                return userInfo;
            }
            return null;
        } catch (Exception e) {
            System.out.println("getUserByGoogleId 에러: " + e.getMessage());
            e.printStackTrace();
            throw new RuntimeException("Failed to get user", e);
        }
    }

    // 회원가입 완료 (추가 정보 입력)
    public UserInfo completeUserRegistration(String googleId, String name, String phoneNumber, String organization) {
        try {
            Firestore db = FirestoreClient.getFirestore();
            DocumentReference docRef = db.collection(COLLECTION_NAME).document(googleId);
            DocumentSnapshot document = docRef.get().get();

            if (!document.exists()) {
                throw new RuntimeException("User not found");
            }

            Map<String, Object> updates = new HashMap<>();
            updates.put("name", name);
            updates.put("phoneNumber", phoneNumber);
            updates.put("organization", organization);
            updates.put("isRegistered", true);

            docRef.update(updates).get();

            DocumentSnapshot updatedDoc = docRef.get().get();
            return updatedDoc.toObject(UserInfo.class);
        } catch (Exception e) {
            System.out.println("completeUserRegistration 에러: " + e.getMessage());
            throw new RuntimeException("Failed to complete registration", e);
        }
    }

    // 프로필 이미지 업데이트
    public UserInfo updateProfileImage(String uid, String profileImageUrl) throws ExecutionException, InterruptedException {
        Firestore db = FirestoreClient.getFirestore();
        DocumentReference docRef = db.collection(COLLECTION_NAME).document(uid);
        DocumentSnapshot document = docRef.get().get();

        if (!document.exists()) {
            throw new RuntimeException("User not found");
        }

        Map<String, Object> updates = new HashMap<>();
        updates.put("profileImageUrl", profileImageUrl);

        docRef.update(updates).get();

        DocumentSnapshot updatedDoc = docRef.get().get();
        return updatedDoc.toObject(UserInfo.class);
    }
}
