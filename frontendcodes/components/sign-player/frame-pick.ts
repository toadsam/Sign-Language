/**
 * 재생 커서(소수 프레임)에서 이번 화면에 보일 동작 프레임을 고른다.
 *
 * 2026-11-24 승혁: 예전에는 Math.floor(cursor)로 골랐다. 30fps 동작을 60Hz 화면에서 틀면 커서가 화면마다 0.5씩 늘어
 * 정수 경계(1.0, 2.0, …)에 정확히 닿는다. 그러면 1ms도 안 되는 시간 흔들림으로 0.9999 / 1.0001이 갈려,
 * 어떤 장은 16.7ms · 어떤 장은 50ms 보였다(11/23 슬로모션: 236장 중 11장, 10초 점검: 50ms 넘는 간격 300번 중 16번).
 * 이번 화면의 이동량(step)의 절반만큼 앞당겨 고르면 커서가 경계 한가운데 오지 않아, 흔들림이 step/2보다 작으면 장마다 고르게 보인다.
 * 120Hz(step 0.25)나 2배속(step 1)에서도 같은 식이 맞는다. 시간 맞춤은 최대 step/2 프레임(60Hz에서 약 8ms) 앞당겨질 뿐이다.
 */
export function pickFrame(cursor: number, step: number, first: number, last: number): number {
  const lead = Math.min(Math.max(Number.isFinite(step) ? step : 0, 0), 1) / 2;
  const f = Math.max(first, Math.floor(cursor + lead));
  // 반복 구간 끝을 넘으면 처음으로 돈다. 되감기 경계도 같은 만큼 앞당겨야 마지막 장과 첫 장이 고르게 보인다
  return f > last ? first + ((f - first) % (last - first + 1)) : f;
}
