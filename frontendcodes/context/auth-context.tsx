import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { AuthUser, loginWithGoogleToken } from '@/lib/api/auth';

const ACCESS_TOKEN_KEY = 'auth.accessToken';
const USER_KEY = 'auth.user';

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
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      const [storedToken, storedUser] = await Promise.all([
        storage.get(ACCESS_TOKEN_KEY),
        storage.get(USER_KEY),
      ]);
      setAccessToken(storedToken);
      setUser(storedUser ? (JSON.parse(storedUser) as AuthUser) : null);
      setIsLoading(false);
    };

    void bootstrap();
  }, []);

  const signInWithGoogleIdToken = async (idToken: string) => {
    const payload = await loginWithGoogleToken(idToken);
    await Promise.all([
      storage.set(ACCESS_TOKEN_KEY, payload.accessToken),
      storage.set(USER_KEY, JSON.stringify(payload.user)),
    ]);
    setAccessToken(payload.accessToken);
    setUser(payload.user);
  };

  const signOut = async () => {
    await Promise.all([
      storage.remove(ACCESS_TOKEN_KEY),
      storage.remove(USER_KEY),
    ]);
    setAccessToken(null);
    setUser(null);
  };

  const value = useMemo(
    () => ({
      isLoading,
      accessToken,
      user,
      signInWithGoogleIdToken,
      signOut,
    }),
    [isLoading, accessToken, user]
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
