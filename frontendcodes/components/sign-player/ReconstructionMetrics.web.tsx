import { useEffect,useMemo,useState } from 'react';
import type { DecodedMotion } from './motion';
import { measureReconstruction } from './reconstruction-metrics';
import { createReconstructionReport } from './reconstruction-report';
const cell={padding:8,textAlign:'left' as const,borderBottom:'1px solid #495266'};
export default function ReconstructionMetrics({original,reconstructed,inputNames,disabled,onSeek}:{original:DecodedMotion;reconstructed:DecodedMotion;inputNames:[string,string];disabled:boolean;onSeek:(seconds:number)=>void}){
  const result=useMemo(()=>{try{return {value:measureReconstruction(original,reconstructed),error:''};}catch(e){return {value:null,error:e instanceof Error?e.message:'계산할 수 없습니다.'};}},[original,reconstructed]);
  const stats=result.value;
  const [saveError,setSaveError]=useState('');
  useEffect(()=>setSaveError(''),[original,reconstructed]);
  const save=()=>{
    let url:string|undefined;
    try{
      setSaveError('');
      const report=createReconstructionReport(original,reconstructed,inputNames,new Date().toISOString());
      url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`reconstruction-report-${Date.now()}.json`;
      document.body.appendChild(link);try{link.click();}finally{link.remove();}
    }catch{setSaveError('보고서 저장을 시작하지 못했습니다. 다시 시도해주세요.');}
    finally{if(url){const allocated=url;setTimeout(()=>URL.revokeObjectURL(allocated),1000);}}
  };
  return <section aria-label="원본 복원 좌표 차이" style={{padding:16,marginTop:16,background:'#111318',borderRadius:12}}>
    <h3>원본·복원 좌표 차이</h3>
    {!stats?<p role="status">{result.error} 재생 비교는 계속 사용할 수 있습니다.</p>:<>
      <p>전체 평균 관절 거리: <strong>{stats.meanJointDistance.toFixed(6)}</strong> · 어깨너비 단위</p>
      <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={cell}>부위</th><th style={cell}>관절 수</th><th style={cell}>평균 거리</th></tr></thead><tbody>{stats.parts.map(part=><tr key={part.key}><td style={cell}>{part.label}</td><td style={cell}>{part.joints}</td><td style={cell}>{part.meanJointDistance.toFixed(6)}</td></tr>)}</tbody></table>
      <p>전체 평균 차이가 가장 큰 프레임: {stats.worstFrame} · {stats.worstTimeSeconds.toFixed(3)}초 · 평균 {stats.worstMean.toFixed(6)}</p>
      <button disabled={disabled} onClick={()=>onSeek(stats.worstTimeSeconds)}>최대 차이 시각 근처로 이동</button>
      {' '}<button disabled={disabled} onClick={save}>비교 보고서 JSON 저장</button>
      <p style={{fontSize:13,color:'#adb7ca'}}>입력 이름, 부위별 평균 거리와 프레임별 전체 평균 차이를 저장합니다. 좌표 파일과 함께 보관하세요.</p>
      {saveError&&<p role="alert" style={{color:'#ffb3b3'}}>{saveError}</p>}
      {(original.response.demo||reconstructed.response.demo)&&<p>합성 샘플이 포함된 점검 수치입니다. 실제 모델 성능 평가가 아닙니다.</p>}
    </>}
    <p style={{fontSize:13,color:'#adb7ca'}}>같은 프레임 번호의 3차원 관절 간 유클리드 거리 평균입니다. 시작 시점·관절 순서·정규화가 같아야 의미가 있습니다. 결측 관절 마스크가 없어 모든 관절을 포함하며, mm 오차나 수어 인식 정확도가 아닙니다. 시점 회전과 부위 숨김은 계산에 영향을 주지 않습니다. 프레임 번호는 0부터이며 이동은 30Hz 공통 타임라인의 가까운 시각을 사용합니다.</p>
  </section>;
}
