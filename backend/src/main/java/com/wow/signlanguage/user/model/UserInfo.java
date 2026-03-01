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

    public UserInfo() {
        this.incorrectQuestions = new ArrayList<>();
        this.totalQuestions = new ArrayList<>();
        this.dailySolvedCounts = new HashMap<>();
    }

    public UserInfo(int userId, int correctQuestionNum, int totalQuestionNum, int userLevel) {
        this.userId = userId;
        this.correctQuestionNum = correctQuestionNum;
        this.totalQuestionNum = totalQuestionNum;
        this.userLevel = userLevel;
        this.incorrectQuestions = new ArrayList<>();
        this.totalQuestions = new ArrayList<>();
        this.dailySolvedCounts = new HashMap<>();
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
}
