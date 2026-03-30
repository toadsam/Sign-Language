import { resolveBackendUrl, getBaseUrl } from './base-url';

export type TranslatorBookmarkItem = {
  quizId: string;
  questionText: string;
  word: string;
  videoUrl: string;
  savedAt: unknown;
};

type SaveTranslatorBookmarkPayload = {
  sentence: string;
  word?: string;
  videoUrl?: string;
};

export async function saveTranslatorBookmark(
  uid: string,
  payload: SaveTranslatorBookmarkPayload
): Promise<TranslatorBookmarkItem> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/translator-bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to save translator bookmark: ${response.status}`);
  }

  const data = (await response.json()) as TranslatorBookmarkItem;
  return {
    ...data,
    videoUrl: resolveBackendUrl(data.videoUrl),
  };
}

export async function fetchTranslatorBookmarks(uid: string): Promise<TranslatorBookmarkItem[]> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/translator-bookmarks`);

  if (!response.ok) {
    throw new Error(`Failed to load translator bookmarks: ${response.status}`);
  }

  const data = (await response.json()) as TranslatorBookmarkItem[];
  return (data ?? []).map((item) => ({
    ...item,
    videoUrl: resolveBackendUrl(item.videoUrl),
  }));
}

export async function deleteTranslatorBookmark(uid: string, bookmarkId: string): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/api/users/${uid}/translator-bookmarks/${bookmarkId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete translator bookmark: ${response.status}`);
  }
}
