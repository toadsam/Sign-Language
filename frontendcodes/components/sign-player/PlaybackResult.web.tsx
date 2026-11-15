import { useEffect, useRef, useState } from 'react';
import { nextVideoIndex } from './playback';
import type { PlaybackResponse, VideoResponse } from './playback';
import SignPlayer from './SignPlayer.web';
const control={background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit'};
function VideoPlayback({response}:{response:VideoResponse}) {
  const video=useRef<HTMLVideoElement>(null);
  const [index,setIndex]=useState(0),[speed,setSpeed]=useState(1),[loop,setLoop]=useState(false);
  const [error,setError]=useState(''),[ready,setReady]=useState(false),[running,setRunning]=useState(false),[finished,setFinished]=useState(false);
  const current=response.items[index];
  const playable=response.items.some(item=>item.hasVideo);
  const select=(next:number,autoPlay=false)=>{setError('');setFinished(false);setRunning(autoPlay);if(next===index){if(video.current){video.current.pause();video.current.currentTime=0;if(autoPlay)void play(video.current);}return;}setReady(false);setIndex(next);};
  useEffect(()=>{const element=video.current;return()=>{element?.pause();element?.removeAttribute('src');element?.load();};},[index]);
  const play=async(element:HTMLVideoElement)=>{try{await element.play();}catch{if(video.current===element){setRunning(false);setError('재생을 시작할 수 없습니다. 재생 버튼을 다시 눌러주세요.');}}};
  return <section aria-label="영상 응답 재생기" style={{background:'#111318',color:'#edf0fa',padding:20,borderRadius:16}}>
    <p>{response.demo?'화면 점검용 합성 영상입니다. 실제 수어 영상이 아닙니다.':'좌표 대신 제공된 영상 목록입니다.'}</p>
    <p role="status">{response.items.length?`${index+1} / ${response.items.length} · ${current.word}`:'영상 목록이 비어 있습니다.'}{finished?' · 목록 재생 완료':''}</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
      <button style={control} disabled={!playable} onClick={()=>{
        if(running){video.current?.pause();setRunning(false);return;}
        const next=current?.hasVideo?index:nextVideoIndex(response.items,-1);
        if(next!==index){select(next,true);return;}
        setFinished(false);setError('');setRunning(true);if(video.current){if(video.current.ended)video.current.currentTime=0;void play(video.current);}
      }}>{running?'목록 일시정지':'목록 재생'}</button>
      <button style={control} disabled={index<=0} onClick={()=>select(index-1)}>이전 영상</button>
      <button style={control} disabled={index>=response.items.length-1} onClick={()=>select(index+1)}>다음 영상</button>
      <label>영상 속도 <select style={control} value={speed} onChange={e=>{const next=Number(e.target.value);setSpeed(next);if(video.current)video.current.playbackRate=next;}}>{[.25,.5,1,1.5,2].map(s=><option key={s} value={s}>{s}배</option>)}</select></label>
      <label><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/> 목록 반복</label>
      <button style={control} disabled={!ready} onClick={()=>{video.current?.pause();if(video.current)video.current.currentTime=0;setRunning(false);setFinished(false);}}>영상 처음으로</button>
    </div>
    <ol aria-label="영상 목록">{response.items.map((item,i)=><li key={i} style={{marginTop:8}}><button style={{...control,borderColor:i===index?'#62d7ba':'#495266'}} aria-current={i===index?'step':undefined} onClick={()=>select(i)}>{i+1}. {item.word}{item.hasVideo?'':' · 영상 없음'}</button></li>)}</ol>
    {current?.hasVideo?<video key={index} ref={video} src={current.url} controls playsInline preload="metadata" aria-label="응답 영상" style={{width:'100%',maxHeight:480,display:'block',marginTop:16,background:'#181b22',borderRadius:12}}
      onLoadedMetadata={e=>{setReady(true);setError('');e.currentTarget.playbackRate=speed;if(running)void play(e.currentTarget);}}
      onPlay={()=>{setRunning(true);setFinished(false);}}
      onPause={e=>{if(e.currentTarget===video.current&&!e.currentTarget.ended)setRunning(false);}}
      onEnded={()=>{const next=nextVideoIndex(response.items,index,loop);if(next<0){setRunning(false);setFinished(true);}else if(next===index){if(video.current){video.current.currentTime=0;void play(video.current);}}else select(next,true);}}
      onError={()=>{setReady(false);setRunning(false);setError('영상을 재생할 수 없습니다. 영상 주소 또는 브라우저가 지원하는 형식을 확인해주세요.');}}/>:<p>{current?'이 단어는 제공된 영상이 없습니다. 다음 항목을 선택하거나 목록 재생을 누르세요.':'제공된 영상이 없습니다.'}</p>}
    {current?.hasVideo&&!ready&&!error&&<p role="status">영상 정보를 읽고 있습니다…</p>}
    {error&&<div><p role="alert" style={{color:'#ffb3b3'}}>{error}</p><button style={control} onClick={()=>{setError('');setReady(false);setRunning(false);video.current?.load();}}>영상 다시 불러오기</button></div>}
    <p style={{fontSize:13,color:'#adb7ca'}}>영상이 없는 단어는 목록에 남기고 순차 재생에서 건너뜁니다. 파일 재생 오류가 나면 멈춥니다. 시점 회전과 좌표 조절은 좌표 응답에서 사용할 수 있습니다.</p>
  </section>;
}
export default function PlaybackResult({response}:{response:PlaybackResponse}) {
  return response.source==='video'?<VideoPlayback key={JSON.stringify(response.items)} response={response}/>:<SignPlayer motion={response}/>;
}
