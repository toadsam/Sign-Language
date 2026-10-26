import {useEffect,useMemo,useRef,useState} from 'react';
import {atlasPreviewFrame,atlasTokens} from './token-atlas';
import type {AtlasSort,TokenAtlas} from './token-atlas';

const control={background:'#232935',color:'#edf0fa',border:'1px solid #68748b',borderRadius:8,padding:'10px 12px',font:'inherit'};
const PAGE_SIZE=12;
function AtlasCanvas({atlas,token,frame,height=220}:{atlas:TokenAtlas;token:number;frame:number;height?:number}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const node=canvas.current;if(!node)return;
    const ctx=node.getContext('2d');if(!ctx)return;
    const points=atlas.x[token][frame],w=node.width,h=node.height,scale=w/(2*atlas.lim);
    ctx.fillStyle='#111318';ctx.fillRect(0,0,w,h);ctx.lineWidth=2;ctx.lineCap='round';
    for(const [a,b] of atlas.edges){
      ctx.strokeStyle=b<atlas.body?'#b3c7e6':b<atlas.lhand?'#80d7ba':'#f3b176';
      ctx.beginPath();ctx.moveTo(w/2+points[a][0]*scale,h*.32+points[a][1]*scale);
      ctx.lineTo(w/2+points[b][0]*scale,h*.32+points[b][1]*scale);ctx.stroke();
    }
  },[atlas,token,frame]);
  return <canvas ref={canvas} width={440} height={440} role="img" aria-label={`2D 토큰 ${token}, 프레임 ${frame}`} style={{display:'block',width:'100%',maxWidth:height,height:'auto',margin:'12px auto',background:'#111318',borderRadius:8}}/>;
}
export default function TokenAtlasView({atlas}:{atlas:TokenAtlas}){
  const [query,setQuery]=useState(''),[sort,setSort]=useState<AtlasSort>('use'),[hideRest,setHideRest]=useState(false);
  const [page,setPage]=useState(0),[selected,setSelected]=useState<number|null>(null);
  const [playing,setPlaying]=useState(true),[speed,setSpeed]=useState(1),[frame,setFrame]=useState(0);
  const step=useRef(0);
  const tokens=useMemo(()=>atlasTokens(atlas,query,sort,hideRest),[atlas,query,sort,hideRest]);
  const pages=Math.max(1,Math.ceil(tokens.length/PAGE_SIZE)),currentPage=Math.min(page,pages-1);
  const visible=tokens.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  useEffect(()=>{
    if(!playing)return;
    const id=setInterval(()=>{step.current++;setFrame(atlasPreviewFrame(step.current));},110/speed);
    return()=>clearInterval(id);
  },[playing,speed]);
  const reset=()=>{step.current=0;setFrame(0);};
  const changeFilters=()=>{setPage(0);setSelected(null);};
  return <section aria-label="2D 토큰 atlas">
    <p style={{padding:14,background:'#e7f4ed',borderRadius:12}}>불러온 디코더 토큰 좌표 · {atlas.n}개 · 4프레임 · 상체와 양손 55관절 · 2D</p>
    <p>깊이와 얼굴 정보가 없는 자료입니다. 단어 목록은 토큰의 사용 통계이며 인식 결과가 아닙니다.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center'}}>
      <button style={control} onClick={()=>setPlaying(!playing)}>{playing?'격자 일시정지':'격자 재생'}</button>
      <button style={control} onClick={reset}>처음으로</button>
      <label>미리보기 속도 <select style={control} value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.25,.5,1,2].map(v=><option key={v} value={v}>{v}배</option>)}</select></label>
      <label>정렬 <select style={control} value={sort} onChange={e=>{setSort(e.target.value as AtlasSort);changeFilters();}}><option value="use">많이 쓰는 순</option><option value="id">번호 순</option><option value="hand">손 높이 순</option><option value="move">움직임 큰 순</option></select></label>
      <label>토큰 번호·단어 검색 <input style={{...control,width:150,maxWidth:'100%',boxSizing:'border-box'}} value={query} onChange={e=>{setQuery(e.target.value);changeFilters();}}/></label>
      <label><input type="checkbox" checked={hideRest} onChange={e=>{setHideRest(e.target.checked);changeFilters();}}/> 대기 토큰 숨기기</label>
    </div>
    <p>원본 격자와 같은 느린 왕복 미리보기입니다(1배: 110ms마다 0→1→2→3→2→1). 원래 동작의 FPS 측정값이 아닙니다.</p>
    <label>프레임 {frame} / 3 <input type="range" min={0} max={3} step={1} value={frame} onChange={e=>{const value=Number(e.target.value);setPlaying(false);step.current=value;setFrame(value);}}/></label>
    <p role="status">{tokens.length}개 검색 결과 · {currentPage+1} / {pages}페이지</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:12}}>
      {visible.map(token=><article key={token} aria-label={`2D 토큰 ${token}`} style={{background:'#111318',color:'#edf0fa',borderRadius:14,padding:14,minWidth:0}}>
        <strong>토큰 #{token}</strong> · {atlas.use[token].toLocaleString()}회
        <AtlasCanvas atlas={atlas} token={token} frame={frame}/>
        <p>{atlas.rest[token]?'대기·공통 토큰':atlas.words[token].slice(0,2).map(w=>w[0]).join(' · ')||'관련 단어 없음'}</p>
        <button style={control} aria-expanded={selected===token} onClick={()=>setSelected(selected===token?null:token)}>{selected===token?'상세 닫기':`토큰 ${token} 자세히 보기`}</button>
        {selected===token&&<section aria-label={`토큰 ${token} 사용 통계`} style={{marginTop:12,borderTop:'1px solid #68748b'}}>
          <h3>토큰 #{token} 사용 통계</h3>
          <p>단어 클립 {atlas.useWord[token].toLocaleString()} · 문장 클립 {atlas.useSen[token].toLocaleString()}</p>
          <p>단어 클립 포함 비율: {Math.round(atlas.share[token]*100)}%</p>
          <p>관련 단어별 클립 중 이 토큰이 나오는 비율:</p>
          {atlas.words[token].length?<ul>{atlas.words[token].map(([word,ratio],i)=><li key={i}>{word}: {Math.round(ratio*100)}%</li>)}</ul>:<p>관련 단어 정보가 없습니다.</p>}
        </section>}
      </article>)}
    </div>
    {!tokens.length&&<p>검색 조건에 맞는 토큰이 없습니다.</p>}
    <div style={{display:'flex',flexWrap:'wrap',gap:12,marginTop:16}}>
      <button style={control} disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setSelected(null);}}>이전 페이지</button>
      <button style={control} disabled={currentPage+1>=pages} onClick={()=>{setPage(currentPage+1);setSelected(null);}}>다음 페이지</button>
    </div>
  </section>;
}
