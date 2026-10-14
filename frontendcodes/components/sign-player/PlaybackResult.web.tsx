import { useEffect, useRef, useState } from 'react';
import type { PlaybackResponse, VideoResponse } from './playback';
import SignPlayer from './SignPlayer.web';
const control={background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit'};
function VideoPlayback({response}:{response:VideoResponse}) {
  const video=useRef<HTMLVideoElement>(null);
  const [speed,setSpeed]=useState(1), [loop,setLoop]=useState(false), [error,setError]=useState(''), [ready,setReady]=useState(false);
  useEffect(()=>{const element=video.current;return()=>{element?.pause();element?.removeAttribute('src');element?.load();};},[]);
  return <section aria-label="영상 응답 재생기" style={{background:'#111318',color:'#edf0fa',padding:20,borderRadius:16}}>
    <p>{response.demo?'화면 점검용 합성 영상입니다. 실제 수어 영상이 아닙니다.':'좌표 대신 제공된 영상입니다.'}</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
      <label>영상 속도 <select style={control} value={speed} onChange={e=>{const next=Number(e.target.value);setSpeed(next);if(video.current)video.current.playbackRate=next;}}>{[.25,.5,1,1.5,2].map(s=><option key={s} value={s}>{s}배</option>)}</select></label>
      <label><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/> 영상 반복</label>
      <button style={control} disabled={!ready} onClick={()=>{if(video.current){video.current.pause();video.current.currentTime=0;}}}>영상 처음으로</button>
    </div>
    <video ref={video} src={response.videoUrl} controls playsInline preload="metadata" loop={loop} aria-label="응답 영상" style={{width:'100%',maxHeight:480,display:'block',marginTop:16,background:'#181b22',borderRadius:12}}
      onLoadedMetadata={()=>{setReady(true);setError('');if(video.current)video.current.playbackRate=speed;}}
      onError={()=>{setReady(false);setError('영상을 재생할 수 없습니다. 영상 주소 또는 브라우저가 지원하는 형식을 확인해주세요.');}}/>
    {!ready&&!error && <p role="status">영상 정보를 읽고 있습니다…</p>}
    {error && <div><p role="alert" style={{color:'#ffb3b3'}}>{error}</p><button style={control} onClick={()=>{setError('');setReady(false);video.current?.load();}}>영상 다시 불러오기</button></div>}
    <p style={{fontSize:13,color:'#adb7ca'}}>영상 아래 재생 버튼을 사용하세요. 시점 회전과 몸·손·얼굴 좌표 조절은 좌표 응답에서 사용할 수 있습니다.</p>
  </section>;
}
export default function PlaybackResult({response}:{response:PlaybackResponse}) {
  return response.source==='video' ? <VideoPlayback key={response.videoUrl} response={response}/> : <SignPlayer motion={response}/>;
}
