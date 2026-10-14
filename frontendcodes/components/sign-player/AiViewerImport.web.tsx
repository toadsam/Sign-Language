import { useEffect,useRef,useState } from 'react';
import { readAiViewer,decodeAiViewerPair } from './ai-viewer';
import type { AiViewer } from './ai-viewer';
import type { DecodedMotion } from './motion';
const control={background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:8,font:'inherit'};
export default function AiViewerImport({disabled,onBusy,onPair}:{disabled:boolean;onBusy:(busy:boolean)=>void;onPair:(pair:[DecodedMotion,DecodedMotion],name:string)=>void}){
  const [viewer,setViewer]=useState<AiViewer|null>(null),[name,setName]=useState(''),[index,setIndex]=useState(0),[demo,setDemo]=useState(true),[error,setError]=useState(''),[loading,setLoading]=useState(false),[notice,setNotice]=useState('');
  const version=useRef(0);useEffect(()=>()=>{version.current++;},[]);
  const load=async(file:File|undefined)=>{
    if(!file)return;const request=++version.current;setLoading(true);onBusy(true);setError('');setNotice('');
    try{if(file.size>40000000)throw new Error('40MB 이하 viewer.html을 선택해주세요.');const next=readAiViewer(await file.text());if(version.current!==request)return;setViewer(next);setName(file.name);setIndex(0);setDemo(true);}
    catch(e){if(version.current===request)setError(e instanceof Error?e.message:'파일을 읽을 수 없습니다.');}
    finally{if(version.current===request){setLoading(false);onBusy(false);}}
  };
  const apply=()=>{if(!viewer)return;try{const pair=decodeAiViewerPair(viewer,index,demo);onPair(pair,`${name} · 클립 ${index} (${String(viewer.clips[index].name??'이름 없음')})`);setError('');setNotice('원본과 복원을 함께 불러왔습니다.');}catch(e){setError(e instanceof Error?e.message:'좌표 변환 실패');}};
  return <fieldset disabled={disabled||loading} style={{padding:16,marginBottom:16,border:'1px solid #495266',borderRadius:12,background:'#111318'}}>
    <legend>AI 팀 viewer.html 불러오기</legend>
    <label>학습 결과 HTML <input aria-label="AI 팀 viewer HTML" type="file" accept=".html,text/html" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void load(file);}}/></label>
    {loading&&<p role="status">데이터를 읽고 있습니다…</p>}
    {viewer&&<div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',marginTop:12}}>
      <label>클립 <select aria-label="AI 결과 클립" style={control} value={index} onChange={e=>setIndex(Number(e.target.value))}>{viewer.clips.map((clip,i)=><option key={i} value={i}>{i}: {String(clip.name??'이름 없음')} · {String(clip.split??'')} · {String(clip.frames)}프레임</option>)}</select></label>
      <label><input type="checkbox" checked={demo} onChange={e=>setDemo(e.target.checked)}/> 합성 시험 파일로 표시</label>
      <button style={control} onClick={apply}>선택한 클립 불러오기</button>
    </div>}
    {error&&<p role="alert" style={{color:'#ffb3b3'}}>{error} 기존 비교 동작은 유지합니다.</p>}
    {notice&&<p role="status">{notice}</p>}
    <p style={{fontSize:13,color:'#adb7ca'}}>HTML의 JSON 데이터만 읽으며 스크립트는 실행하지 않습니다. 실제 학습 결과인 경우 합성 표시를 해제하세요. 자막이나 시작 시점 정렬은 생성하지 않습니다.</p>
  </fieldset>;
}
