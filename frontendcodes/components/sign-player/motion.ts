/** Team contract ⑤: float32 little-endian [frames, 125, 3]. */
export type MotionResponse = {
  fps: number;
  joints: 125;
  frames: number;
  units: 'shoulder';
  data: string;
  tokens: number[];
  segments: { gloss: string; start: number; end: number }[];
  unknown: string[];
  source: 'model' | 'baseline';
  demo?: boolean;
};
export type DecodedMotion = { response: MotionResponse; positions: Float32Array };

/** Team viewer README: each token corresponds to four motion frames. */
export function currentMotionToken(response: MotionResponse, frame: number): number | undefined {
  if (!Number.isInteger(frame) || frame < 0 || frame >= response.frames) return undefined;
  return response.tokens[Math.floor(frame / 4)];
}

export function decodeMotion(value: unknown): DecodedMotion {
  if (!value || typeof value !== 'object') throw new Error('동작 응답 객체가 필요합니다.');
  const response = value as MotionResponse;
  if ((response as { source: string }).source === 'video') {
    throw new Error('영상 응답입니다. 좌표 응답 JSON을 선택해주세요.');
  }
  if (response.source !== 'model' && response.source !== 'baseline') {
    throw new Error('동작의 출처가 올바르지 않습니다.');
  }
  if (response.joints !== 125 || response.units !== 'shoulder') {
    throw new Error('125관절·어깨너비 단위 응답이 필요합니다.');
  }
  if (
    !Number.isInteger(response.frames) ||
    response.frames < 0 ||
    response.frames > 18000 ||
    !Number.isFinite(response.fps) ||
    response.fps <= 0 ||
    response.fps > 240
  ) {
    throw new Error('프레임 수 또는 FPS가 올바르지 않습니다.');
  }
  if (
    !Array.isArray(response.tokens) ||
    response.tokens.some((token) => !Number.isInteger(token) || token < 0) ||
    !Array.isArray(response.unknown) ||
    response.unknown.some((word) => typeof word !== 'string')
  ) {
    throw new Error('토큰 또는 미지원 단어 목록이 올바르지 않습니다.');
  }
  if (
    !Array.isArray(response.segments) ||
    response.segments.some(
      (segment) =>
        !segment ||
        typeof segment.gloss !== 'string' ||
        !Number.isInteger(segment.start) ||
        !Number.isInteger(segment.end) ||
        segment.start < 0 ||
        segment.end <= segment.start ||
        segment.end > response.frames,
    )
  ) {
    throw new Error('자막 구간이 올바르지 않습니다.');
  }
  if (typeof response.data !== 'string' || response.data.length > 36000000) {
    throw new Error('좌표 데이터가 없거나 너무 큽니다.');
  }
  if (
    response.frames === 0 &&
    (response.data !== '' ||
      response.tokens.length !== 0 ||
      response.segments.length !== 0 ||
      response.unknown.length === 0)
  ) {
    throw new Error('빈 동작은 좌표·토큰·구간 없이 미지원 단어를 포함해야 합니다.');
  }
  let raw: string;
  try {
    raw = atob(response.data);
  } catch {
    throw new Error('base64 좌표를 읽을 수 없습니다.');
  }
  const count = response.frames * 125 * 3;
  if (raw.length !== count * 4) throw new Error('프레임 수와 좌표 길이가 다릅니다.');
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const positions = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const coordinate = view.getFloat32(i * 4, true);
    if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 100) {
      throw new Error('좌표에 유효하지 않은 값이 있습니다.');
    }
    positions[i] = coordinate;
  }
  return { response, positions };
}
