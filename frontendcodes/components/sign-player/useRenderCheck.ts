import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeCadence, summarizeRendering } from './performance';
import type { RenderSample } from './performance';
export function useRenderCheck() {
  const active=useRef(false),started=useRef(0),samples=useRef<RenderSample[][]>([]);
  const timer=useRef<ReturnType<typeof setInterval>|null>(null),raf=useRef<number|null>(null),heartbeats=useRef<number[]>([]);
  const [running,setRunning]=useState(false),[seconds,setSeconds]=useState(0),[report,setReport]=useState<string|null>(null),[notice,setNotice]=useState('');
  const stop=useCallback(()=>{active.current=false;if(timer.current!==null)clearInterval(timer.current);timer.current=null;if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;setRunning(false);},[]);
  const cancel=useCallback(()=>{const wasActive=active.current;stop();if(wasActive)setNotice('점검을 취소했습니다.');},[stop]);
  useEffect(()=>{const hidden=()=>{if(document.hidden&&active.current){cancel();setNotice('탭이 숨겨져 점검을 취소했습니다. 이 탭을 연 상태로 다시 시작해주세요.');}};document.addEventListener('visibilitychange',hidden);return()=>{active.current=false;if(timer.current!==null)clearInterval(timer.current);if(raf.current!==null)cancelAnimationFrame(raf.current);document.removeEventListener('visibilitychange',hidden);};},[cancel]);
  const start=(labels:string[],metadata:Record<string,unknown>,prepare:()=>void)=>{
    if(active.current)return;
    if(document.hidden){setNotice('이 탭을 연 상태에서 점검을 시작해주세요.');return;}
    const viewport={width:window.innerWidth,height:window.innerHeight,pixelRatio:window.devicePixelRatio};
    setReport(null);setNotice('');setSeconds(0);samples.current=labels.map(()=>[]);heartbeats.current=[];started.current=performance.now();active.current=true;setRunning(true);
    try{prepare();}catch{stop();setNotice('재생을 준비할 수 없어 점검을 취소했습니다.');return;}
    const heartbeat=(now:number)=>{if(!active.current)return;heartbeats.current.push(now);raf.current=requestAnimationFrame(heartbeat);};
    raf.current=requestAnimationFrame(heartbeat);
    timer.current=setInterval(()=>{
      if(viewport.width!==window.innerWidth||viewport.height!==window.innerHeight||viewport.pixelRatio!==window.devicePixelRatio){stop();setNotice('창 크기 또는 화면 배율이 바뀌어 점검을 취소했습니다. 같은 조건에서 다시 시작해주세요.');return;}
      const elapsed=performance.now()-started.current;setSeconds(Math.min(10,elapsed/1000));
      if(elapsed>=10000){
        stop();setNotice('측정을 마쳤습니다. 30fps 통과 판정은 별도입니다.');
        setReport(JSON.stringify({schemaVersion:2,...metadata,measuredAt:new Date().toISOString(),durationSeconds:elapsed/1000,environment:{userAgent:navigator.userAgent,viewport,development:__DEV__,visible:true},method:{targetFps:30,intervalDelayMultiplier:1.5,actualDisplayFpsMeasured:false,gpuTimeMeasured:false,automaticAcceptance:false},browserCadence:summarizeCadence(heartbeats.current,elapsed,30),panes:labels.map((label,i)=>({label,...summarizeRendering(samples.current[i],elapsed)})),note:'rAF 콜백과 좌표 그리기 요청 시점의 간격입니다. 화면 표시 FPS·GPU 완료 시간·수어 정확도를 보장하지 않습니다. partial/insufficient는 재측정이 필요합니다.'},null,2));
      }
    },250);
  };
  const record=(index:number,sample:RenderSample)=>{if(active.current&&samples.current[index])samples.current[index].push(sample);};
  return {running,seconds,report,notice,start,record,cancel};
}
export type RenderCheck=ReturnType<typeof useRenderCheck>;
