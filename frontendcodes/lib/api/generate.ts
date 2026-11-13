/**
 * AI가 만든 수어 동작 받기 (계약 ⑤ POST /generate).
 * 아직 추론 서버가 없어서 MOTION_API_ENABLED가 false다. 서버가 생기면 true로 바꾸면 된다.
 * 실패하거나 꺼져 있으면 null을 돌려주고, 화면은 1학기 영상 재생으로 돌아간다.
 */
import { getBaseUrl } from './base-url';

export const MOTION_API_ENABLED = false;

export type Motion = {
  fps: number;
  frames: number;
  /** [frames × 125 × 3] 어깨너비 = 1, 원점 목, x 오른쪽, y 아래, z 카메라에서 멀어지는 방향 */
  data: Float32Array;
  segments: { gloss: string; start: number; end: number }[];
  source: 'model' | 'baseline' | 'video';
};

type GenerateResponse = {
  fps: number;
  joints: number;
  frames: number;
  units: string;
  data: string;
  tokens?: number[];
  segments?: { gloss: string; start: number; end: number }[];
  unknown?: string[];
  source: 'model' | 'baseline' | 'video';
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** 응답 JSON을 동작으로 바꾼다. 형식이 맞지 않으면 null */
export function decodeMotion(r: GenerateResponse): Motion | null {
  if (r.source === 'video' || r.joints !== 125 || !r.data) return null;
  const bytes = base64ToBytes(r.data);
  const data = new Float32Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 4));
  if (data.length !== r.frames * 125 * 3) return null;
  return { fps: r.fps || 30, frames: r.frames, data, segments: r.segments ?? [], source: r.source };
}

export async function generateMotion(gloss: string[], nonmanual: string[] = []): Promise<Motion | null> {
  if (!MOTION_API_ENABLED || gloss.length === 0) return null;
  try {
    const res = await fetch(`${getBaseUrl()}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gloss, nonmanual }),
    });
    if (!res.ok) return null;
    return decodeMotion((await res.json()) as GenerateResponse);
  } catch {
    return null;
  }
}
