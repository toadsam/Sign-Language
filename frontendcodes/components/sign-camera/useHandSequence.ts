import { useCallback,useEffect,useRef,useState } from 'react';
import { HandSequence } from './hand-sequence';
import type { HandFrame } from './hand-features';
export function useHandSequence(){
  const buffer=useRef<HandSequence|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const [running,setRunning]=useState(false),[elapsed,setElapsed]=useState(0),[count,setCount]=useState(0),[notice,setNotice]=useState(''),[json,setJson]=useState<string|null>(null);
  const cleanup=useCallback(()=>{if(timer.current)clearInterval(timer.current);timer.current=null;buffer.current=null;},[]);
  const cancel=useCallback(()=>{if(buffer.current){cleanup();setRunning(false);setNotice('좌표 수집을 취소했습니다.');}},[cleanup]);
  const reset=()=>{cleanup();setRunning(false);setElapsed(0);setCount(0);setNotice('');setJson(null);};
  useEffect(()=>{const hidden=()=>{if(document.hidden)cancel();};document.addEventListener('visibilitychange',hidden);return()=>{cleanup();document.removeEventListener('visibilitychange',hidden);};},[cancel,cleanup]);
  const add=(frame:HandFrame|null)=>{if(!frame){cancel();return;}buffer.current?.add(frame);};
  const start=(source:string,mirrored:boolean,play:()=>void)=>{
    if(buffer.current)return;
    const next=new HandSequence(performance.now());buffer.current=next;setRunning(true);setCount(0);setElapsed(0);setJson(null);setNotice('');play();
    timer.current=setInterval(()=>{
      const time=performance.now()-next.startedMs;setElapsed(Math.min(5,time/1000));setCount(next.frames.length);
      if(time>=5000){cleanup();setRunning(false);if(!next.frames.length)setNotice('새 좌표가 없습니다. 손 추출과 영상 재생 상태를 확인해주세요.');else{setJson(JSON.stringify({...next.result(),source,previewMirrored:mirrored},null,2));setNotice(`${next.frames.length}프레임 수집 완료. 손 미감지 프레임도 마스크와 함께 저장됩니다.`);}}
    },100);
  };
  return {running,elapsed,count,notice,json,add,start,cancel,reset};
}
