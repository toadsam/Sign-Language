import { useEffect, useMemo, useRef, useState } from 'react';
import MotionCanvas from './MotionCanvas.web';
import SignPlayer from './SignPlayer.web';
import { codebookFrame, decodeCodebook } from './codebook';
import demo from './demo-codebook.json';
import TokenAtlasView from './TokenAtlas.web';
import {readTokenAtlas} from './token-atlas';
import type {TokenAtlas} from './token-atlas';

const PAGE_SIZE = 6;
const control = { background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit' };
export default function CodebookGrid() {
  const [entries,setEntries]=useState(()=>decodeCodebook(demo));
  const [atlas,setAtlas]=useState<TokenAtlas|null>(null);
  const [name,setName]=useState('화면 점검용 코드북');
  const [query,setQuery]=useState(''), [page,setPage]=useState(0), [selected,setSelected]=useState<number|null>(null);
  const [playing,setPlaying]=useState(true), [speed,setSpeed]=useState(.25), [seconds,setSeconds]=useState(0);
  const [yaw,setYaw]=useState(0), [pitch,setPitch]=useState(0);
  const [loading,setLoading]=useState(false), [error,setError]=useState('');
  const clock=useRef(0), version=useRef(0);
  const filtered=useMemo(()=>entries.filter(e=>String(e.token).includes(query.trim())),[entries,query]);
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)), currentPage=Math.min(page,pages-1);
  const visible=filtered.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  const resetClock=()=>{clock.current=0;setSeconds(0);};
  useEffect(()=>()=>{version.current++;},[]);
  useEffect(()=>{
    if(!playing)return;
    let id=0,previous:number|undefined;
    const tick=(now:number)=>{const dt=previous===undefined?0:Math.min((now-previous)/1000,.1);previous=now;clock.current+=dt*speed;setSeconds(clock.current);id=requestAnimationFrame(tick);};
    id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
  },[playing,speed]);
  const load=async(file:File|undefined)=>{
    if(!file)return;
    const request=++version.current;setLoading(true);setError('');
    try{
      if(file.size>40000000)throw new Error('40MB 이하 JSON 또는 HTML을 선택해주세요.');
      const text=await file.text();
      const isHtml=/\.html?$/i.test(file.name)||text.trimStart().startsWith('<');
      const value=isHtml?null:JSON.parse(text);
      const nextAtlas=isHtml?readTokenAtlas(text):value&&typeof value==='object'&&'x' in value?readTokenAtlas(text):null;
      const next=nextAtlas?null:decodeCodebook(value);
      if(request!==version.current)return;
      if(next)setEntries(next);setAtlas(nextAtlas);if(nextAtlas)setPlaying(false);
      setName(file.name);setQuery('');setPage(0);setSelected(null);resetClock();
    }catch(e){if(request===version.current)setError(e instanceof Error?e.message:'불러오기 실패');}
    finally{if(request===version.current)setLoading(false);}
  };
  const fileInput=<label>코드북 JSON / 토큰 atlas HTML 열기 <input aria-label="코드북 파일 열기" type="file" accept=".json,.html,.htm,application/json,text/html" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void load(file);}}/></label>;
  if(atlas)return <section aria-label="코드북 격자" style={{fontFamily:'system-ui,sans-serif',color:'#152239'}}>
    {fileInput}<p>{loading?'읽는 중…':name}</p>
    {error&&<p role="alert" style={{color:'#b42318'}}>불러오기 실패: {error} 기존 코드북을 유지합니다.</p>}
    <button style={control} onClick={()=>{version.current++;setLoading(false);setError('');setAtlas(null);setEntries(decodeCodebook(demo));setName('화면 점검용 코드북');setQuery('');setPage(0);setSelected(null);resetClock();}}>합성 코드북으로 돌아가기</button>
    <TokenAtlasView key={name} atlas={atlas}/>
  </section>;
  return <section aria-label="코드북 격자" style={{fontFamily:'system-ui,sans-serif',color:'#152239'}}>
    <p style={{background:'#fff4dc',color:'#754b16',padding:14,borderRadius:12}}>기본 12개 토큰은 합성 동작에서 잘라낸 화면 점검용 샘플입니다. 학습된 코드북이나 실제 수어 의미를 나타내지 않습니다.</p>
    {fileInput}
    <p>{loading?'읽는 중…':name} · {entries.length}개 토큰 · 토큰당 4프레임</p>
    {error && <p role="alert" style={{color:'#b42318'}}>불러오기 실패: {error} 기존 코드북을 유지합니다.</p>}
    <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:12,background:'#111318',color:'#edf0fa',padding:16,borderRadius:14}}>
      <button style={control} onClick={()=>setPlaying(!playing)}>{playing?'격자 일시정지':'격자 재생'}</button>
      <button style={control} onClick={resetClock}>처음으로</button>
      <label>속도 <select style={control} value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.25,.5,1].map(s=><option key={s} value={s}>{s}배</option>)}</select></label>
      <label>시점 <select style={control} value={yaw===0&&pitch===0?'front':yaw===Math.PI/2&&pitch===0?'side':'custom'} onChange={e=>{setYaw(e.target.value==='side'?Math.PI/2:0);setPitch(0);}}><option value="front">정면</option><option value="side">측면</option><option value="custom" disabled>자유 시점</option></select></label>
      <label>토큰 번호 검색 <input style={{...control,width:100}} aria-label="토큰 번호 검색" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);resetClock();}}/></label>
    </div>
    <p style={{color:'#526078',fontSize:13}}>0~3번 프레임을 반복합니다. 각 토큰의 FPS를 따르며 기본 속도는 0.25배입니다. 그림을 끌면 모든 시점이 함께 바뀝니다.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))',gap:12}}>
      {visible.map(entry=>{const frame=codebookFrame(seconds,entry.motion.response.fps);return <article key={entry.token} aria-label={`토큰 ${entry.token}`} style={{background:'#111318',color:'#edf0fa',padding:14,borderRadius:14}}>
        <strong>토큰 #{entry.token}</strong> · {entry.motion.response.demo?'합성 샘플':'불러온 동작'}
        <MotionCanvas data={entry.motion} frame={frame} yaw={yaw} pitch={pitch} showBody showHands showFace={false} height={220} onViewChange={(y,p)=>{setYaw(y);setPitch(p);}}/>
        <p>프레임 {frame} / 3 · {entry.motion.response.fps}fps</p>
        <button style={control} aria-expanded={selected===entry.token} onClick={()=>{setSelected(entry.token);setPlaying(false);}}>토큰 {entry.token} 자세히 보기</button>
        {selected===entry.token && <section aria-label={`토큰 ${entry.token} 상세 재생`} style={{marginTop:16,borderTop:'1px solid #495266',paddingTop:12}}>
          <h3>토큰 #{entry.token} — 4프레임 자세히 보기</h3>
          <button style={control} onClick={()=>setSelected(null)}>상세 닫기</button>
          <SignPlayer key={entry.token} motion={entry.motion.response}/>
        </section>}
      </article>;})}
    </div>
    {!visible.length && <p role="status">검색한 토큰이 없습니다.</p>}
    <div style={{display:'flex',alignItems:'center',gap:12,marginTop:16}}>
      <button style={control} disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);resetClock();}}>이전 페이지</button>
      <span>{currentPage+1} / {pages}페이지 · {filtered.length}개 결과</span>
      <button style={control} disabled={currentPage+1>=pages} onClick={()=>{setPage(currentPage+1);resetClock();}}>다음 페이지</button>
      <button style={control} onClick={()=>{version.current++;setLoading(false);setError('');setEntries(decodeCodebook(demo));setName('화면 점검용 코드북');setQuery('');setPage(0);setSelected(null);resetClock();}}>합성 샘플로 초기화</button>
    </div>
  </section>;
}
