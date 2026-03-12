import { getBaseUrl } from './base-url';

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
  const response = await fetch(`${getBaseUrl()}/api/auth/google`, {
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
