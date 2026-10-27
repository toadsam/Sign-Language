import { useEffect,useRef,useState } from 'react';
import PlaybackResult from './PlaybackResult.web';
import { generateMockMotion } from './mock-generation';
import { validateGenerationText } from './generation-input';
import { generateFromApi } from './generate-api';
import type { MockScenario } from './mock-generation';
import type { PlaybackResponse } from './playback';
import { readResponseFile } from './response-file';
import { summarizeResponse } from './response-summary';
const control={background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit'};
type Mode='sample'|'local-api'|'api'|'file';
const localScenarios=[['success','정상 합성 응답'],['unknown','미지원 단어 안내'],['error','서버 오류 (503)'],['invalid','잘못된 좌표 응답'],['non-json','JSON 아닌 응답'],['slow','느린 응답 (3초)'],['video','영상 한 개 응답'],['video-list','영상 목록 응답'],['video-empty','빈 영상 목록'],['video-list-error','중간 영상 파일 오류']];
export default function GenerationLab(){
  const [text,setText]=useState('안녕하세요 반갑습니다'),[mode,setMode]=useState<Mode>('sample'),[scenario,setScenario]=useState('success');
  const [endpoint,setEndpoint]=useState('http://localhost:8080/api/sign/generate'),[timeout,setTimeoutSeconds]=useState(15);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const [result,setResult]=useState<{text:string;motion:PlaybackResponse;fileName?:string}|null>(null);
  const [fileBase,setFileBase]=useState(''),[selectedFile,setSelectedFile]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const submit=async()=>{
    let input:string;try{input=validateGenerationText(text);}catch(e){setError(e instanceof Error?e.message:'입력을 확인해주세요.');return;}
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError('');setStatus('');setResult(null);
    try{
      const motion=mode==='sample'?await generateMockMotion(input,scenario as MockScenario,controller.signal):await generateFromApi({text:input,endpoint:mode==='local-api'?`http://127.0.0.1:8085/api/sign/generate?scenario=${scenario}`:endpoint,signal:controller.signal,timeoutMs:timeout*1000});
      if(request.current!==controller||controller.signal.aborted)return;
      setResult({text:input,motion});setStatus(mode==='sample'?'화면 내부 샘플을 준비했습니다.':'API 응답을 받았습니다. 아래에서 재생하세요.');
    }catch(e){if(request.current!==controller||controller.signal.aborted)return;setError(e instanceof Error?e.message:'응답을 읽을 수 없습니다.');}
    finally{if(request.current===controller){request.current=null;setLoading(false);}}
  };
  const importResponse=async(file:File)=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError('');setStatus('');setSelectedFile(file.name);
    try{
      const motion=await readResponseFile(file,fileBase);
      if(request.current!==controller||controller.signal.aborted)return;
      setResult({text:'로컬 응답 파일',motion,fileName:file.name});
      setStatus(`불러온 파일: ${file.name} · ${file.size.toLocaleString()}바이트`);
    }catch(e){if(request.current!==controller||controller.signal.aborted)return;setError((e instanceof Error?e.message:'응답 파일을 읽을 수 없습니다.')+' 기존 재생 결과는 유지합니다.');}
    finally{if(request.current===controller){request.current=null;setLoading(false);}}
  };
  const cancel=()=>{request.current?.abort();request.current=null;setLoading(false);setStatus(mode==='file'?'파일 불러오기를 취소했습니다.':'요청을 취소했습니다.');};
  const changeMode=(next:Mode)=>{request.current?.abort();request.current=null;setLoading(false);setSelectedFile('');setMode(next);setScenario('success');setResult(null);setError('');setStatus('');};
  const inspection=result?.fileName?summarizeResponse(result.motion):null;
  return <section aria-label="문장 입력 실습" style={{fontFamily:'system-ui,sans-serif',color:'#152239'}}>
    <p style={{padding:14,borderRadius:12,background:'#fff4dc',color:'#754b16'}}>{mode==='file'?'응답 JSON을 로컬에서 읽습니다. API 요청은 보내지 않습니다. 영상 응답을 재생하면 해당 영상 주소에는 접속합니다.':mode==='sample'?'화면 내부 샘플입니다. 모든 문장에 같은 합성 동작을 표시하며 서버에 전송하지 않습니다.':mode==='local-api'?'로컬 목업 서버에 문장을 보내 HTTP 흐름을 점검합니다. 응답은 합성 시험 자료이며 실제 수어 생성이 아닙니다.':'입력 문장을 아래 지정한 API 주소로 전송합니다. 응답 좌표의 형식을 확인한 뒤 재생합니다.'}</p>
    <form onSubmit={e=>{e.preventDefault();if(mode!=='file')void submit();}} style={{background:'#fff',padding:20,borderRadius:14}}>
      <label>응답 방식 <select aria-label="생성 응답 방식" style={control} value={mode} disabled={loading} onChange={e=>changeMode(e.target.value as Mode)}><option value="sample">화면 내부 샘플</option><option value="local-api">로컬 목업 API</option><option value="api">지정한 API</option><option value="file">응답 JSON 파일</option></select></label>
      {mode==='local-api'&&<p>목업 주소: http://127.0.0.1:8085 · 목업 서버를 실행한 PC에서 사용하세요.</p>}
      {mode==='api'&&<label style={{display:'block',marginTop:12}}>생성 API 주소 <input aria-label="생성 API 주소" type="url" value={endpoint} disabled={loading} onChange={e=>setEndpoint(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:10,font:'inherit'}}/></label>}
      {mode==='file'?<div style={{marginTop:16}}>
        <label>영상 기준 API 주소 (상대 영상 주소가 있을 때만)
          <input aria-label="파일 영상 기준 API 주소" type="url" value={fileBase} disabled={loading} onChange={e=>setFileBase(e.target.value)} placeholder="https://서버/실제/API/경로" style={{display:'block',width:'100%',boxSizing:'border-box',padding:10,font:'inherit'}}/>
        </label>
        <label style={{display:'block',marginTop:12}}>응답 JSON 선택 <input aria-label="응답 JSON 선택" type="file" accept=".json,application/json" disabled={loading} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importResponse(file);}}/></label>
        {selectedFile&&<p>최근 선택한 파일: {selectedFile}</p>}
        <p>40MB 이하 · 원본 파일은 수정하지 않습니다. 가져오기 실패 시 기존 결과를 유지합니다.</p>
      </div>:<><label htmlFor="generation-text" style={{display:'block',marginTop:16}}>입력할 문장</label>
      <textarea id="generation-text" disabled={loading} value={text} onChange={e=>{setText(e.target.value);setError('');}} rows={3} style={{display:'block',width:'100%',boxSizing:'border-box',font:'inherit',padding:12,marginTop:8,border:'1px solid #8794aa',borderRadius:8}}/>
      <p style={{fontSize:13,color:'#526078'}}>200자 이하 · {Array.from(text.trim()).length}자</p>
      {mode!=='api'&&<label>점검할 응답 <select aria-label="점검할 응답" style={control} disabled={loading} value={scenario} onChange={e=>setScenario(e.target.value)}>{(mode==='local-api'?localScenarios:[['success','정상 샘플'],['unknown','미지원 단어 안내 샘플'],['error','실패 안내 샘플'],['video','영상 응답 샘플'],['video-error','영상 재생 실패 샘플'],['video-list','영상 목록 샘플'],['video-empty','빈 영상 목록 샘플']]).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}{' '}
      {mode!=='sample'&&<label>응답 대기 제한 <select aria-label="응답 대기 제한" style={control} disabled={loading} value={timeout} onChange={e=>setTimeoutSeconds(Number(e.target.value))}>{[1,5,15,30,60].map(seconds=><option key={seconds} value={seconds}>{seconds}초</option>)}</select></label>}{' '}
      <button style={control} type="submit" disabled={loading}>{loading?'응답 대기 중…':mode==='sample'?'샘플 동작 보기':'API 요청하기'}</button>{' '}
      </>}
      {loading&&<button style={control} type="button" onClick={cancel}>{mode==='file'?'파일 불러오기 취소':'요청 취소'}</button>}
      {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}
      {result&&result.motion.unknown.length>0&&<p role="status" style={{padding:12,background:'#fff4dc',color:'#754b16'}}>{result.motion.demo?'시험용 미지원 단어 목록':'서버가 알린 미지원 단어'}: {result.motion.unknown.join(', ')}</p>}
      <p role="status" style={{color:'#526078',minHeight:20}}>{loading?(mode==='file'?'응답 파일을 읽고 있습니다…':'응답을 기다리고 있습니다…'):status}</p>
    </form>
    {result&&<div style={{marginTop:20}}><h3>{mode==='file'?'응답 파일 미리보기':`입력 문장: ${result.text}`}</h3>
      <p>{result.motion.demo?'합성 시험 응답 · 실제 수어 생성 결과가 아닙니다.':mode==='file'?'로컬에서 불러온 응답입니다.':'서버에서 받은 응답입니다.'}{result.motion.source==='video'?' 영상 응답':` · ${result.motion.frames}프레임 · ${result.motion.fps}fps`}</p>
      {inspection&&<section aria-label="불러온 응답 점검 요약" style={{background:'#fff',border:'1px solid #c6cfdd',borderRadius:12,padding:16,marginBottom:16,overflowWrap:'anywhere'}}>
        <h4 style={{marginTop:0}}>불러온 응답 점검 요약</h4>
        <p><strong>현재 재생 파일: {result.fileName}</strong></p>
        <ul>{inspection.facts.map(fact=><li key={fact}>{fact}</li>)}</ul>
        <ul style={{color:'#754b16'}}>{inspection.notices.map(notice=><li key={notice}>{notice}</li>)}</ul>
      </section>}
      <PlaybackResult response={result.motion}/>
    </div>}
  </section>;
}
