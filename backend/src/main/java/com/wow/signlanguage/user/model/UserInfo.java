package com.wow.signlanguage.user.model;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class UserInfo {
    private int correctQuestionNum;
    private List<String> incorrectQuestions;
    private int userId;
    private int totalQuestionNum;
    private int userLevel;
    private List<String> totalQuestions;
    private Map<String, Integer> dailySolvedCounts;

    // 추가 필드: 회원가입 시 입력받는 정보
    private String name;
    private String email;
    private String phoneNumber;
    private String organization; // 학교/직장
    private boolean isRegistered; // 회원가입 완료 여부
    private String profileImageUrl; // 프로필 이미지 URL (base64 또는 URL)

    public UserInfo() {
        this.incorrectQuestions = new ArrayList<>();
        this.totalQuestions = new ArrayList<>();
        this.dailySolvedCounts = new HashMap<>();
        this.isRegistered = false;
    }

    public UserInfo(int userId, int correctQuestionNum, int totalQuestionNum, int userLevel) {
        this.userId = userId;
        this.correctQuestionNum = correctQuestionNum;
        this.totalQuestionNum = totalQuestionNum;
        this.userLevel = userLevel;
        this.incorrectQuestions = new ArrayList<>();
        this.totalQuestions = new ArrayList<>();
        this.dailySolvedCounts = new HashMap<>();
        this.isRegistered = false;
    }

    public int getCorrectQuestionNum() {
        return correctQuestionNum;
    }

    public void setCorrectQuestionNum(int correctQuestionNum) {
        this.correctQuestionNum = correctQuestionNum;
    }

    public List<String> getIncorrectQuestions() {
        return incorrectQuestions;
    }

    public void setIncorrectQuestions(List<String> incorrectQuestions) {
        this.incorrectQuestions = incorrectQuestions;
    }

    public int getUserId() {
        return userId;
    }

    public void setUserId(int userId) {
        this.userId = userId;
    }

    public int getTotalQuestionNum() {
        return totalQuestionNum;
    }

    public void setTotalQuestionNum(int totalQuestionNum) {
        this.totalQuestionNum = totalQuestionNum;
    }

    public int getUserLevel() {
        return userLevel;
    }

    public void setUserLevel(int userLevel) {
        this.userLevel = userLevel;
    }

    public List<String> getTotalQuestions() {
        return totalQuestions;
    }

    public void setTotalQuestions(List<String> totalQuestions) {
        this.totalQuestions = totalQuestions;
    }

    public Map<String, Integer> getDailySolvedCounts() {
        return dailySolvedCounts;
    }

    public void setDailySolvedCounts(Map<String, Integer> dailySolvedCounts) {
        this.dailySolvedCounts = dailySolvedCounts;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPhoneNumber() {
        return phoneNumber;
    }

    public void setPhoneNumber(String phoneNumber) {
        this.phoneNumber = phoneNumber;
    }

    public String getOrganization() {
        return organization;
    }

    public void setOrganization(String organization) {
        this.organization = organization;
    }

    public boolean isRegistered() {
        return isRegistered;
    }

    public void setRegistered(boolean registered) {
        isRegistered = registered;
    }

    public String getProfileImageUrl() {
        return profileImageUrl;
    }

    public void setProfileImageUrl(String profileImageUrl) {
        this.profileImageUrl = profileImageUrl;
    }
}
