import type { RenderCheck } from './useRenderCheck';
type Results={environment:{development:boolean};browserCadence:{callbacksPerSecond:number;p95GapMs:number};panes:{label:string;updatesPerSecond:number;meanCpuMs:number;p95CpuMs:number;samplingStatus:string;updateCadence:{p95GapMs:number;maxGapMs:number;delayedIntervals:number}}[]};
export default function PerformanceCheck({check,onStart,disabled=false}:{check:RenderCheck;onStart:()=>void;disabled?:boolean}) {
  const save=()=>{if(!check.report)return;const url=URL.createObjectURL(new Blob([check.report],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='render-check-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const results=check.report?JSON.parse(check.report) as Results:null;
  return <details style={{background:'#111318',color:'#edf0fa',padding:14,borderRadius:12,marginTop:16}}>
    <summary>재생 성능 점검</summary>
    <p style={{fontSize:13,color:'#adb7ca'}}>처음부터 1배속으로 10초 동안 점검합니다. 탭을 열고 창 크기·배율을 유지해주세요. 탭 숨김이나 창 크기 변경 시 취소합니다. 짧은 비교 동작의 마지막 자세 유지 구간은 갱신 횟수를 낮춥니다.</p>
    <button disabled={disabled||check.running} onClick={onStart}>10초 점검 시작</button>{' '}{check.running&&<button onClick={check.cancel}>점검 취소</button>}
    <p role="status">{check.running?`점검 중… ${check.seconds.toFixed(1)} / 10초`:check.notice}</p>
    {results&&<><p>{results.environment.development?'개발 빌드 측정 · 배포 빌드에서도 다시 확인하세요.':'배포 빌드 측정'} rAF 콜백: {results.browserCadence.callbacksPerSecond.toFixed(1)}회/초 · 간격 p95 {results.browserCadence.p95GapMs.toFixed(1)}ms</p>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>동작</th><th>갱신/초</th><th>평균 CPU(ms)</th><th>95% CPU(ms)</th><th>갱신 간격 p95(ms)</th><th>최대 간격(ms)</th><th>50ms 초과</th><th>표본</th></tr></thead><tbody>{results.panes.map((p,i)=><tr key={i}><td>{p.label}</td><td>{p.updatesPerSecond.toFixed(1)}</td><td>{p.meanCpuMs.toFixed(2)}</td><td>{p.p95CpuMs.toFixed(2)}</td><td>{p.updateCadence.p95GapMs.toFixed(1)}</td><td>{p.updateCadence.maxGapMs.toFixed(1)}</td><td>{p.updateCadence.delayedIntervals}</td><td>{p.samplingStatus==='recorded'?'수집됨':p.samplingStatus==='partial'?'일부 구간':'부족'}</td></tr>)}</tbody></table></div><button onClick={save}>점검 결과 저장</button></>}
    <p style={{fontSize:13,color:'#adb7ca'}}>CPU 시간은 좌표 갱신부터 그리기 요청까지입니다. rAF 콜백과 동작 갱신 간격은 실제 화면 표시 FPS·GPU 시간이 아닙니다. 30fps 통과를 자동 판정하지 않습니다. 일부 구간/부족 표본은 동작 길이와 WebGL 상태를 확인하고 다시 측정하세요.</p>
  </details>;
}
