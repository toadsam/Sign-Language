import { getBaseUrl, resolveBackendUrl } from './base-url';

export type TranslateClip = {
  word: string;
  id: number;
  file: string;
  url: string;
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
  unknown: string[];
  /** 사전에는 있지만 Firebase Storage에 영상이 없는 단어 목록 */
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
  return {
    ...data,
    clips: (data.clips ?? []).map((clip) => ({
      ...clip,
      url: resolveBackendUrl(clip.url),
    })),
  };
}
