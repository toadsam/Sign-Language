import type { HandSequenceData } from './sequence-reader';
import { summarizeHandSequence } from './sequence-quality';

export function createQualityReport(data:HandSequenceData,inputFilename:string,createdAt:string){
  return {
    schema:'signlingo-hand-quality-report-v1',createdAt,
    input:{filename:inputFilename,schema:data.schema,source:data.source??null,
      shape:[...data.shape],durationMs:data.durationMs},
    conventions:{frameIndexBase:0,endFrameInclusive:true,timeUnit:'ms',
      missingRatioBasis:'sample-count',samplingRateBasis:'(frames-1)/(lastMs-firstMs)',
      handOrder:['Left','Right'],gapListLimit:5},
    quality:summarizeHandSequence(data),
    interpretation:{classificationConnected:false,automaticPassFail:false,
      notes:[
        '저장된 추출 시각을 기준으로 계산한 통계입니다.',
        '미감지 비율은 표본 수 기준이며 시간 비율이나 수어 인식 정확도가 아닙니다.',
        '관측 추출 속도는 영상 FPS가 아닙니다. 표본 1개는 속도와 간격을 null로 기록합니다.',
        '좌우 슬롯은 모델의 추정입니다. 한 손 동작의 미감지를 실패로 판정하지 않습니다.',
        '이 보고서는 원본 영상이나 손 좌표를 포함하지 않습니다. 좌표 JSON과 함께 보관하세요.',
      ]},
  };
}
