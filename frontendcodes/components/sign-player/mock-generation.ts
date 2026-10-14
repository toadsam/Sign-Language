import { publicAssetPath } from '../public-asset';
import sample from './demo-motion.json';
import { decodeMotion } from './motion';
import { decodePlayback } from './playback';
import type { PlaybackResponse } from './playback';
import type { MotionResponse } from './motion';
export type MockScenario = 'success' | 'unknown' | 'error' | 'video' | 'video-error';
export function validateGenerationText(text: string): string {
  const value = text.trim();
  if (!value) throw new Error('문장을 입력해주세요.');
  if (Array.from(value).length > 200) throw new Error('문장은 200자 이하로 입력해주세요.');
  return value;
}
export function createMockGeneration(text: string, scenario: MockScenario): PlaybackResponse {
  validateGenerationText(text);
  if (scenario === 'error') throw new Error('화면 점검용 실패 응답입니다. 다시 시도해주세요.');
  if (scenario === 'video' || scenario === 'video-error') return decodePlayback({source:'video',videoUrl:publicAssetPath(scenario==='video'?'sign-demo.mp4':'missing-sign-demo.mp4'),unknown:[],demo:true});
  const response: MotionResponse = {
    ...(sample as MotionResponse), demo: true, tokens: [0, 1],
    segments: [{gloss:'샘플 구간 1',start:0,end:60},{gloss:'샘플 구간 2',start:60,end:120}],
    unknown: scenario === 'unknown' ? ['점검용 미지원 단어'] : [],
  };
  return decodeMotion(response).response;
}
export async function generateMockMotion(text: string, scenario: MockScenario, signal: AbortSignal): Promise<PlaybackResponse> {
  const value = validateGenerationText(text);
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('취소됐습니다.','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},600);
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
  return createMockGeneration(value,scenario);
}
