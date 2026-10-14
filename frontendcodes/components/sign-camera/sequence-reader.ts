export type HandSequenceData={schema:'signlingo-hand-sequence-v1';shape:number[];durationMs:number;timestampsMs:number[];features:number[];masks:number[][];source?:string};
export function decodeHandSequence(value:unknown):HandSequenceData{
  if(!value||typeof value!=='object')throw new Error('손 좌표 수집 객체가 필요합니다.');
  const r=value as HandSequenceData;
  if(r.schema!=='signlingo-hand-sequence-v1'||!Array.isArray(r.shape)||r.shape.length!==4||r.shape.slice(1).join(',')!=='2,21,2'||!Number.isInteger(r.shape[0])||r.shape[0]<1||r.shape[0]>1500)throw new Error('손 좌표 수집 형식 [T,2,21,2]이 필요합니다.');
  const count=r.shape[0];
  if(!Number.isFinite(r.durationMs)||r.durationMs<=0||r.durationMs>60000)throw new Error('수집 시간이 올바르지 않습니다.');
  if(!Array.isArray(r.timestampsMs)||r.timestampsMs.length!==count||r.timestampsMs.some((t,i)=>!Number.isFinite(t)||t<0||t>r.durationMs||(i>0&&t<=r.timestampsMs[i-1])))throw new Error('프레임 시간이 증가하는 순서로 필요합니다.');
  if(!Array.isArray(r.features)||r.features.length!==count*84||r.features.some(n=>!Number.isFinite(n)||Math.abs(n)>1000000))throw new Error('좌표 길이 또는 숫자가 올바르지 않습니다.');
  if(!Array.isArray(r.masks)||r.masks.length!==count||r.masks.some(m=>!Array.isArray(m)||m.length!==2||m.some(n=>n!==0&&n!==1)))throw new Error('프레임별 손 존재 마스크가 필요합니다.');
  for(let f=0;f<count;f++)for(let side=0;side<2;side++)if(!r.masks[f][side]&&r.features.slice(f*84+side*42,f*84+side*42+42).some(n=>n!==0))throw new Error('미감지 손의 좌표는 0이어야 합니다.');
  return {schema:r.schema,shape:[count,2,21,2],durationMs:r.durationMs,timestampsMs:r.timestampsMs,features:r.features,masks:r.masks,source:typeof r.source==='string'?r.source:undefined};
}
export function handFrameAtTime(timestamps:number[],timeMs:number):number{
  let low=0,high=timestamps.length;
  while(low<high){const mid=Math.floor((low+high)/2);if(timestamps[mid]<=timeMs)low=mid+1;else high=mid;}
  return low-1;
}
