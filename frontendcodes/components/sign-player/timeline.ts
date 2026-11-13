/** All panes share seconds, while each keeps its original FPS. Short clips hold their last frame. */
export const TIMELINE_FPS = 30;
export function frameAtTime(seconds: number, fps: number, frames: number) {
  return Math.min(frames - 1, Math.max(0, Math.floor(seconds * fps + 1e-8)));
}
export function timelineFrames(clips: readonly { fps: number; frames: number }[]) {
  return Math.max(1, Math.ceil(Math.max(0, ...clips.map(c => c.frames / c.fps)) * TIMELINE_FPS));
}
