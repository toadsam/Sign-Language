// Run while mock-generation-server.py is listening on 127.0.0.1:8085.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const cache={},requests=[];
function load(name){
  if(cache[name])return cache[name];const exports={};cache[name]=exports;
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/sign-player',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source,{exports,require:p=>load(p.replace('./','')),fetch:(url,options)=>{requests.push({url,options});return fetch(url,options);},URL,AbortController,DOMException,TypeError,ArrayBuffer,Uint8Array,Float32Array,DataView,atob,btoa,setTimeout,clearTimeout});return exports;
}
const {decodePlayback,nextVideoIndex}=load('playback');
const {generateFromApi,generationEndpoint}=load('generate-api'),base='http://127.0.0.1:8085/api/sign/generate';
const call=(scenario,options={})=>generateFromApi({text:'  점검 문장  ',endpoint:base+'?scenario='+scenario,signal:new AbortController().signal,...options});
(async()=>{
  const passed=[];let motion=await call('success');assert.equal(motion.frames,120);assert.equal(motion.demo,true);assert.equal(JSON.parse(requests.at(-1).options.body).text,'점검 문장');assert.equal(requests.at(-1).options.method,'POST');passed.push('POST text body, response decoder, synthetic marker');
  motion=await call('unknown');assert.equal(motion.unknown.length,1);passed.push('unknown list');
  await assert.rejects(call('error'),/HTTP 503/);await assert.rejects(call('invalid'),/관절|출처/);await assert.rejects(call('non-json'),/JSON/);passed.push('HTTP error, invalid schema, malformed JSON');
  const video=await call('video');assert.equal(video.videoUrl,'http://127.0.0.1:8085/sample-video.mp4');passed.push('video URL resolved against API origin');
  await assert.rejects(call('slow',{timeoutMs:100}),/대기 시간/);passed.push('timeout abort');
  const controller=new AbortController(),pending=call('slow',{signal:controller.signal});setTimeout(()=>controller.abort(),30);await assert.rejects(pending,error=>error.name==='AbortError');passed.push('user cancellation');
  const cancelled=new AbortController();cancelled.abort();const before=requests.length;await assert.rejects(call('success',{signal:cancelled.signal}),error=>error.name==='AbortError');assert.equal(requests.length,before);passed.push('already cancelled request sends nothing');
  await assert.rejects(call('success',{text:''}),/문장/);await assert.rejects(call('success',{text:'가'.repeat(201)}),/200/);for(const url of ['javascript:alert(1)','http://u:p@localhost/x','http://localhost/x#fragment'])assert.throws(()=>generationEndpoint(url));passed.push('input and endpoint validation');
  const preflight=await fetch(base,{method:'OPTIONS',headers:{Origin:'http://localhost:8083','Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'http://localhost:8083');passed.push('local origin CORS preflight');
  const list=await call('video-list');assert.equal(list.items.length,3);assert.equal(list.items[0].url,'http://127.0.0.1:8085/sample-video.mp4');assert.equal(list.items[1].url,'');assert.equal(list.items[1].hasVideo,false);assert.equal(list.items[2].word,'샘플 둘');
  assert.equal(nextVideoIndex(list.items,0),2);assert.equal(nextVideoIndex(list.items,2),-1);assert.equal(nextVideoIndex(list.items,2,true),0);assert.equal(nextVideoIndex([],0,true),-1);assert.equal(nextVideoIndex([list.items[1]],0,true),-1);passed.push('playlist order, relative URLs, missing video skip, end and repeat');
  const empty=await call('video-empty');assert.equal(empty.items.length,0);const broken=await call('video-list-error');assert.equal(broken.items[2].url,'http://127.0.0.1:8085/missing.mp4');assert.equal((await fetch(broken.items[2].url)).status,404);passed.push('empty list and broken media fixture');
  const item=list.items[0],wrap=items=>({source:'video',items,unknown:[]});
  for(const patch of [{url:'javascript:alert(1)'},{url:''},{hasVideo:'true'},{id:-1},{word:''},{file:null}])assert.throws(()=>decodePlayback(wrap([{...item,...patch}])));
  assert.throws(()=>decodePlayback(wrap('bad')));assert.throws(()=>decodePlayback(wrap(Array(1001).fill(item))));assert.throws(()=>decodePlayback(wrap([{...item,hasVideo:false,url:'data:text/plain,test'}])));passed.push('playlist field validation and unsafe URL rejection');
  const legacy=decodePlayback({source:'video',videoUrl:'/sample.mp4',unknown:[]});assert.equal(legacy.items.length,1);assert.equal(legacy.items[0].url,'/sample.mp4');passed.push('legacy single video compatibility');
  await call('success');passed.push('retry after failures');
  console.log(JSON.stringify({mock:true,modelInferenceTested:false,passed},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
