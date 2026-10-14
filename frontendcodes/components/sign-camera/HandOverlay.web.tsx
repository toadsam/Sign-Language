import { publicAssetPath } from '../public-asset';
import { useEffect,useRef,useState } from 'react';
import type { RefObject } from 'react';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandFrame } from './hand-features';
import { loadVision } from './load-vision.web';
import { HAND_EDGES,fitPoint } from './hand-overlay';
type Props={input:RefObject<HTMLVideoElement|null>|RefObject<HTMLImageElement|null>;enabled:boolean;mirrored:boolean;onStatus:(status:string)=>void;onFrame:(frame:HandFrame|null)=>void};
export default function HandOverlay({input,enabled,mirrored,onStatus,onFrame}:Props){
  const canvas=useRef<HTMLCanvasElement>(null),status=useRef(onStatus);status.current=onStatus;
  const notify=useRef(onFrame);notify.current=onFrame;
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false,task:HandLandmarker|null=null,id=0,lastTime=-1,lastRun=0,lastStatus=0;
    const clear=()=>{const element=canvas.current;element?.getContext('2d')?.clearRect(0,0,element.width,element.height);};
    clear();notify.current(null);setError('');
    if(!enabled)return;
    status.current('손 추출 모델을 준비하고 있습니다…');
    const run=async()=>{
      try{
        const {FilesetResolver,HandLandmarker}=await loadVision();
        if(cancelled)return;
        const files=await FilesetResolver.forVisionTasks(publicAssetPath('hand-landmarker/wasm'));
        if(cancelled)return;
        const created=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:publicAssetPath('hand-landmarker/hand_landmarker.task'),delegate:'CPU'},runningMode:'VIDEO',numHands:2});
        if(cancelled){created.close();return;}task=created;
        status.current('손 추출 준비 완료');
        const tick=(now:number)=>{
          if(cancelled)return;
          if(document.hidden&&input.current instanceof HTMLVideoElement){id=requestAnimationFrame(tick);return;}
          const source=input.current,element=canvas.current;
          const isVideo=source instanceof HTMLVideoElement;
          const ready=source&&(isVideo?(source as HTMLVideoElement).readyState>=2:(source as HTMLImageElement).complete);
          const frameTime=isVideo?(source as HTMLVideoElement).currentTime:0;
          if(ready&&element&&now-lastRun>=1000/15&&frameTime!==lastTime){
            const sw=isVideo?(source as HTMLVideoElement).videoWidth:(source as HTMLImageElement).naturalWidth;
            const sh=isVideo?(source as HTMLVideoElement).videoHeight:(source as HTMLImageElement).naturalHeight;
            if(sw&&sh){
              try{
                const result=task!.detectForVideo(source!,now);lastTime=frameTime;lastRun=now;
                const width=element.clientWidth,height=element.clientHeight;element.width=width;element.height=height;
                const context=element.getContext('2d');
                if(context){context.clearRect(0,0,width,height);result.landmarks.forEach((hand,index)=>{context.strokeStyle=index===0?'#27c89a':'#ef9947';context.fillStyle=context.strokeStyle;context.lineWidth=2;
                  const points=hand.map(p=>fitPoint(p.x,p.y,sw,sh,width,height));
                  for(const [a,b] of HAND_EDGES){context.beginPath();context.moveTo(points[a].x,points[a].y);context.lineTo(points[b].x,points[b].y);context.stroke();}
                  for(const point of points){context.beginPath();context.arc(point.x,point.y,3,0,Math.PI*2);context.fill();}
                });}
                notify.current({timestampMs:now,width:sw,height:sh,hands:result.landmarks.map((points,index)=>({side:result.handedness[index]?.[0]?.categoryName??'Unknown',score:result.handedness[index]?.[0]?.score??0,points:points.map(p=>({x:p.x,y:p.y}))}))});if(now-lastStatus>500||!isVideo){status.current(result.landmarks.length?`손 ${result.landmarks.length}개 감지 · 손마다 21관절`:'손을 감지하지 못했습니다. 손 전체가 화면에 들어오도록 해주세요.');lastStatus=now;}
              }catch{setError('손 추출 중 오류가 발생했습니다. 손 추출을 껐다가 다시 켜주세요.');status.current('손 추출 중단');notify.current(null);clear();return;}
            }
          }
          id=requestAnimationFrame(tick);
        };
        if(input.current instanceof HTMLImageElement){await input.current.decode();if(!cancelled)tick(performance.now());}
        else id=requestAnimationFrame(tick);
      }catch(cause){console.error('Hand model initialization failed',cause);if(!cancelled){setError('손 추출 모델을 불러올 수 없습니다. 다시 켜주세요.');status.current('손 추출 준비 실패');}}
    };
    void run();return()=>{cancelled=true;cancelAnimationFrame(id);task?.close();notify.current(null);clear();};
  },[enabled,input]);
  return <><canvas ref={canvas} aria-label="추출된 손의 21관절 표시" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',transform:mirrored?'scaleX(-1)':'none'}}/>{error&&<p role="alert" style={{position:'absolute',top:0,left:0,background:'#111318',color:'#ffb3b3',padding:8}}>{error}</p>}</>;
}
