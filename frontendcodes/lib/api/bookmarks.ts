import { getBaseUrl, resolveBackendUrl } from './base-url';

export type BookmarkItem = {
  quizId: string;
  questionText: string;
  word: string;
  videoUrl: string;
  savedAt: unknown;
};

export async function saveBookmark(uid: string, quizId: string): Promise<BookmarkItem> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save bookmark: ${response.status}`);
  }

  const data = (await response.json()) as BookmarkItem;
  return {
    ...data,
    videoUrl: resolveBackendUrl(data.videoUrl),
  };
}

export async function fetchBookmarks(uid: string): Promise<BookmarkItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/bookmarks`);
  if (!response.ok) {
    throw new Error(`Failed to load bookmarks: ${response.status}`);
  }
  const data = (await response.json()) as BookmarkItem[];
  return data.map((item) => ({
    ...item,
    videoUrl: resolveBackendUrl(item.videoUrl),
  }));
}

export async function deleteBookmark(uid: string, quizId: string): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/bookmarks/${quizId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete bookmark: ${response.status}`);
  }
}
