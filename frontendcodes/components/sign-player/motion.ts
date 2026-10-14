/** Team contract ⑤: float32 little-endian [frames, 125, 3]. */
export type MotionResponse = {
  fps: number; joints: 125; frames: number; units: 'shoulder'; data: string;
  tokens: number[]; segments: { gloss: string; start: number; end: number }[];
  unknown: string[]; source: 'model' | 'baseline'; demo?: boolean;
};
export type DecodedMotion = { response: MotionResponse; positions: Float32Array };

export function decodeMotion(value: unknown): DecodedMotion {
  if (!value || typeof value !== 'object') throw new Error('동작 응답 객체가 필요합니다.');
  const r = value as MotionResponse;
  if ((r as {source:string}).source === 'video') throw new Error('영상 응답입니다. 좌표 응답 JSON을 선택해주세요.');
  if (r.source !== 'model' && r.source !== 'baseline') throw new Error('동작의 출처가 올바르지 않습니다.');
  if (r.joints !== 125 || r.units !== 'shoulder') throw new Error('125관절·어깨너비 단위 응답이 필요합니다.');
  if (!Number.isInteger(r.frames) || r.frames < 1 || r.frames > 18000 || !Number.isFinite(r.fps) || r.fps <= 0 || r.fps > 240) throw new Error('프레임 수 또는 FPS가 올바르지 않습니다.');
  if (!Array.isArray(r.tokens) || r.tokens.some(x=>!Number.isInteger(x)||x<0) || !Array.isArray(r.unknown) || r.unknown.some(x=>typeof x !== 'string')) throw new Error('토큰 또는 미지원 단어 목록이 올바르지 않습니다.');
  if (!Array.isArray(r.segments) || r.segments.some(s=>!s || typeof s.gloss !== 'string' || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start<0 || s.end<=s.start || s.end>r.frames)) throw new Error('자막 구간이 올바르지 않습니다.');
  if (typeof r.data !== 'string' || r.data.length > 36000000) throw new Error('좌표 데이터가 없거나 너무 큽니다.');
  let raw: string;
  try { raw = atob(r.data); } catch { throw new Error('base64 좌표를 읽을 수 없습니다.'); }
  const count = r.frames * 125 * 3;
  if (raw.length !== count * 4) throw new Error('프레임 수와 좌표 길이가 다릅니다.');
  const bytes = Uint8Array.from(raw, c=>c.charCodeAt(0));
  const view = new DataView(bytes.buffer), positions = new Float32Array(count);
  for (let i=0;i<count;i++) {
    const n=view.getFloat32(i*4,true);
    if (!Number.isFinite(n) || Math.abs(n)>100) throw new Error('좌표에 유효하지 않은 값이 있습니다.');
    positions[i]=n;
  }
  return {response:r,positions};
}
