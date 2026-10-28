// Offline adapter regression against Jiheon's explicitly synthetic, pinned examples.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const cache={}, requests=[];let reply;
function load(name){
 if(cache[name])return cache[name];const exports={};cache[name]=exports;
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/sign-player',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{exports,require:p=>load(p.replace('./','')),URL,TextDecoder,AbortController,DOMException,TypeError,ArrayBuffer,Uint8Array,Float32Array,DataView,atob,btoa,setTimeout,clearTimeout,
 fetch:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(reply.value),{status:reply.status,headers:{'Content-Type':'application/json'}});}});return exports;
}
const fixture=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/generation-jiheon',name+'.json'),'utf8'));
const {generateFromApi}=load('generate-api'),{readResponseFile}=load('response-file'),{decodeMotion}=load('motion'),{summarizeResponse}=load('response-summary');
const call=(value,status=200)=>{reply={value,status};return generateFromApi({text:'화장실 어디 있어요?',endpoint:'http://localhost:8080/api/sign/generate',signal:new AbortController().signal});};
const file=value=>{const bytes=Buffer.from(JSON.stringify(value));return {size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};};
(async()=>{
 const normal=fixture('normal'),unknown=fixture('unknown'),failure=fixture('video');
 const parsed=await call(normal);assert.equal(parsed.frames,1);assert.equal(decodeMotion(parsed).positions.length,375);
 assert.equal(Buffer.from(parsed.data,'base64').length,parsed.frames*125*3*4);
 assert.equal(requests[0].url,'http://localhost:8080/api/sign/generate');
 assert.equal(requests[0].options.body,JSON.stringify({text:'화장실 어디 있어요?'}));assert.equal(requests[0].options.credentials,'omit');
 console.log('PASS pinned normal: 1 frame, LE float32 length, exact Spring text-only request');
 const empty=await call(unknown);assert.equal(empty.frames,0);assert.equal(decodeMotion(empty).positions.length,0);assert.equal(empty.unknown[0],'미등록예시');
 assert(summarizeResponse(empty).notices.some(x=>x.includes('재생할 동작이 없습니다')));
 await readResponseFile(file(unknown));
 for(const patch of [{data:'AAAA'},{tokens:[1]},{unknown:[]},{segments:[{gloss:'x',start:0,end:1}]}])assert.throws(()=>decodeMotion({...unknown,...patch}));
 console.log('PASS all unknown: API/file success with zero frames; inconsistent empties rejected');
 await assert.rejects(call(failure,503),e=>e.message===failure.error.message&&e.code==='GENERATION_UNAVAILABLE'&&e.retryable===true&&e.status===503);
 await assert.rejects(readResponseFile(file(failure)),e=>e.message===failure.error.message&&e.retryable===true);
 console.log('PASS legacy video filename: structured error shown, never successful playback');
 for(const [status,code,retryable] of [[400,'INVALID_REQUEST',false],[422,'NO_GENERATABLE_INPUT',false],[502,'TRANSLATION_UNAVAILABLE',true],[502,'GENERATION_FAILED',true],[503,'GENERATION_UNAVAILABLE',true],[504,'GENERATION_TIMEOUT',true]]){
  const before=requests.length;
  await assert.rejects(call({error:{code,message:'서버 안내 '+code,retryable}},status),e=>e.code===code&&e.message==='서버 안내 '+code&&e.retryable===retryable&&e.status===status);
  assert.equal(requests.length,before+1); // No automatic retry.
 }
 console.log('PASS all six error statuses: exact server message/retryable, no automatic retry');
 for(const source of ['model','baseline']){
  const result=await call({...normal,source,tokens:[1,2,3],unknown:['미지원'],segments:[]});assert.equal(result.source,source);assert.equal(result.unknown[0],'미지원');
  assert(summarizeResponse(result).notices.some(x=>x.includes('달라도 오류는 아닙니다')));
 }
 await assert.rejects(call({source:'video',videoUrl:'https://example.invalid/x.mp4',unknown:[]}),/영상 대체/);
 await assert.rejects(call({error:{code:'BAD',message:'oops',retryable:'true'}},503),/HTTP 503/);
 await call(normal);console.log('PASS baseline/model, partial unknown, token length mismatch advisory, generation video rejection and recovery');
 console.log('No network or actual inference. Synthetic normal fixture is not a sign-motion quality test.');
})().catch(e=>{console.error(e);process.exitCode=1;});
