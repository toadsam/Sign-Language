import { getBaseUrl, resolveBackendUrl } from './base-url';

export type WrongNoteItem = {
  quizId: string;
  questionText: string;
  word: string;
  videoUrl: string;
  wrongAt: unknown;
};

export async function fetchWrongNotes(uid: string): Promise<WrongNoteItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/wrong-notes`);
  if (!response.ok) {
    throw new Error(`Failed to load wrong notes: ${response.status}`);
  }
  const data = (await response.json()) as WrongNoteItem[];
  return data.map((item) => ({
    ...item,
    videoUrl: resolveBackendUrl(item.videoUrl),
  }));
}
