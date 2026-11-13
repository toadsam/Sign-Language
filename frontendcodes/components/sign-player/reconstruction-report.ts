import type { DecodedMotion } from './motion';
import { measureReconstruction } from './reconstruction-metrics';

export function createReconstructionReport(original:DecodedMotion,reconstructed:DecodedMotion,names:[string,string],createdAt:string){
  const describe=(motion:DecodedMotion,name:string)=>({name,source:motion.response.source,
    demo:motion.response.demo===true,frames:motion.response.frames,fps:motion.response.fps,
    joints:motion.response.joints,units:motion.response.units});
  return {schema:'signlingo-reconstruction-report-v1',createdAt,
    inputs:{original:describe(original,names[0]),reconstructed:describe(reconstructed,names[1])},
    method:{distance:'euclidean-3d',aggregation:'mean over all paired frames and joints',
      units:'shoulder',frameIndexBase:0,frameMeansIndex:'original frame index',
      missingMaskAvailable:false,automaticAlignment:false,scope:'full clip, all 125 joints',
      notes:[
        '같은 프레임 번호의 관절 좌표를 비교하며 시작 시점과 정규화의 일치는 별도로 확인해야 합니다.',
        '결측 마스크가 없어 모든 관절을 포함합니다. 화면의 시점 회전과 부위 숨김은 계산에 영향을 주지 않습니다.',
        '최대 차이가 같은 경우 첫 프레임을 선택합니다.',
        '어깨너비 기준 좌표 거리이며 mm 오차, 단어 인식 정확도, 자동 합격 판정이 아닙니다.',
        '원본 좌표는 포함하지 않습니다. 입력 파일과 함께 보관하세요.',
      ]},
    metrics:measureReconstruction(original,reconstructed)};
}
