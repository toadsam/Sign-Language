const DEFAULT_BASE_URL = 'http://localhost:8080';

const LOCAL_BACKEND_ORIGINS = new Set([
  'http://localhost:8080',
  'https://localhost:8080',
  'http://127.0.0.1:8080',
  'https://127.0.0.1:8080',
]);

export function getBaseUrl() {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_BASE_URL;
  const normalized = raw.replace(/\/+$/, '');
  // Frontend may be hosted under `/app`, but backend APIs are served from root.
  const withoutAppSuffix = normalized.replace(/\/app$/i, '');

  // In local web development, prioritize local backend to avoid remote auth (403) issues.
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalWeb = host === 'localhost' || host === '127.0.0.1';
    if (isLocalWeb) {
      return DEFAULT_BASE_URL;
    }
  }

  return withoutAppSuffix;
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
