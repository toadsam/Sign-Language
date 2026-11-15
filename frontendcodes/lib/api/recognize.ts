/**
 * 읽는 모델에게 물어보기: 동작 좌표를 Spring `POST /api/sign/recognize` 에 보내고
 * "어떤 단어로 읽혔나"를 받는다 (승현의 읽는 모델. 추론 서버의 /recognize 로 전달된다).
 *
 * 생성 주소를 따로 정해 둔 경우에만 묻는다 (lib/api/generate.ts 의 motionEndpoint 가 explicit 일 때).
 * 그때 읽기 주소는 생성 주소의 끝 /generate 를 /recognize 로 바꾼 것이고,
 * EXPO_PUBLIC_SIGN_RECOGNIZE_URL 로 따로 정할 수도 있다.
 *
 * 읽는 모델은 스튜디오에서 찍은 단어 클립으로 배웠다. 문장 속 낱말이나 웹캠 좌표는 잘 못 읽을 수 있으므로
 * 화면에서는 "읽힌 결과"로만 보여 주고 점수에는 넣지 않는다.
 */
import { motionEndpoint } from './generate';

export type ReadCandidate = { item: string; name: string | null; prob: number };
export type ReadSpan = { start: number; end: number; top: ReadCandidate[] };
export type Reading =
  | { kind: 'ok'; classes: number; results: ReadSpan[] }
  /** 주소를 정해 두지 않았다. 화면은 아무것도 보여 주지 않는다 */
  | { kind: 'off' }
  | { kind: 'error'; message: string };

const MIN_SPAN = 4;

/** 읽기를 물어볼 주소. 정해 둔 것이 없으면 null */
export function recognizeEndpoint(devGenOverride?: string | null): string | null {
  const explicit = process.env.EXPO_PUBLIC_SIGN_RECOGNIZE_URL?.trim();
  if (explicit) return explicit;
  const generate = motionEndpoint(devGenOverride);
  if (!generate?.explicit) return null;
  try {
    const url = new URL(generate.url);
    if (!/\/generate$/.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\/generate$/, '/recognize');
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

function toBase64(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function readSpans(value: unknown): ReadSpan[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: ReadSpan[] = [];
  for (const entry of value) {
    const e = entry as { start?: unknown; end?: unknown; top?: unknown };
    if (!e || typeof e.start !== 'number' || typeof e.end !== 'number' || !Array.isArray(e.top) || e.top.length === 0) return null;
    const top: ReadCandidate[] = [];
    for (const candidate of e.top) {
      const c = candidate as { item?: unknown; name?: unknown; prob?: unknown };
      if (!c || typeof c.item !== 'string' || typeof c.prob !== 'number' || !(c.name === null || typeof c.name === 'string')) return null;
      top.push({ item: c.item, name: c.name, prob: c.prob });
    }
    out.push({ start: e.start, end: e.end, top });
  }
  return out;
}

/**
 * 동작 한 개를 읽는 모델에 보낸다. spans 는 [시작, 끝 다음) 장 번호이고, 비우면 전체를 한 번 읽는다.
 * 던지지 않고 결과 종류로 알려 준다.
 */
export async function requestReading(
  motion: { frames: number; joints: 55 | 125; data: Float32Array },
  spans: [number, number][] = [],
  opts: { devGenEndpoint?: string | null; timeoutMs?: number } = {}
): Promise<Reading> {
  const endpoint = recognizeEndpoint(opts.devGenEndpoint);
  if (!endpoint) return { kind: 'off' };
  if (motion.frames < MIN_SPAN || motion.data.length !== motion.frames * motion.joints * 3) return { kind: 'error', message: '읽을 동작이 너무 짧아요.' };
  const wanted = spans
    .map(([start, end]): [number, number] => [Math.max(0, Math.floor(start)), Math.min(motion.frames, Math.ceil(end))])
    .filter(([start, end]) => end - start >= MIN_SPAN);
  if (spans.length > 0 && wanted.length !== spans.length) return { kind: 'error', message: '낱말 구간이 너무 짧아 읽지 못했어요.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ joints: motion.joints, frames: motion.frames, data: toBase64(motion.data), ...(wanted.length ? { spans: wanted } : {}) }),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => null)) as { classes?: unknown; results?: unknown; error?: { message?: unknown } } | null;
    if (!response.ok) {
      const message = body?.error && typeof body.error.message === 'string' ? body.error.message : `읽는 모델에 물어보지 못했어요 (HTTP ${response.status}).`;
      return { kind: 'error', message };
    }
    const results = readSpans(body?.results);
    if (!results || typeof body?.classes !== 'number') return { kind: 'error', message: '읽는 모델의 답을 알아볼 수 없어요.' };
    return { kind: 'ok', classes: body.classes, results };
  } catch {
    return { kind: 'error', message: controller.signal.aborted ? '읽는 모델이 제때 답하지 않았어요.' : '읽는 모델에 연결할 수 없어요.' };
  } finally {
    clearTimeout(timer);
  }
}
