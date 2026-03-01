export type UserInfo = {
  correctQuestionNum: number;
  totalQuestionNum: number;
  userId: number;
  userLevel: number;
  totalQuestions?: string[];
  incorrectQuestions?: string[];
  dailySolvedCounts?: Record<string, number>;
};

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';
}

export async function fetchUserInfo(uid: string): Promise<UserInfo> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}`);
  if (!response.ok) {
    throw new Error(`Failed to load user info: ${response.status}`);
  }
  return response.json() as Promise<UserInfo>;
}

export async function recordQuizAttempt(
  uid: string,
  questionId: string,
  isCorrect: boolean
): Promise<UserInfo> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/tryQuestion`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, isCorrect }),
  });

  if (!response.ok) {
    throw new Error(`Failed to record quiz attempt: ${response.status}`);
  }

  return response.json() as Promise<UserInfo>;
}
