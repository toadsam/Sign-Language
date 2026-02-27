export type BookmarkItem = {
  quizId: string;
  questionText: string;
  word: string;
  videoUrl: string;
  savedAt: unknown;
};

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';
}

export async function saveBookmark(uid: string, quizId: string): Promise<BookmarkItem> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save bookmark: ${response.status}`);
  }

  return response.json() as Promise<BookmarkItem>;
}

export async function fetchBookmarks(uid: string): Promise<BookmarkItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/bookmarks`);
  if (!response.ok) {
    throw new Error(`Failed to load bookmarks: ${response.status}`);
  }
  return response.json() as Promise<BookmarkItem[]>;
}

export async function deleteBookmark(uid: string, quizId: string): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/bookmarks/${quizId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete bookmark: ${response.status}`);
  }
}
