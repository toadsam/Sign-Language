import { useEffect,useMemo,useRef,useState } from 'react';
import { decodeHandSequence,handFrameAtTime } from './sequence-reader';
import type { HandSequenceData } from './sequence-reader';
import { HAND_EDGES } from './hand-overlay';
import SequenceQuality from './SequenceQuality.web';
import { takeSequenceReview } from './sequence-transfer';
const control={background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit'};
function HandCanvas({data,frame}:{data:HandSequenceData;frame:number}){
  const canvas=useRef<HTMLCanvasElement>(null),draw=useRef<(()=>void)|null>(null),current=useRef(frame);current.current=frame;
  const bounds=useMemo(()=>data.features.reduce((max,value)=>Math.max(max,Math.abs(value)),.5),[data]);
  useEffect(()=>{
    const element=canvas.current;if(!element)return;
    const render=()=>{
      const width=element.clientWidth,height=300;element.width=width*2;element.height=height*2;
      const ctx=element.getContext('2d');if(!ctx)return;ctx.scale(2,2);ctx.fillStyle='#181b22';ctx.fillRect(0,0,width,height);
      const scale=Math.min(width/4-22,height/2-32)/bounds,f=current.current;
      for(let side=0;side<2;side++){
        const origin={x:width*(side===0?.25:.75),y:height/2};ctx.fillStyle='#adb7ca';ctx.font='14px system-ui';ctx.fillText(side===0?'왼손 슬롯':'오른손 슬롯',origin.x-38,24);
        if(f<0||!data.masks[f][side]){ctx.fillText(f<0?'첫 추출 대기':'미감지',origin.x-25,origin.y);continue;}
        ctx.strokeStyle=side===0?'#27c89a':'#ef9947';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;
        const points=Array.from({length:21},(_,j)=>({x:origin.x+data.features[f*84+side*42+j*2]*scale,y:origin.y+data.features[f*84+side*42+j*2+1]*scale}));
        for(const [a,b] of HAND_EDGES){ctx.beginPath();ctx.moveTo(points[a].x,points[a].y);ctx.lineTo(points[b].x,points[b].y);ctx.stroke();}
        for(const p of points){ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();}
      }
    };
    draw.current=render;render();const observer=new ResizeObserver(render);observer.observe(element);
    return()=>{observer.disconnect();draw.current=null;};
  },[data,bounds]);
  useEffect(()=>draw.current?.(),[frame]);
  return <canvas ref={canvas} aria-label="저장된 좌우 손 자세" style={{width:'100%',height:300,display:'block',borderRadius:12}}/>;
}
export default function SequenceReview(){
  const [data,setData]=useState<HandSequenceData|null>(null),[name,setName]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[time,setTime]=useState(0);
  const [transferredJson,setTransferredJson]=useState<string|null>(null);
  const version=useRef(0),cursor=useRef(0);
  useEffect(()=>{const result=takeSequenceReview();if(result){setData(result.data);setName(result.name);setTransferredJson(result.json);}},[]);
  useEffect(()=>()=>{version.current++;},[]);
  useEffect(()=>{if(!data||!playing)return;let id=0,last:number|undefined;const tick=(now:number)=>{const dt=last===undefined?0:now-last;last=now;cursor.current=(cursor.current+dt*speed)%data.durationMs;setTime(cursor.current);id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[data,playing,speed]);
  const load=async(file:File|undefined)=>{if(!file)return;const request=++version.current;setLoading(true);setError('');try{if(file.size>5000000)throw new Error('5MB 이하 JSON을 선택해주세요.');const next=decodeHandSequence(JSON.parse(await file.text()));if(request!==version.current)return;setData(next);setName(file.name);setTransferredJson(null);setPlaying(false);cursor.current=0;setTime(0);}catch(e){if(request===version.current)setError(e instanceof Error?e.message:'읽을 수 없습니다.');}finally{if(request===version.current)setLoading(false);}};
  const saveTransferred=()=>{if(!transferredJson)return;const url=URL.createObjectURL(new Blob([transferredJson],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const frame=data?handFrameAtTime(data.timestampsMs,time):-1;
  const seek=(t:number)=>{cursor.current=t;setTime(t);setPlaying(false);};
  return <section style={{fontFamily:'system-ui,sans-serif',color:'#edf0fa',background:'#111318',padding:20,borderRadius:16}}>
    <label>손 좌표 수집 JSON <input aria-label="손 좌표 수집 JSON" type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void load(file);}}/></label>
    {loading&&<p role="status">파일을 읽고 있습니다…</p>}{error&&<p role="alert" style={{color:'#ffb3b3'}}>{error} 기존 데이터를 유지합니다.</p>}
    {!data?<p>앞 단계에서 저장한 hand-sequence JSON을 선택하세요.</p>:<><p>{name} · {data.shape[0]}프레임 · {(data.durationMs/1000).toFixed(2)}초 · 입력: {data.source??'미기록'}</p>
      {transferredJson&&<div><p>방금 수집한 좌표를 열었습니다. 새로고침하면 사라지므로 보관하려면 저장하세요.</p><button style={control} onClick={saveTransferred}>점검 중인 좌표 JSON 저장</button></div>}
      <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}><button style={control} onClick={()=>setPlaying(!playing)}>{playing?'좌표 일시정지':'좌표 재생'}</button><button style={control} onClick={()=>seek(0)}>처음으로</button><label>속도 <select style={control} value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.25,.5,1,2].map(s=><option key={s} value={s}>{s}배</option>)}</select></label></div>
      <HandCanvas data={data} frame={frame}/>
      <label>추출 프레임 <input aria-label="추출 프레임" type="range" min={0} max={data.shape[0]-1} value={Math.max(0,frame)} onChange={e=>seek(data.timestampsMs[Number(e.target.value)])} style={{width:'100%'}}/></label>
      <p role="status">{frame<0?'첫 추출 대기':`${frame+1} / ${data.shape[0]}프레임 · 마스크 [${data.masks[frame].join(', ')}]`} · {(time/1000).toFixed(2)}초</p>
      <p>미감지 표본: 왼손 {data.masks.filter(m=>m[0]===0).length} / 오른손 {data.masks.filter(m=>m[1]===0).length}</p>
      <SequenceQuality key={name} data={data} inputFilename={name} onSeek={seek}/>
    </>}
    <p style={{fontSize:13,color:'#adb7ca'}}>저장된 시간 순서로 재생하며 표본 사이에는 이전 좌표를 유지합니다. 정규화된 손 자세만 표시하므로 전체 손 위치 이동은 재현하지 않습니다. 좌우는 추출 모델의 추정이며 수어 인식 결과가 아닙니다.</p>
  </section>;
}
