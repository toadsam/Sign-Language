import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { AuthUser, loginWithGoogleToken } from '@/lib/api/auth';

const ACCESS_TOKEN_KEY = 'auth.accessToken';
const USER_KEY = 'auth.user';
const GUEST_MODE_KEY = 'auth.isGuest';

const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }

    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Ignore storage errors so auth state can still update in memory.
      }
      return;
    }

    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Ignore storage errors so auth state can still update in memory.
    }
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage errors so auth state can still update in memory.
      }
      return;
    }

    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Ignore storage errors so auth state can still update in memory.
    }
  },
};

type AuthContextValue = {
  isLoading: boolean;
  accessToken: string | null;
  user: AuthUser | null;
  isGuest: boolean;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signInWithBackendUser: (accessToken: string, user: AuthUser) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (userData: Partial<AuthUser>) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      const [storedToken, storedUser, storedGuest] = await Promise.all([
        storage.get(ACCESS_TOKEN_KEY),
        storage.get(USER_KEY),
        storage.get(GUEST_MODE_KEY),
      ]);
      setAccessToken(storedToken);
      setUser(storedUser ? (JSON.parse(storedUser) as AuthUser) : null);
      setIsGuest(!storedToken && storedGuest === 'true');
      setIsLoading(false);
    };

    void bootstrap();
  }, []);

  const signInWithGoogleIdToken = async (idToken: string) => {
    const payload = await loginWithGoogleToken(idToken);

    // idToken에서 googleId(sub) 추출
    const tokenPayload = JSON.parse(atob(idToken.split('.')[1]));
    const googleId = tokenPayload.sub;

    // user 객체에 googleId 추가
    const userWithGoogleId = { ...payload.user, id: googleId };

    await Promise.all([
      storage.set(ACCESS_TOKEN_KEY, payload.accessToken),
      storage.set(USER_KEY, JSON.stringify(userWithGoogleId)),
      storage.remove(GUEST_MODE_KEY),
    ]);
    setAccessToken(payload.accessToken);
    setUser(userWithGoogleId);
    setIsGuest(false);
  };

  const signInWithBackendUser = async (token: string, backendUser: AuthUser) => {
    await Promise.all([
      storage.set(ACCESS_TOKEN_KEY, token),
      storage.set(USER_KEY, JSON.stringify(backendUser)),
      storage.remove(GUEST_MODE_KEY),
    ]);
    setAccessToken(token);
    setUser(backendUser);
    setIsGuest(false);
  };

  const continueAsGuest = async () => {
    // Update in-memory auth state first so route guards can react immediately.
    setAccessToken(null);
    setUser(null);
    setIsGuest(true);

    await Promise.all([
      storage.remove(ACCESS_TOKEN_KEY),
      storage.remove(USER_KEY),
      storage.set(GUEST_MODE_KEY, 'true'),
    ]);
  };

  const signOut = async () => {
    await Promise.all([
      storage.remove(ACCESS_TOKEN_KEY),
      storage.remove(USER_KEY),
      storage.remove(GUEST_MODE_KEY),
    ]);
    setAccessToken(null);
    setUser(null);
    setIsGuest(false);
  };

  const updateUser = useCallback(async (userData: Partial<AuthUser>) => {
    if (!user) {
      return;
    }
    const updatedUser = { ...user, ...userData };
    await storage.set(USER_KEY, JSON.stringify(updatedUser));
    setUser(updatedUser);
  }, [user]);

  const value = useMemo(
    () => ({
      isLoading,
      accessToken,
      user,
      isGuest,
      signInWithGoogleIdToken,
      signInWithBackendUser,
      continueAsGuest,
      signOut,
      updateUser,
    }),
    [isLoading, accessToken, user, isGuest, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
