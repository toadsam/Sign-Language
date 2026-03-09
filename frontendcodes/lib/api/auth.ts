export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture?: string;
};

export type GoogleAuthApiResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresInSeconds: number;
  user: AuthUser;
};

export async function loginWithGoogleToken(idToken: string): Promise<GoogleAuthApiResponse> {
  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://sign-language-backend-336670885247.asia-northeast3.run.app';
  const response = await fetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    throw new Error(`Google login failed: ${response.status}`);
  }

  return response.json() as Promise<GoogleAuthApiResponse>;
}
