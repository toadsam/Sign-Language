export type HandSequenceData = {
  schema: 'signlingo-hand-sequence-v1';
  shape: number[];
  durationMs: number;
  timestampsMs: number[];
  features: number[];
  masks: number[][];
  source?: string;
};

export function decodeHandSequence(value: unknown): HandSequenceData {
  if (!value || typeof value !== 'object') throw new Error('손 좌표 수집 객체가 필요합니다.');
  const sequence = value as HandSequenceData;
  if (
    sequence.schema !== 'signlingo-hand-sequence-v1' ||
    !Array.isArray(sequence.shape) ||
    sequence.shape.length !== 4 ||
    sequence.shape.slice(1).join(',') !== '2,21,2' ||
    !Number.isInteger(sequence.shape[0]) ||
    sequence.shape[0] < 1 ||
    sequence.shape[0] > 1500
  ) {
    throw new Error('손 좌표 수집 형식 [T,2,21,2]이 필요합니다.');
  }
  const count = sequence.shape[0];
  if (!Number.isFinite(sequence.durationMs) || sequence.durationMs <= 0 || sequence.durationMs > 60000) {
    throw new Error('수집 시간이 올바르지 않습니다.');
  }
  if (
    !Array.isArray(sequence.timestampsMs) ||
    sequence.timestampsMs.length !== count ||
    sequence.timestampsMs.some(
      (time, i) =>
        !Number.isFinite(time) ||
        time < 0 ||
        time > sequence.durationMs ||
        (i > 0 && time <= sequence.timestampsMs[i - 1]),
    )
  ) {
    throw new Error('프레임 시간이 증가하는 순서로 필요합니다.');
  }
  if (
    !Array.isArray(sequence.features) ||
    sequence.features.length !== count * 84 ||
    sequence.features.some((n) => !Number.isFinite(n) || Math.abs(n) > 1000000)
  ) {
    throw new Error('좌표 길이 또는 숫자가 올바르지 않습니다.');
  }
  if (
    !Array.isArray(sequence.masks) ||
    sequence.masks.length !== count ||
    sequence.masks.some((mask) => !Array.isArray(mask) || mask.length !== 2 || mask.some((n) => n !== 0 && n !== 1))
  ) {
    throw new Error('프레임별 손 존재 마스크가 필요합니다.');
  }
  for (let frame = 0; frame < count; frame++) {
    for (let side = 0; side < 2; side++) {
      if (
        !sequence.masks[frame][side] &&
        sequence.features.slice(frame * 84 + side * 42, frame * 84 + side * 42 + 42).some((n) => n !== 0)
      ) {
        throw new Error('미감지 손의 좌표는 0이어야 합니다.');
      }
    }
  }
  return {
    schema: sequence.schema,
    shape: [count, 2, 21, 2],
    durationMs: sequence.durationMs,
    timestampsMs: sequence.timestampsMs,
    features: sequence.features,
    masks: sequence.masks,
    source: typeof sequence.source === 'string' ? sequence.source : undefined,
  };
}

export function handFrameAtTime(timestamps: number[], timeMs: number): number {
  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (timestamps[mid] <= timeMs) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}
