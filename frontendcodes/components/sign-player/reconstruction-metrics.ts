import type { DecodedMotion } from './motion';
const parts=[{key:'body',label:'몸',start:0,end:13},{key:'leftHand',label:'왼손',start:13,end:34},{key:'rightHand',label:'오른손',start:34,end:55},{key:'face',label:'얼굴',start:55,end:125}];
export function measureReconstruction(original:DecodedMotion,reconstructed:DecodedMotion){
  const a=original.response,b=reconstructed.response;
  if(a.frames!==b.frames||a.fps!==b.fps)throw new Error('프레임 수와 FPS가 같아야 수치 비교가 가능합니다. 시작 시점이 같은 파일을 선택하세요.');
  const sums=[0,0,0,0],frameMeans:number[]=[];
  let total=0,worstFrame=0,worstMean=-1;
  for(let frame=0;frame<a.frames;frame++){
    let frameSum=0;
    for(let part=0;part<parts.length;part++)for(let joint=parts[part].start;joint<parts[part].end;joint++){
      const offset=(frame*125+joint)*3;
      const distance=Math.hypot(original.positions[offset]-reconstructed.positions[offset],original.positions[offset+1]-reconstructed.positions[offset+1],original.positions[offset+2]-reconstructed.positions[offset+2]);
      sums[part]+=distance;frameSum+=distance;
    }
    const mean=frameSum/125;frameMeans.push(mean);total+=frameSum;
    if(mean>worstMean){worstMean=mean;worstFrame=frame;}
  }
  return {units:'shoulder' as const,frames:a.frames,fps:a.fps,meanJointDistance:total/(a.frames*125),
    parts:parts.map((p,i)=>({key:p.key,label:p.label,joints:p.end-p.start,meanJointDistance:sums[i]/(a.frames*(p.end-p.start))})),
    frameMeans,worstFrame,worstMean,worstTimeSeconds:worstFrame/a.fps};
}
