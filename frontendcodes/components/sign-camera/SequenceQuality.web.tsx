import { useMemo,useState } from 'react';
import type { HandSequenceData } from './sequence-reader';
import { summarizeHandSequence } from './sequence-quality';
import { createQualityReport } from './quality-report';
const button={background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'7px 10px',font:'inherit'};
const cell={padding:8,textAlign:'left' as const,borderBottom:'1px solid #495266'};
export default function SequenceQuality({data,inputFilename,onSeek}:{data:HandSequenceData;inputFilename:string;onSeek:(timeMs:number)=>void}){
  const quality=useMemo(()=>summarizeHandSequence(data),[data]);
  const [saveError,setSaveError]=useState('');
  const save=()=>{
    let url:string|undefined;
    try{
      setSaveError('');
      const report=createQualityReport(data,inputFilename,new Date().toISOString());
      url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;
      const stem=inputFilename.replace(/\.json$/i,'').replace(/[^\p{L}\p{N}._-]/gu,'_').slice(0,100)||'hand-sequence';
      link.download=`${stem}-quality.json`;document.body.appendChild(link);
      try{link.click();}finally{link.remove();}
    }catch{setSaveError('보고서 저장을 시작하지 못했습니다. 다시 시도해주세요.');}
    finally{if(url){const allocated=url;setTimeout(()=>URL.revokeObjectURL(allocated),1000);}}
  };
  const ms=(value:number|null)=>value===null?'계산 불가':`${value.toFixed(1)}ms`;
  return <section aria-label="손 좌표 수집 품질" style={{marginTop:20,padding:16,background:'#181b22',borderRadius:12}}>
    <h3 style={{marginTop:0}}>수집 품질 점검</h3>
    <button style={button} onClick={save}>품질 보고서 JSON 저장</button>
    {saveError&&<p role="alert" style={{color:'#ffb3b3'}}>{saveError}</p>}
    <p style={{fontSize:13,color:'#adb7ca'}}>파일 이름과 아래 통계를 저장합니다. 좌표 JSON과 함께 보관하세요.</p>
    <p>관측 추출 속도: {quality.observedSamplingHz===null?'계산 불가 (표본 1개)':`${quality.observedSamplingHz.toFixed(2)}회/초`} · 추출 간격 중앙값: {ms(quality.medianIntervalMs)} · 최대: {ms(quality.maxIntervalMs)}</p>
    <p>첫 추출까지 {ms(quality.initialWaitMs)} · 마지막 추출부터 수집 종료까지 {ms(quality.tailMs)}</p>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
      <caption style={{textAlign:'left'}}>손별 미감지 표본</caption>
      <thead><tr><th style={cell}>슬롯</th><th style={cell}>미감지 비율</th><th style={cell}>최장 연속 미감지</th><th style={cell}>확인</th></tr></thead>
      <tbody>{quality.hands.map((hand,side)=>{const run=hand.longestMissingRun;return <tr key={hand.side}>
        <td style={cell}>{side===0?'왼손':'오른손'}</td><td style={cell}>{hand.missing} / {quality.frames} ({hand.missingPercent.toFixed(1)}%)</td>
        <td style={cell}>{run?`${run.count}표본 · ${run.startFrame+1}~${run.endFrame+1}프레임`:'없음'}</td>
        <td style={cell}>{run?<button style={button} onClick={()=>onSeek(data.timestampsMs[run.startFrame])}>{side===0?'왼손':'오른손'} 미감지 시작으로</button>:'—'}</td>
      </tr>;})}</tbody>
    </table></div>
    <h4>추출 간격이 긴 구간 (최대 5개)</h4>
    {quality.largestGaps.length?<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{quality.largestGaps.map(gap=><button key={gap.fromFrame} style={button} onClick={()=>onSeek(gap.startMs)}>
      {gap.fromFrame+1}→{gap.toFrame+1}프레임 · {gap.intervalMs.toFixed(1)}ms
    </button>)}</div>:<p>표본이 1개여서 추출 간격을 계산할 수 없습니다.</p>}
    <p style={{fontSize:13,color:'#adb7ca'}}>구간 버튼을 누르면 해당 시작 좌표로 이동하고 재생을 멈춥니다. 간격은 저장된 추출 시각의 차이이며 영상 FPS가 아닙니다. 미감지 비율은 표본 수 기준이며 실제 미감지 시간이나 인식 정확도를 뜻하지 않습니다. 한 손만 사용하는 동작도 있으므로 합격·불합격으로 판정하지 않습니다.</p>
  </section>;
}
