import type { RenderCheck } from './useRenderCheck';
export default function PerformanceCheck({check,onStart,disabled=false}:{check:RenderCheck;onStart:()=>void;disabled?:boolean}) {
  const save=()=>{if(!check.report)return;const url=URL.createObjectURL(new Blob([check.report],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='render-check-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const results=check.report?JSON.parse(check.report) as {panes:{label:string;updatesPerSecond:number;meanCpuMs:number;p95CpuMs:number}[]}:null;
  return <details style={{background:'#111318',color:'#edf0fa',padding:14,borderRadius:12,marginTop:16}}>
    <summary>재생 성능 점검</summary>
    <p style={{fontSize:13,color:'#adb7ca'}}>처음부터 1배속으로 10초 동안 점검합니다. 탭을 열어두고 재생 조건을 유지해주세요. 짧은 동작의 마지막 자세 유지 구간은 갱신 횟수를 낮춥니다.</p>
    <button disabled={disabled||check.running} onClick={onStart}>10초 점검 시작</button>{' '}{check.running&&<button onClick={check.cancel}>점검 취소</button>}
    <p role="status">{check.running?`점검 중… ${check.seconds.toFixed(1)} / 10초`:check.notice}</p>
    {results&&<><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>동작</th><th>갱신/초</th><th>평균 CPU(ms)</th><th>95% CPU(ms)</th></tr></thead><tbody>{results.panes.map((p,i)=><tr key={i}><td>{p.label}</td><td>{p.updatesPerSecond.toFixed(1)}</td><td>{p.meanCpuMs.toFixed(2)}</td><td>{p.p95CpuMs.toFixed(2)}</td></tr>)}</tbody></table><button onClick={save}>점검 결과 저장</button></>}
    <p style={{fontSize:13,color:'#adb7ca'}}>CPU 시간은 좌표 갱신부터 그리기 요청까지입니다. 실제 화면 표시 FPS·GPU 시간 측정이나 30fps 목표 통과 판정은 아닙니다. 합성 여부와 재생 조건을 저장합니다.</p>
  </details>;
}
