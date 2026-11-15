/**
 * AI가 만든 수어 동작 받기.
 * 문장을 Spring `POST /api/sign/generate {text}` 에 보내고 계약 ⑤ 좌표 응답을 받는다.
 * 요청 · 응답 검사 · 오류 이름은 승혁의 components/sign-player/generate-api 를 그대로 쓴다 (같은 서버, 같은 약속).
 *
 * 어디로 보내나
 *   1) EXPO_PUBLIC_SIGN_GENERATE_URL 이 있으면 그 주소.
 *      예) VM 을 포트로 연결했을 때 http://localhost:8080/api/sign/generate
 *   2) 없으면 앱이 쓰는 서버 주소 + /api/sign/generate
 * EXPO_PUBLIC_MOTION_API=off 면 아예 묻지 않는다.
 *
 * 동작을 못 받으면 화면은 1학기 영상 재생을 그대로 쓴다.
 * 이때 왜 못 받았는지를 같이 돌려주므로, 화면이 "영상으로 보여 준다"고 알릴 수 있다.
 */
import { generateFromApi } from '@/components/sign-player/generate-api';
import { GenerationApiError } from '@/components/sign-player/generation-error';
import { decodeMotion } from '@/components/sign-player/motion';

import { getBaseUrl } from './base-url';

export type Motion = {
  fps: number;
  frames: number;
  /** [frames × 125 × 3] 어깨너비 = 1, 원점 목, x 오른쪽, y 아래, z 카메라에서 멀어지는 방향 */
  data: Float32Array;
  /** 낱말마다 프레임 구간. 문장 모드는 채워서 오고(낱말 사이 연결 구간은 빠진다), 단어 모드는 빈 배열 */
  segments: { gloss: string; start: number; end: number }[];
  source: 'model' | 'baseline';
};

export type MotionResult =
  /** 동작이 왔다. unknown 은 그리지 못해 빠진 낱말 */
  | { kind: 'motion'; motion: Motion; unknown: string[] }
  /** 정상 응답이지만 그릴 수 있는 낱말이 하나도 없었다 (frames 0) */
  | { kind: 'empty'; unknown: string[] }
  /** 꺼 두었다 */
  | { kind: 'off' }
  /** 서버가 꺼졌거나, 바쁘거나, 시간 초과이거나, 응답 모양이 틀렸다 */
  | { kind: 'error'; code: string; message: string; retryable: boolean };

const PATH = '/api/sign/generate';

function isLocalDev() {
  return __DEV__ && typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location?.hostname ?? '');
}

/**
 * 동작을 물어볼 주소. explicit 은 "AI 동작을 쓰겠다고 주소를 따로 정해 둔 상태"라는 뜻이고,
 * 이때만 화면이 실패를 알린다 (정해 두지 않은 배포 앱에서는 조용히 영상으로 간다).
 * devOverride 는 개발 중 localhost 에서만 받는다: 통역 화면 주소의 ?gen=http://localhost:8085/api/sign/generate
 */
export function motionEndpoint(devOverride?: string | null): { url: string; explicit: boolean } | null {
  if (process.env.EXPO_PUBLIC_MOTION_API === 'off') return null;
  const dev = devOverride?.trim();
  if (dev && isLocalDev() && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(dev)) return { url: dev, explicit: true };
  const env = process.env.EXPO_PUBLIC_SIGN_GENERATE_URL?.trim();
  if (env) return { url: env.includes(PATH) ? env : env.replace(/\/+$/, '') + PATH, explicit: true };
  return { url: getBaseUrl() + PATH, explicit: false };
}

/** 문장을 보내 AI 동작을 받는다. 던지지 않고 결과 종류로 알려 준다 */
export async function requestMotion(
  text: string,
  opts: { devEndpoint?: string | null; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<MotionResult> {
  const target = motionEndpoint(opts.devEndpoint);
  if (!target) return { kind: 'off' };
  try {
    const r = await generateFromApi({
      text,
      endpoint: target.url,
      signal: opts.signal ?? new AbortController().signal,
      timeoutMs: opts.timeoutMs ?? 15000,
    });
    if (r.source === 'video') return { kind: 'error', code: 'VIDEO_RESPONSE', message: '동작 대신 영상 응답이 왔습니다.', retryable: false };
    if (r.frames === 0) return { kind: 'empty', unknown: r.unknown };
    const { positions } = decodeMotion(r);
    return {
      kind: 'motion',
      unknown: r.unknown,
      motion: { fps: r.fps, frames: r.frames, data: positions, segments: r.segments, source: r.source },
    };
  } catch (e) {
    if (e instanceof GenerationApiError) return { kind: 'error', code: e.code, message: e.message, retryable: e.retryable };
    return { kind: 'error', code: 'CLIENT', message: e instanceof Error ? e.message : '동작을 받지 못했습니다.', retryable: false };
  }
}
