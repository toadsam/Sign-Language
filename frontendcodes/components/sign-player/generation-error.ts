/** Structured errors from Spring's generation endpoint; no automatic retries. */
export class GenerationApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message); this.name = 'GenerationApiError';
  }
}
export function readGenerationError(value: unknown, status?: number): GenerationApiError | null {
  if (!value || typeof value !== 'object' || !('error' in value)) return null;
  const error = (value as { error: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const detail = error as Record<string, unknown>;
  if (typeof detail.code !== 'string' || !detail.code || typeof detail.message !== 'string' || !detail.message.trim() || typeof detail.retryable !== 'boolean') return null;
  return new GenerationApiError(detail.message, detail.code, detail.retryable, status);
}
