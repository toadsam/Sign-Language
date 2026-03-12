import { getBaseUrl, resolveBackendUrl } from './base-url';

export type WrongNoteSavedItem = {
  quizId: string;
  questionText: string;
  word: string;
  videoUrl: string;
  wrongAt: unknown;
  savedAt: unknown;
};

export async function saveWrongNote(uid: string, quizId: string): Promise<WrongNoteSavedItem> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/wrong-note-saved`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save wrong note: ${response.status}`);
  }

  const data = (await response.json()) as WrongNoteSavedItem;
  return {
    ...data,
    videoUrl: resolveBackendUrl(data.videoUrl),
  };
}

export async function fetchSavedWrongNotes(uid: string): Promise<WrongNoteSavedItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/wrong-note-saved`);
  if (!response.ok) {
    throw new Error(`Failed to load saved wrong notes: ${response.status}`);
  }
  const data = (await response.json()) as WrongNoteSavedItem[];
  return data.map((item) => ({
    ...item,
    videoUrl: resolveBackendUrl(item.videoUrl),
  }));
}

export async function deleteSavedWrongNote(uid: string, quizId: string): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/wrong-note-saved/${quizId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to hide saved wrong note: ${response.status}`);
  }
}
