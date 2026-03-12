import { getBaseUrl } from './base-url';

export type TopWrongWordItem = {
  quizId: string;
  word: string;
  wrongCount: number;
};

export async function fetchTopWrongWords(uid: string): Promise<TopWrongWordItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/top-wrong-words`);
  if (!response.ok) {
    throw new Error(`Failed to load top wrong words: ${response.status}`);
  }
  return response.json() as Promise<TopWrongWordItem[]>;
}
