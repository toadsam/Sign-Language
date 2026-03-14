const DEFAULT_BASE_URL = 'http://localhost:8080';

const LOCAL_BACKEND_ORIGINS = new Set([ //없을 때는 로컬 호스트에서 불러옴
  'http://localhost:8080',
  'https://localhost:8080',
  'http://127.0.0.1:8080',
  'https://127.0.0.1:8080',
]);

export function getBaseUrl() {//기본적으로는 클라우드에서 불러옴
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

export function resolveBackendUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) {
    return '';
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return '';
  }

  const baseUrl = getBaseUrl();

  if (trimmed.startsWith('/')) {
    return `${baseUrl}${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    const origin = `${parsed.protocol}//${parsed.host}`;

    if (LOCAL_BACKEND_ORIGINS.has(origin)) {
      return `${baseUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return trimmed;
  } catch {
    return `${baseUrl}/${trimmed.replace(/^\/+/, '')}`;
  }
}
