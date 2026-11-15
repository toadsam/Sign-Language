import { decodeMotion } from './motion';
import type { MotionResponse } from './motion';
export function encodeNativeMotion(id: number, motion: MotionResponse): string {
  return JSON.stringify({type:'sign-motion',version:1,id,motion});
}
export function decodeNativeMotion(raw: string): {id:number;motion:MotionResponse} | null {
  const value = JSON.parse(raw);
  if(!value || value.type!=='sign-motion' || value.version!==1)return null;
  if(!Number.isSafeInteger(value.id) || value.id<1)throw new Error('앱 동작 메시지 번호가 올바르지 않습니다.');
  return {id:value.id,motion:decodeMotion(value.motion).response};
}
