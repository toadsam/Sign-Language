import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { decodeMotion } from './motion';
import type { SignPlayerProps } from './SignPlayer';
import RecordingControls from './RecordingControls';
import { useCanvasRecorder } from './useCanvasRecorder';
import PerformanceCheck from './PerformanceCheck';
import { useRenderCheck } from './useRenderCheck';
import MotionCanvas from './MotionCanvas.web';

const control: CSSProperties = {background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit'};
function FrameInput({label,value,min,max,onCommit}:{label:string;value:number;min:number;max:number;onCommit:(n:number)=>void}) {
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value]);
  const commit=()=>{const n=Number(draft);if(draft.trim() && Number.isInteger(n) && n>=min && n<=max)onCommit(n);else setDraft(String(value));};
  return <input aria-label={label} type="number" min={min} max={max} value={draft} style={{...control,width:85}}
    onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>;
}

export default function SignPlayer({motion}: SignPlayerProps) {
  const parsed=useMemo(()=>{try{return {value:decodeMotion(motion),error:null};}catch(e){return {value:null,error:e instanceof Error?e.message:'동작을 읽을 수 없습니다.'};}},[motion]);
  const check=useRenderCheck();
  const recorder=useCanvasRecorder();
  const {active:recordingActive,stop:stopRecording,cancel:cancelRecording}=recorder;
  const {cancel:cancelCheck}=check;
  const canvas=useRef<HTMLCanvasElement|null>(null);
  const cursor=useRef(0);
  const [frame,setFrame]=useState(0), [playing,setPlaying]=useState(false), [speed,setSpeed]=useState(1);
  const [yaw,setYaw]=useState(0), [pitch,setPitch]=useState(0);
  const [showBody,setShowBody]=useState(true), [showHands,setShowHands]=useState(true), [showFace,setShowFace]=useState(false);
  const [loopStart,setLoopStart]=useState(0), [loopEnd,setLoopEnd]=useState(0);
  const data=parsed.value;

  useEffect(()=>{cancelCheck();cancelRecording();cursor.current=0;setFrame(0);setPlaying(false);setLoopStart(0);setLoopEnd(data?data.response.frames-1:0);},[data,cancelCheck,cancelRecording]);
  useEffect(()=>{
    if(!data || !playing)return;
    let id=0, last:number|undefined;
    const tick=(now:number)=>{
      const dt=last===undefined?0:Math.min((now-last)/1000,.1);last=now;
      cursor.current+=dt*data.response.fps*speed;
      if(recordingActive.current && cursor.current>=data.response.frames){cursor.current=data.response.frames-1;setFrame(data.response.frames-1);setPlaying(false);stopRecording(true);return;}
      const length=loopEnd-loopStart+1;
      if(cursor.current>=loopEnd+1)cursor.current=loopStart+(cursor.current-loopStart)%length;
      setFrame(Math.floor(cursor.current));id=requestAnimationFrame(tick);
    };
    id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
  },[data,playing,speed,loopStart,loopEnd,recordingActive,stopRecording]);



  if(!data)return <p role="alert">{parsed.error}</p>;
  const last=data.response.frames-1;
  const seek=(n:number)=>{cursor.current=n;setFrame(n);setPlaying(false);};
  const segment=data.response.segments.find(s=>frame>=s.start&&frame<s.end);
  return <section aria-label="수어 동작 재생기" style={{background:'#111318',color:'#edf0fa',borderRadius:16,padding:20,fontFamily:'system-ui,sans-serif'}}>
    <fieldset disabled={recorder.busy||check.running} style={{border:0,padding:0,margin:0}}><div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center'}}>
      <button style={control} aria-pressed={playing} onClick={()=>{if(frame<loopStart||frame>loopEnd){cursor.current=loopStart;setFrame(loopStart);}setPlaying(!playing);}}>{playing?'일시정지':'재생'}</button>
      <button style={control} onClick={()=>seek(loopStart)}>처음으로</button>
      <label>속도 <select style={control} value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.25,.5,1,1.5,2].map(s=><option key={s} value={s}>{s}배</option>)}</select></label>
      <label>시점 <select style={control} value={Math.abs(pitch)>.1?'top':yaw===Math.PI/2?'side':yaw===0?'front':'custom'} onChange={e=>{const v=e.target.value;setYaw(v==='side'?Math.PI/2:0);setPitch(v==='top'?-Math.PI/2:0);}}><option value="front">정면</option><option value="side">측면</option><option value="top">위</option><option value="custom" disabled>자유 시점</option></select></label>
      <label><input type="checkbox" checked={showBody} onChange={e=>setShowBody(e.target.checked)}/> 몸</label>
      <label><input type="checkbox" checked={showHands} onChange={e=>setShowHands(e.target.checked)}/> 손</label>
      <label><input type="checkbox" checked={showFace} onChange={e=>setShowFace(e.target.checked)}/> 얼굴 좌표</label>
    </div>
    </fieldset>
    <MotionCanvas data={data} frame={frame} yaw={yaw} pitch={pitch} showBody={showBody} showHands={showHands} showFace={showFace} onRenderSample={sample=>check.record(0,sample)} onCanvasReady={c=>{canvas.current=c;}} onViewChange={(y,p)=>{if(!recorder.busy&&!check.running){setYaw(y);setPitch(p);}}}/>
    <fieldset disabled={recorder.busy||check.running} style={{border:0,padding:0,margin:0}}><label style={{display:'flex',gap:12,alignItems:'center',marginTop:16}}>프레임 <input aria-label="프레임" type="range" min={0} max={last} value={Math.min(frame,last)} onChange={e=>seek(Number(e.target.value))} style={{flex:1}}/><output>{Math.min(frame,last)} / {last}</output></label>
    <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center',marginTop:16}}>
      <label>반복 시작 <FrameInput label="반복 시작" min={0} max={loopEnd} value={loopStart} onCommit={n=>{setLoopStart(n);seek(n);}}/></label>
      <label>반복 끝 <FrameInput label="반복 끝" min={loopStart} max={last} value={loopEnd} onCommit={n=>{setLoopEnd(n);seek(loopStart);}}/></label>
      <button style={control} onClick={()=>{setLoopStart(0);setLoopEnd(last);seek(0);}}>전체 구간</button>
    </div>
    </fieldset>
    <PerformanceCheck check={check} disabled={recorder.busy} onStart={()=>check.start(['단일 동작'],{demo:!!data.response.demo,source:data.response.source,fps:data.response.fps,frames:data.response.frames,yaw,pitch,showBody,showHands,showFace},()=>{seek(0);setSpeed(1);setLoopStart(0);setLoopEnd(last);setPlaying(true);})}/>
    <RecordingControls disabled={check.running} recorder={recorder} onStop={()=>{setPlaying(false);recorder.stop();}} onStart={()=>void recorder.start(canvas.current,{source:data.response.source,demo:!!data.response.demo,fps:data.response.fps,frames:data.response.frames,yaw,pitch,showBody,showHands,showFace},()=>{seek(0);setSpeed(1);setLoopStart(0);setLoopEnd(last);},()=>setPlaying(true))}/>
    <p aria-label="현재 자막" style={{minHeight:24,textAlign:'center',fontSize:20}}>{segment?.gloss??'자막 없는 구간'}</p>
    <p style={{color:'#adb7ca',fontSize:13}}>그림을 끌어서 돌려보세요. 왼손은 민트색, 오른손은 주황색입니다.</p>
  </section>;
}
