import type { PlaybackResponse } from './playback';
export function summarizeResponse(response: PlaybackResponse): { facts: string[]; notices: string[] } {
  const notices: string[] = [];
  if (response.demo) notices.push('합성 시험 자료입니다. 실제 수어 정확도를 확인한 결과가 아닙니다.');
  if (response.source === 'video') {
    const playable = response.items.filter(item => item.hasVideo).length;
    if (!playable) notices.push('재생 가능한 영상이 없습니다.');
    notices.push('영상 파일의 접근 권한과 재생 가능 여부는 실제 재생으로 확인해야 합니다.');
    return { facts: [`응답 출처: 영상`, `영상 목록: ${response.items.length}개 · 영상 있음 ${playable}개 · 영상 없음 ${response.items.length-playable}개`, `미지원 단어: ${response.unknown.length}개`], notices };
  }
  const count = response.tokens.length;
  if (!response.frames) notices.push('모든 단어가 미지원이어서 재생할 동작이 없습니다.');
  else if (!count) notices.push('토큰 정보가 없습니다. 좌표는 재생할 수 있지만 현재 토큰 번호는 표시되지 않습니다.');
  if (count) notices.push('토큰은 4프레임 단위의 참고 표시입니다. 단어 연결 시 프레임이 조정되므로 프레임 수와 토큰 수×4가 달라도 오류는 아닙니다. 정확한 토큰·프레임 정렬은 제공되지 않았습니다.');
  notices.push('형식 검사를 통과했습니다. 실제 수어 정확도와 토큰 버전의 일치는 별도 확인이 필요합니다.');
  return { facts: [`응답 출처: ${response.source === 'model' ? '모델' : '기준선'}`, `동작 길이: ${response.frames}프레임 · ${response.fps}fps · ${(response.frames/response.fps).toFixed(2)}초`, `좌표: ${response.joints}관절 · 어깨너비 단위`, `토큰: ${count}개 · 자막 구간: ${response.segments.length}개 · 미지원 단어: ${response.unknown.length}개`], notices };
}
