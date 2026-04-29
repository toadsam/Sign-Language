import { getBaseUrl, resolveBackendUrl } from './base-url';

export type TranslateClip = {
  word: string;
  id: number;
  file: string;
  url: string;
};

export type TranslatePlaybackItem = TranslateClip & {
  hasVideo: boolean;
};

export type SimplificationMetadata = {
  question: boolean;
  negative: boolean;
  tense: string;
};

export type TranslateResponse = {
  input: string;
  simplifiedSentence: string;
  normalizedTokens: string[];
  appliedRules: string[];
  metadata: SimplificationMetadata;
  clips: TranslateClip[];
  items?: TranslatePlaybackItem[];
  unknown: string[];
  noVideoWords: string[];
};

export async function translateText(text: string): Promise<TranslateResponse> {
  const response = await fetch(`${getBaseUrl()}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Failed to translate text: ${response.status}`);
  }

  const data = (await response.json()) as TranslateResponse;
  const clips = (data.clips ?? []).map((clip) => ({
    ...clip,
    url: resolveOptionalVideoUrl(clip.url),
  }));
  const items = (data.items ?? clips.map((clip) => ({ ...clip, hasVideo: true }))).map((item) => ({
    ...item,
    url: resolveOptionalVideoUrl(item.url),
    hasVideo: item.hasVideo && !!item.url,
  }));

  return {
    ...data,
    clips,
    items,
  };
}

function resolveOptionalVideoUrl(url: string | undefined | null): string {
  if (!url) {
    return '';
  }
  return resolveBackendUrl(url);
}
