package com.wow.signlanguage.auth.dto;

public class IdTokenRequest {
    private String idToken;

    public IdTokenRequest() {
    }

    public IdTokenRequest(String idToken) {
        this.idToken = idToken;
    }

    public String getIdToken() {
        return idToken;
    }

    public void setIdToken(String idToken) {
        this.idToken = idToken;
    }
}

