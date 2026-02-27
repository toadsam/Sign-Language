export type WrongNoteItem = {
  quizId: string;
  questionText: string;
  word: string;
  videoUrl: string;
  wrongAt: unknown;
};

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';
}

export async function fetchWrongNotes(uid: string): Promise<WrongNoteItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/wrong-notes`);
  if (!response.ok) {
    throw new Error(`Failed to load wrong notes: ${response.status}`);
  }
  return response.json() as Promise<WrongNoteItem[]>;
}
