/**
 * 시점 고르기 칸(정면 · 측면 · 위 · 자유 시점)에 보일 값.
 *
 * 2026-11-24 승혁: 화면마다 판정이 달랐다. 재생 화면은 위아래로 조금만 끌어도 "위", 비교 화면은 pitch만 맞으면 "위",
 * 코드북에는 "위"가 없었다. 이제 고른 시점과 각도가 정확히 같을 때만 그 이름을 보이고, 끌어서 돌렸으면 "자유 시점"이다.
 */
export type ViewPreset = 'front' | 'side' | 'top' | 'custom';

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export function viewPreset(yaw: number, pitch: number): ViewPreset {
  if (same(yaw, 0) && same(pitch, 0)) return 'front';
  if (same(yaw, Math.PI / 2) && same(pitch, 0)) return 'side';
  if (same(yaw, 0) && same(pitch, -Math.PI / 2)) return 'top';
  return 'custom';
}
