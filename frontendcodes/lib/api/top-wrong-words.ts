export type TopWrongWordItem = {
  quizId: string;
  word: string;
  wrongCount: number;
};

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://sign-language-backend-336670885247.asia-northeast3.run.app';
}

export async function fetchTopWrongWords(uid: string): Promise<TopWrongWordItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/top-wrong-words`);
  if (!response.ok) {
    throw new Error(`Failed to load top wrong words: ${response.status}`);
  }
  return response.json() as Promise<TopWrongWordItem[]>;
}
