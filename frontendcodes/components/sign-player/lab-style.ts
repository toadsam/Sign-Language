import type { CSSProperties } from 'react';

/**
 * 작업실(재생 · 비교 · 생성 · 녹화 · 카메라 실습) 화면에서 같이 쓰는 어두운 버튼 · 입력칸 모양.
 * 2026-11-24 승혁: 8개 파일에 똑같이 복사돼 있던 것을 한곳으로 모았다. 모양을 바꾸려면 여기만 고친다.
 * TokenAtlas · AiViewerImport는 테두리 · 여백이 달라 각자 둔다.
 */
export const control: CSSProperties = {
  background: '#232935',
  color: '#edf0fa',
  border: '1px solid #495266',
  borderRadius: 8,
  padding: '8px 12px',
  font: 'inherit',
};
