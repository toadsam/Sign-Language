import sample from './demo-motion.json';
import type { MotionResponse } from './motion';

/** Synthetic controls test, not outputs of B1/B2/Ours. */
export function createComparisonSamples(): MotionResponse[] {
  const r = sample as MotionResponse;
  const raw = atob(r.data);
  return [
    { ...r, demo: true },
    { ...r, fps: 60, demo: true },
    { ...r, frames: 90, data: btoa(raw.slice(0, 90 * 125 * 3 * 4)), demo: true },
    { ...r, fps: 24, demo: true },
  ];
}

/** Deliberately perturbed mock pose pair for the reconstruction viewer. */
export function createReconstructionSamples(): MotionResponse[] {
  const original = sample as MotionResponse;
  const raw = atob(original.data), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  // Offset hand coordinates only; this is not a decoder/model reconstruction.
  for (let frame = 0; frame < original.frames; frame++) {
    for (let joint = 13; joint < 55; joint++) {
      const offset = (frame * 375 + joint * 3) * 4;
      view.setFloat32(offset, view.getFloat32(offset, true) + .035 * Math.sin(frame / 12), true);
    }
  }
  let encoded = '';
  for (const byte of bytes) encoded += String.fromCharCode(byte);
  return [{ ...original, demo: true }, { ...original, data: btoa(encoded), demo: true }];
}
