import { publicAssetPath } from '../public-asset';
import { useEffect,useRef,useState } from 'react';
import { router } from 'expo-router';
import { prepareSequenceReview } from './sequence-transfer';
import HandSequenceControls from './HandSequenceControls';
import { useHandSequence } from './useHandSequence';
import HandInputPreview from './HandInputPreview';
import type { HandFrame } from './hand-features';
import HandOverlay from './HandOverlay.web';
import { CameraSession,cameraError } from './camera-session';
const control={background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit'};
export default function CameraLab(){
  const capture=useHandSequence();
  const [localVideo,setLocalVideo]=useState<{url:string;name:string}|null>(null),[localDuration,setLocalDuration]=useState<number|null>(null);
  const [handFrame,setHandFrame]=useState<HandFrame|null>(null);
  const video=useRef<HTMLVideoElement>(null), sample=useRef<HTMLVideoElement>(null);
  const photo=useRef<HTMLImageElement>(null);
  const [photoMode,setPhotoMode]=useState(false),[tracking,setTracking]=useState(false),[handStatus,setHandStatus]=useState('손 추출 꺼짐');
  const session=useRef<CameraSession|null>(null), mounted=useRef(true);
  const [stream,setStream]=useState<MediaStream|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[testMode,setTestMode]=useState(false),[mirrored,setMirrored]=useState(true),[size,setSize]=useState('');
  useEffect(()=>()=>{if(localVideo)URL.revokeObjectURL(localVideo.url);},[localVideo]);
  if(!session.current)session.current=new CameraSession(()=>navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:30}}}));
  useEffect(()=>{mounted.current=true;const hidden=()=>{if(document.hidden){session.current?.stop();setStream(null);setPending(false);setTracking(false);setHandStatus('손 추출 꺼짐');sample.current?.pause();}};document.addEventListener('visibilitychange',hidden);return()=>{mounted.current=false;session.current?.stop();document.removeEventListener('visibilitychange',hidden);};},[]);
  useEffect(()=>{
    const element=video.current;if(!element)return;
    element.srcObject=stream;
    if(stream)void element.play().catch(()=>{if(mounted.current&&session.current?.current===stream)setError('미리보기를 시작하지 못했습니다. 카메라를 껐다가 다시 켜주세요.');});
    const ended=()=>{if(session.current?.current===stream){session.current.stop();setStream(null);setError('카메라 연결이 중단됐습니다. 다시 켜주세요.');}};
    stream?.getVideoTracks().forEach(track=>track.addEventListener('ended',ended));
    return()=>{stream?.getVideoTracks().forEach(track=>track.removeEventListener('ended',ended));element.pause();element.srcObject=null;};
  },[stream]);
  const stop=()=>{capture.reset();sample.current?.pause();setHandFrame(null);session.current?.stop();setStream(null);setPending(false);setTestMode(false);setPhotoMode(false);setLocalVideo(null);setLocalDuration(null);setTracking(false);setHandStatus('손 추출 꺼짐');setSize('');setError('');};
  const start=async()=>{
    if(pending||stream)return;
    if(!window.isSecureContext){setError('카메라 입력은 HTTPS 또는 localhost에서 열어주세요.');return;}
    if(!navigator.mediaDevices?.getUserMedia){setError('이 브라우저에서는 카메라 입력을 지원하지 않습니다.');return;}
    stop();setPending(true);
    try{const next=await session.current!.start();if(mounted.current&&next){setStream(next);setPending(false);}}
    catch(e){if(mounted.current){setError(cameraError(e));setPending(false);}}
  };
  const loadLocalVideo=(file:File|undefined)=>{
    if(!file)return;
    if(file.size>200*1024*1024){setError('200MB 이하 영상을 선택해주세요.');return;}
    if(!file.type.startsWith('video/')&&!/\.(mp4|webm|mov)$/i.test(file.name)){setError('MP4, WebM 또는 MOV 영상을 선택해주세요.');return;}
    const url=URL.createObjectURL(file);stop();setLocalVideo({url,name:file.name});
  };
  const recordedInput=testMode||!!localVideo;
  const review=()=>{
    if(!capture.json)return;
    try{prepareSequenceReview(capture.json,`hand-sequence-${Date.now()}.json`);sample.current?.pause();router.push('/sign-hand-review');}
    catch(e){setError(e instanceof Error?e.message:'좌표 결과를 열 수 없습니다. JSON 저장 후 다시 불러와주세요.');}
  };
  const displayMirrored=photoMode||!!stream||!!localVideo?mirrored:false;
  return <section aria-label="웹캠 입력 실습" style={{fontFamily:'system-ui,sans-serif',color:'#edf0fa',background:'#111318',padding:20,borderRadius:16}}>
    <p style={{background:'#fff4dc',color:'#754b16',padding:14,borderRadius:10}}>카메라 입력과 손 관절 추출을 점검하는 화면입니다. 수어 단어 인식 모델은 아직 연결하지 않았습니다.</p>
    <p>카메라 켜기를 누르면 브라우저가 권한을 요청할 수 있습니다. 영상은 이 화면에서만 미리보며 저장하거나 서버로 전송하지 않습니다.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center'}}>
      <button style={control} disabled={capture.running||pending||!!stream} onClick={()=>void start()}>카메라 켜기</button>
      <button style={control} disabled={!pending&&!stream&&!testMode&&!photoMode&&!localVideo} onClick={stop}>{pending?'카메라 요청 취소':localVideo?'영상 닫기':'카메라 끄기'}</button>
      <button style={control} disabled={capture.running||pending} onClick={()=>{stop();setTestMode(true);}}>카메라 없이 화면 점검</button>
      <button style={control} disabled={capture.running||pending} onClick={()=>{stop();setPhotoMode(true);}}>손 추출 점검 사진</button>
      <label>내 영상 불러오기 <input aria-label="내 손 영상" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" disabled={capture.running||pending} onChange={e=>{const file=e.target.files?.[0];e.target.value='';loadLocalVideo(file);}}/></label>
      <label><input type="checkbox" disabled={capture.running||(!stream&&!testMode&&!photoMode&&!localVideo)} checked={tracking} onChange={e=>{setTracking(e.target.checked);if(!e.target.checked)setHandStatus('손 추출 꺼짐');}}/> 손 21관절 표시</label>
      <label><input type="checkbox" disabled={capture.running} checked={mirrored} onChange={e=>setMirrored(e.target.checked)}/> 카메라 좌우 반전</label>
    </div>
    <p role="status">{pending?'카메라 권한과 연결을 기다리고 있습니다…':stream?'카메라 연결됨':localVideo?`로컬 영상: ${localVideo.name} · 브라우저 안에서만 처리합니다.`:testMode?'공개 손 사진으로 만든 점검 영상입니다. 실제 수어 동작이나 카메라 입력이 아닙니다.':photoMode?'점검용 손 사진 · 카메라를 사용하지 않습니다.':'카메라 꺼짐'}{size?' · '+size:''}</p>
    {localVideo&&localDuration!==null&&localDuration<5&&<p role="status">영상이 {localDuration.toFixed(2)}초입니다. 관절 표시는 가능하지만 5초 수집에는 5초 이상 영상이 필요합니다.</p>}
    {error&&<p role="alert" style={{color:'#ffb3b3'}}>{error}</p>}
    <p role="status">{handStatus}</p>
    <div style={{position:'relative'}}>
    {photoMode?<img ref={photo} src={publicAssetPath('hand-landmarker/test-hands.jpg')} alt="공개 손 추출 점검 사진" style={{display:'block',width:'100%',maxHeight:420,objectFit:'contain',transform:mirrored?'scaleX(-1)':'none'}}/>:recordedInput?<video key={localVideo?.url??'test-video'} ref={sample} src={localVideo?.url??publicAssetPath('hand-landmarker/test-hands.mp4')} controls={!capture.running} muted playsInline preload="metadata" aria-label={localVideo?'불러온 로컬 손 영상':'카메라 없는 점검용 합성 영상'} style={{width:'100%',maxHeight:420,background:'#181b22',borderRadius:12,display:'block',transform:displayMirrored?'scaleX(-1)':'none'}}
        onLoadedMetadata={()=>{const element=sample.current;if(element){setSize(`${element.videoWidth} × ${element.videoHeight}`);if(localVideo)setLocalDuration(Number.isFinite(element.duration)?element.duration:0);}}}
        onError={()=>{capture.cancel();setTracking(false);setError('영상을 재생할 수 없습니다. 브라우저가 지원하는 MP4 또는 WebM 파일을 선택해주세요.');}}
        onEnded={()=>{if(capture.running)capture.cancel();}}
        onPause={()=>{if(capture.running)capture.cancel();}}/>

      :<video ref={video} muted playsInline aria-label="웹캠 미리보기" style={{display:stream?'block':'none',width:'100%',maxHeight:420,background:'#181b22',borderRadius:12,transform:mirrored?'scaleX(-1)':'none'}} onLoadedMetadata={()=>{if(video.current)setSize(`${video.current.videoWidth} × ${video.current.videoHeight}`);}}/>}
    <HandOverlay input={photoMode?photo:recordedInput?sample:video} enabled={tracking&&(!!stream||recordedInput||photoMode)} mirrored={displayMirrored} onStatus={setHandStatus} onFrame={frame=>{setHandFrame(frame);capture.add(frame);}}/>
    </div>
    <HandSequenceControls capture={capture} enabled={tracking&&!!handFrame&&(!!stream||testMode||(!!localVideo&&localDuration!==null&&localDuration>=5))} photoMode={photoMode} onReview={review} onStart={()=>capture.start(localVideo?'local-video':testMode?'synthetic-test-video':'camera',displayMirrored,()=>{if(recordedInput&&sample.current){sample.current.currentTime=0;void sample.current.play().catch(()=>capture.cancel());}})}/>
    <HandInputPreview frame={handFrame} source={photoMode?'public-test-photo':localVideo?'local-video':testMode?'synthetic-test-video':'camera'} mirrored={displayMirrored}/>
    <p style={{fontSize:13,color:'#adb7ca'}}>손 추출은 브라우저에서 처리하며 최대 초당 15회로 제한합니다. 수어 뜻을 판별하지 않습니다. 사진 모드는 공개 점검용 사진을 사용합니다.</p>
    {!stream&&!testMode&&!photoMode&&!localVideo&&!pending&&<p style={{padding:40,textAlign:'center',background:'#181b22',borderRadius:12}}>카메라를 켜거나 점검 영상 또는 내 영상을 선택하세요.</p>}
    <p style={{fontSize:13,color:'#adb7ca'}}>불러온 영상은 서버로 전송하지 않습니다. 좌표 수집은 영상 처음부터 5초간 진행하며, 영상을 반복하지 않습니다. 탭을 숨기거나 이 화면을 떠나면 카메라 입력을 중단합니다. 좌우 반전은 화면 표시만 바꿉니다.</p>
  </section>;
}
