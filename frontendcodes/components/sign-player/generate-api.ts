import { validateGenerationText } from './generation-input';
import { decodePlayback } from './playback';
import type { PlaybackResponse } from './playback';
export function generationEndpoint(value:string):string{
  let url:URL;
  try{url=new URL(value.trim());}catch{throw new Error('생성 API의 전체 HTTP 또는 HTTPS 주소를 입력해주세요.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw new Error('인증 정보나 # 없이 HTTP 또는 HTTPS API 주소를 입력해주세요.');
  return url.toString();
}
/** Spring-facing {text} request adapter, separate from inference-server gloss/nonmanual. */
export async function generateFromApi({text,endpoint,signal,timeoutMs=15000}:{text:string;endpoint:string;signal:AbortSignal;timeoutMs?:number}):Promise<PlaybackResponse>{
  const input=validateGenerationText(text),url=generationEndpoint(endpoint);
  if(!Number.isFinite(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new Error('대기 제한은 0.1~120초로 지정해주세요.');
  if(signal.aborted)throw new DOMException('요청을 취소했습니다.','AbortError');
  const controller=new AbortController();let timedOut=false;
  const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try{
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({text:input}),signal:controller.signal,credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error(`생성 API 요청에 실패했습니다 (HTTP ${response.status}).`);
    if(Number(response.headers.get('Content-Length'))>40000000)throw new Error('생성 응답이 40MB를 초과합니다.');
    const raw=await response.text();
    if(raw.length>40000000)throw new Error('생성 응답이 40MB를 초과합니다.');
    let value:unknown;
    try{value=JSON.parse(raw);}catch{throw new Error('API가 올바른 JSON 응답을 반환하지 않았습니다.');}
    const result=decodePlayback(value);
    if(signal.aborted)throw new DOMException('요청을 취소했습니다.','AbortError');
    return result.source==='video'?{...result,items:result.items.map(item=>({...item,url:item.url?new URL(item.url,url).toString():''})),...(result.videoUrl?{videoUrl:new URL(result.videoUrl,url).toString()}:{})}:result;
  }catch(error){
    if(signal.aborted)throw new DOMException('요청을 취소했습니다.','AbortError');
    if(timedOut)throw new Error(`서버 응답 대기 시간(${timeoutMs/1000}초)을 초과했습니다. 다시 시도해주세요.`);
    if(error instanceof TypeError)throw new Error('API에 연결할 수 없습니다. 서버 주소·네트워크·CORS 설정을 확인해주세요.');
    throw error;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
