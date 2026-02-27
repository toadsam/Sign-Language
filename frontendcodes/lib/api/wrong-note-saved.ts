export type WrongNoteSavedItem = {
  quizId: string;
  questionText: string;
  word: string;
  videoUrl: string;
  wrongAt: unknown;
  savedAt: unknown;
};

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';
}

export async function saveWrongNote(uid: string, quizId: string): Promise<WrongNoteSavedItem> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/wrong-note-saved`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save wrong note: ${response.status}`);
  }

  return response.json() as Promise<WrongNoteSavedItem>;
}

export async function fetchSavedWrongNotes(uid: string): Promise<WrongNoteSavedItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/wrong-note-saved`);
  if (!response.ok) {
    throw new Error(`Failed to load saved wrong notes: ${response.status}`);
  }
  return response.json() as Promise<WrongNoteSavedItem[]>;
}

export async function deleteSavedWrongNote(uid: string, quizId: string): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/wrong-note-saved/${quizId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete saved wrong note: ${response.status}`);
  }
}
