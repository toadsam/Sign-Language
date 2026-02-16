import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { AuthUser, loginWithGoogleToken } from '@/lib/api/auth';

const ACCESS_TOKEN_KEY = 'auth.accessToken';
const USER_KEY = 'auth.user';

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
      try {
        const [storedToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        setAccessToken(storedToken);
        setUser(storedUser ? (JSON.parse(storedUser) as AuthUser) : null);
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();
  }, []);

  const signInWithGoogleIdToken = async (idToken: string) => {
    const payload = await loginWithGoogleToken(idToken);
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, payload.accessToken),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(payload.user)),
    ]);
    setAccessToken(payload.accessToken);
    setUser(payload.user);
  };

  const signOut = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
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
