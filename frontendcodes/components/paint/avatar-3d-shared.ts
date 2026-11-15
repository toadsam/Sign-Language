/**
 * 3D 캐릭터(발표 영상과 같은 캐릭터)와 주고받는 것들. 웹(iframe)과 폰(WebView)이 같이 쓴다.
 * 캐릭터 페이지는 public/avatar3d/ 에 있고, 주고받는 메시지 형식은 public/avatar3d/player.js 맨 위 설명과 같다.
 */
import Constants from 'expo-constants';
import type { StyleProp, ViewStyle } from 'react-native';

import type { Motion } from '@/lib/api/generate';

export type Avatar3DProps = {
  /** AI가 만든 동작 (계약 ⑤ 응답을 decodeMotion 으로 푼 것) */
  motion: Motion;
  playing?: boolean;
  loop?: boolean;
  speed?: number;
  style?: StyleProp<ViewStyle>;
  /** 정수 프레임이 바뀔 때마다 (자막 낱말 찾기용) */
  onFrame?: (frame: number) => void;
  onEnd?: () => void;
  /** 3D를 못 띄우면(WebGL 없음 · 페이지 못 읽음 · 8초 안에 준비 안 됨) 부른다. 이때 2D 펜 아바타로 돌아간다 */
  onError?: (message: string) => void;
};

export type Avatar3DEvent =
  | { type: 'avatar3d-ready' }
  | { type: 'avatar3d-frame'; frame: number }
  | { type: 'avatar3d-end' }
  | { type: 'avatar3d-fps'; fps: number }
  | { type: 'avatar3d-error'; message: string };

export const AVATAR3D_READY_TIMEOUT = 8000;

/** expo dev 서버는 public 파일을 루트에서 주고, 웹으로 내보낸 앱은 baseUrl(/Sign-Language) 아래에 둔다 */
export function avatar3dWebPath() {
  const base = __DEV__ ? '' : (Constants.expoConfig?.experiments?.baseUrl ?? '').replace(/\/+$/, '');
  return `${base}/avatar3d/index.html`;
}

/**
 * 폰에서 열 주소. EXPO_PUBLIC_AVATAR3D_URL 이 있으면 그것(배포된 웹 주소),
 * 없으면 개발 중일 때 Expo 개발 서버(같은 와이파이의 컴퓨터)에서 연다.
 */
export function avatar3dNativeUrl(): string | null {
  const env = process.env.EXPO_PUBLIC_AVATAR3D_URL;
  if (env) return env;
  const host = Constants.expoConfig?.hostUri;
  return __DEV__ && host ? `http://${host}/avatar3d/index.html` : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(u8: Uint8Array) {
  let out = '';
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i], b = u8[i + 1] ?? 0, c = u8[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
  }
  return out;
}

/** 동작을 페이지로 보낼 메시지로 (계약 ⑤ 응답과 같은 모양) */
export function motionMessage(motion: Motion, loop: boolean) {
  const bytes = new Uint8Array(motion.data.buffer, motion.data.byteOffset, motion.data.byteLength);
  return { type: 'avatar3d-motion', fps: motion.fps, frames: motion.frames, joints: 125, data: bytesToBase64(bytes), loop };
}

export function parseEvent(raw: unknown): Avatar3DEvent | null {
  let d = raw;
  if (typeof raw === 'string') {
    try {
      d = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== 'object' || typeof (d as { type?: unknown }).type !== 'string') return null;
  return (d as { type: string }).type.startsWith('avatar3d-') ? (d as Avatar3DEvent) : null;
}
