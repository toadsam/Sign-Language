import type { MotionResult } from '@/lib/api/generate';

/**
 * AI 동작 결과를 화면 한 줄로.
 * 실패는 배포된 앱에서도 늘 알린다. 2026-11-24 승혁: 예전에는 주소를 따로 정해 두지 않은 앱(= 배포판)에서
 * 실패를 조용히 넘겨, AI 서버(VM)가 꺼져 있으면 1학기 영상이 AI 손짓인 것처럼 보였다.
 * 설계서 IT-08 "자동 영상 대체 0"에 맞춰, 영상으로 바꿔 보여 줄 때는 그 까닭을 밝힌다.
 * 자세한 오류 문구는 주소를 따로 정한 개발 · 시험 환경(explicit)에서만 붙인다.
 */
export function motionNoteFor(m: MotionResult, explicit: boolean): string | null {
  if (m.kind === 'motion') return m.unknown.length > 0 ? `AI가 그린 손짓이에요 · 못 그린 낱말: ${m.unknown.join(', ')}` : 'AI가 그린 손짓이에요';
  if (m.kind === 'empty') return `AI가 그릴 수 있는 낱말이 없어서 영상으로 보여 줘요${m.unknown.length > 0 ? ` (${m.unknown.join(', ')})` : ''}`;
  if (m.kind === 'error') {
    if (explicit) return `AI 손짓을 받지 못해 영상으로 보여 줘요 · ${m.message}`;
    return m.retryable
      ? '지금은 AI 손짓을 받지 못해 1학기 수어 영상으로 보여 줘요 · 잠시 뒤 다시 해 보세요'
      : '지금은 AI 손짓을 받지 못해 1학기 수어 영상으로 보여 줘요';
  }
  return null;
}
