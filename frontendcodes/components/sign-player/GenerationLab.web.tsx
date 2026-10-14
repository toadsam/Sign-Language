import { useEffect, useRef, useState } from 'react';
import PlaybackResult from './PlaybackResult.web';
import { generateMockMotion, validateGenerationText } from './mock-generation';
import type { MockScenario } from './mock-generation';
import type { PlaybackResponse } from './playback';
const control={background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit'};
export default function GenerationLab() {
  const [text,setText]=useState('안녕하세요 반갑습니다'), [scenario,setScenario]=useState<MockScenario>('success');
  const [loading,setLoading]=useState(false), [error,setError]=useState(''), [status,setStatus]=useState('');
  const [result,setResult]=useState<{text:string;motion:PlaybackResponse}|null>(null);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const submit=async()=>{
    let input:string;
    try{input=validateGenerationText(text);}catch(e){setError(e instanceof Error?e.message:'입력을 확인해주세요.');return;}
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError('');setStatus('');setResult(null);
    try{
      // Replace this call with the agreed API adapter during team integration.
      const motion=await generateMockMotion(input,scenario,controller.signal);
      if(request.current!==controller||controller.signal.aborted)return;
      setResult({text:input,motion});setStatus('샘플 응답을 준비했습니다. 아래 재생 버튼을 눌러주세요.');
    }catch(e){
      if(request.current!==controller||controller.signal.aborted)return;
      setError(e instanceof Error?e.message:'응답을 읽을 수 없습니다.');
    }finally{if(request.current===controller){request.current=null;setLoading(false);}}
  };
  const cancel=()=>{request.current?.abort();request.current=null;setLoading(false);setStatus('샘플 요청을 취소했습니다.');};
  return <section aria-label="문장 입력 실습" style={{fontFamily:'system-ui,sans-serif',color:'#152239'}}>
    <p style={{padding:14,borderRadius:12,background:'#fff4dc',color:'#754b16'}}>샘플 응답으로 화면을 점검하는 실습입니다. 입력한 문장을 실제 수어로 변환하지 않습니다. 모든 문장에 같은 합성 동작을 표시하며 서버에 전송하지 않습니다.</p>
    <form onSubmit={e=>{e.preventDefault();void submit();}} style={{background:'#fff',padding:20,borderRadius:14}}>
      <label htmlFor="generation-text">입력할 문장</label>
      <textarea id="generation-text" disabled={loading} value={text} onChange={e=>{setText(e.target.value);setError('');}} rows={3} style={{display:'block',width:'100%',boxSizing:'border-box',font:'inherit',padding:12,marginTop:8,border:'1px solid #8794aa',borderRadius:8}}/>
      <p style={{fontSize:13,color:'#526078'}}>200자 이하 · {Array.from(text.trim()).length}자</p>
      <label>점검할 응답 <select style={control} disabled={loading} value={scenario} onChange={e=>setScenario(e.target.value as MockScenario)}><option value="success">정상 샘플</option><option value="unknown">미지원 단어 안내 샘플</option><option value="error">실패 안내 샘플</option><option value="video">영상 응답 샘플</option><option value="video-error">영상 재생 실패 샘플</option></select></label>{' '}
      <button style={control} type="submit" disabled={loading}>{loading?'샘플 준비 중…':'샘플 동작 보기'}</button>{' '}
      {loading && <button style={control} type="button" onClick={cancel}>요청 취소</button>}
      {error && <p role="alert" style={{color:'#b42318'}}>{error}</p>}
      <p role="status" style={{color:'#526078',minHeight:20}}>{loading?'샘플 응답을 기다리고 있습니다…':status}</p>
    </form>
    {result && <div style={{marginTop:20}}>
      <h3>입력 문장: {result.text}</h3>
      {result.motion.source==='video' ? <p>영상 응답 샘플 · 합성 동작을 녹화한 영상입니다.</p> : <p>화면 점검용 합성 동작 · {result.motion.frames}프레임 · {result.motion.fps}fps. 자막은 수어 뜻이 아닌 샘플 구간 표시입니다.</p>}
      {result.motion.unknown.length>0 && <p role="status" style={{padding:12,background:'#fff4dc',color:'#754b16'}}>미지원 단어 안내 점검: {result.motion.unknown.join(', ')}. 이 목록은 입력 문장을 분석한 결과가 아닙니다.</p>}
      <PlaybackResult response={result.motion}/>
    </div>}
  </section>;
}
