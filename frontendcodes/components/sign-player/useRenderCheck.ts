import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeRendering } from './performance';
import type { RenderSample } from './performance';
export function useRenderCheck() {
  const active=useRef(false), started=useRef(0), samples=useRef<RenderSample[][]>([]), timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const [running,setRunning]=useState(false),[seconds,setSeconds]=useState(0),[report,setReport]=useState<string|null>(null),[notice,setNotice]=useState('');
  const stop=useCallback(()=>{active.current=false;if(timer.current)clearInterval(timer.current);timer.current=null;setRunning(false);},[]);
  const cancel=useCallback(()=>{const wasActive=active.current;stop();if(wasActive)setNotice('점검을 취소했습니다.');},[stop]);
  useEffect(()=>{const hidden=()=>{if(document.hidden&&active.current)cancel();};document.addEventListener('visibilitychange',hidden);return()=>{active.current=false;if(timer.current)clearInterval(timer.current);document.removeEventListener('visibilitychange',hidden);};},[cancel]);
  const start=(labels:string[], metadata:Record<string,unknown>, prepare:()=>void)=>{
    if(active.current)return;
    setReport(null);setNotice('');setSeconds(0);samples.current=labels.map(()=>[]);started.current=performance.now();active.current=true;setRunning(true);prepare();
    timer.current=setInterval(()=>{
      const elapsed=performance.now()-started.current;setSeconds(Math.min(10,elapsed/1000));
      if(elapsed>=10000){
        stop();setReport(JSON.stringify({measuredAt:new Date().toISOString(),durationSeconds:elapsed/1000,...metadata,userAgent:navigator.userAgent,viewport:{width:window.innerWidth,height:window.innerHeight,pixelRatio:window.devicePixelRatio},panes:labels.map((label,i)=>({label,...summarizeRendering(samples.current[i],elapsed)})),note:'프레임 갱신 횟수이며 화면 표시 FPS나 GPU 완료 시간을 보장하지 않습니다.'},null,2));
      }
    },250);
  };
  const record=(index:number,sample:RenderSample)=>{if(active.current && samples.current[index])samples.current[index].push(sample);};
  return {running,seconds,report,notice,start,record,cancel};
}
export type RenderCheck=ReturnType<typeof useRenderCheck>;
