/**
 * 55점 좌표를 시간 순으로 모으고, AI 동작과 같은 30fps 배열로 고르게 만든다.
 * 카메라는 프레임 간격이 들쭉날쭉하므로(대략 초당 10 ~ 15번) 찍힌 시각을 그대로 두었다가
 * 마지막에 시각 사이를 곧게 이어 30fps 로 다시 뽑는다.
 */
import type { Motion } from '@/lib/api/generate';

import { BODY_JOINTS, type BodyFrame } from './body-frame';

export const BODY_FPS = 30;
const MAX_FRAMES = 600;

export class BodySequence {
  readonly frames: BodyFrame[] = [];
  /** 상체를 못 봐서 버린 장 수 */
  missed = 0;
  constructor(readonly startedMs: number, readonly durationMs = 5000) {}

  /** frame 이 null 이면 상체를 못 본 장이다 */
  add(frame: BodyFrame | null, nowMs: number) {
    const offset = nowMs - this.startedMs;
    if (offset < 0 || offset > this.durationMs) return;
    if (!frame) {
      this.missed++;
      return;
    }
    if (this.frames.length >= MAX_FRAMES) return;
    const last = this.frames[this.frames.length - 1];
    if (last && frame.timestampMs <= last.timestampMs) return;
    this.frames.push(frame);
  }
}

export type BodyMotion = {
  fps: number;
  frames: number;
  joints: 55;
  /** [frames × 55 × 3] */
  data: Float32Array;
  /** 프레임마다 그 손을 실제로 봤는가 (다시 뽑은 프레임은 앞뒤 장이 모두 봤을 때만 참) */
  leftHand: boolean[];
  rightHand: boolean[];
};

/** 찍힌 시각대로 모은 프레임을 고른 fps 로 다시 뽑는다. 두 장보다 적으면 null */
export function resampleBody(frames: BodyFrame[], fps = BODY_FPS): BodyMotion | null {
  if (frames.length < 2) return null;
  const t0 = frames[0].timestampMs;
  const t1 = frames[frames.length - 1].timestampMs;
  if (!(t1 > t0)) return null;
  const count = Math.max(2, Math.round(((t1 - t0) / 1000) * fps) + 1);
  const size = BODY_JOINTS * 3;
  const data = new Float32Array(count * size);
  const leftHand: boolean[] = [];
  const rightHand: boolean[] = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const t = t0 + (i / (count - 1)) * (t1 - t0);
    while (k < frames.length - 2 && frames[k + 1].timestampMs < t) k++;
    const a = frames[k];
    const b = frames[k + 1];
    const u = Math.min(1, Math.max(0, (t - a.timestampMs) / (b.timestampMs - a.timestampMs)));
    for (let j = 0; j < size; j++) data[i * size + j] = a.points[j] + (b.points[j] - a.points[j]) * u;
    leftHand.push(a.mask.leftHand && b.mask.leftHand);
    rightHand.push(a.mask.rightHand && b.mask.rightHand);
  }
  return { fps, frames: count, joints: 55, data, leftHand, rightHand };
}

/** 3D 친구에게 입혀 보기: 앞 55점만 채운 125점 동작으로 바꾼다 (친구는 앞 55점만 읽는다. 얼굴 70점은 0) */
export function bodyToMotion(body: BodyMotion): Motion {
  const data = new Float32Array(body.frames * 125 * 3);
  const size = BODY_JOINTS * 3;
  for (let i = 0; i < body.frames; i++) data.set(body.data.subarray(i * size, (i + 1) * size), i * 125 * 3);
  return { fps: body.fps, frames: body.frames, data, segments: [], source: 'baseline' };
}

/** 담은 결과를 한눈에: 몇 장, 초당 몇 번, 손을 본 비율 */
export function summarizeBody(sequence: BodySequence) {
  const n = sequence.frames.length;
  const span = n > 1 ? sequence.frames[n - 1].timestampMs - sequence.frames[0].timestampMs : 0;
  const ratio = (pick: (f: BodyFrame) => boolean) => (n ? sequence.frames.filter(pick).length / n : 0);
  return {
    frames: n,
    missedBody: sequence.missed,
    observedHz: span > 0 ? ((n - 1) * 1000) / span : 0,
    leftHandSeen: ratio((f) => f.mask.leftHand),
    rightHandSeen: ratio((f) => f.mask.rightHand),
    hipSeen: ratio((f) => f.mask.hip),
    flipped: n > 0 && ratio((f) => f.flipped) > 0.5,
    meanShoulderPx: n ? sequence.frames.reduce((a, f) => a + f.shoulderPx, 0) / n : 0,
  };
}

/** 파일로 남길 때의 모양 */
export function bodySequenceJson(sequence: BodySequence, source: string) {
  return {
    schema: 'signlingo-body-sequence-v1',
    joints: 55,
    layout: '상체 13 · 왼손 21 · 오른손 21 (ml/common/skeleton.py 의 앞 55점)',
    units: 'shoulder',
    normalization: '원점 목, 어깨너비 1, 어깨선 수평, x 오른쪽, y 아래. z 는 어림값',
    source,
    durationMs: sequence.durationMs,
    summary: summarizeBody(sequence),
    timestampsMs: sequence.frames.map((f) => Math.round(f.timestampMs - sequence.startedMs)),
    masks: sequence.frames.map((f) => [f.mask.leftHand ? 1 : 0, f.mask.rightHand ? 1 : 0]),
    points: sequence.frames.map((f) => f.points.map((v) => Math.round(v * 10000) / 10000)),
    note: '카메라 한 대로 뽑은 좌표입니다. 수어 뜻을 판별한 결과가 아닙니다.',
  };
}
