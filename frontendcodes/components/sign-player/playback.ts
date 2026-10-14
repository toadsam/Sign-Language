import { decodeMotion } from './motion';
import type { MotionResponse } from './motion';
/** UI-normalized video shape; map the team's API response to it during integration. */
export type VideoResponse = { source: 'video'; videoUrl: string; unknown: string[]; demo?: boolean };
export type PlaybackResponse = MotionResponse | VideoResponse;
export function decodePlayback(value: unknown): PlaybackResponse {
  if (!value || typeof value !== 'object') throw new Error('재생 응답 객체가 필요합니다.');
  if ((value as {source?:unknown}).source !== 'video') return decodeMotion(value).response;
  const r = value as VideoResponse;
  if (typeof r.videoUrl !== 'string' || !r.videoUrl.trim() || r.videoUrl !== r.videoUrl.trim()) throw new Error('영상 주소가 필요합니다.');
  let url: URL;
  try { url = new URL(r.videoUrl, 'https://local.invalid/'); } catch { throw new Error('영상 주소가 올바르지 않습니다.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('HTTP 또는 HTTPS 영상 주소가 필요합니다.');
  if (!Array.isArray(r.unknown) || r.unknown.some(word=>typeof word!=='string')) throw new Error('미지원 단어 목록이 올바르지 않습니다.');
  return {source:'video',videoUrl:r.videoUrl,unknown:r.unknown,demo:r.demo===true};
}
