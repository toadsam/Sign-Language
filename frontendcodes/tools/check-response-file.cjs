// Exercises the same local import decoder used by GenerationLab.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const cache={};let requests=0;
function load(name){
 if(cache[name])return cache[name];const exports={};cache[name]=exports;
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/sign-player',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(source,{exports,require:p=>load(p.replace('./','')),URL,TextDecoder,ArrayBuffer,Uint8Array,Float32Array,DataView,atob,fetch:()=>{requests++;throw Error('Network forbidden');}});return exports;
}
const {readResponseFile}=load('response-file');
const motion=JSON.parse(fs.readFileSync(path.join(__dirname,'../components/sign-player/demo-motion.json')));
const file=raw=>{const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(JSON.stringify(raw));return {size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};};
(async()=>{
 const passed=[];const input=file(motion),before=Buffer.from(await input.arrayBuffer());
 const result=await readResponseFile(input);assert.equal(result.frames,120);assert.equal(result.demo,true);assert.deepEqual(Buffer.from(await input.arrayBuffer()),before);passed.push('motion import and original bytes preserved');
 const unknown=await readResponseFile(file({...motion,unknown:['없는단어']}));assert.equal(unknown.unknown[0],'없는단어');passed.push('unknown list preserved');
 const video={source:'video',items:[{word:'예시',id:1,file:'a.mp4',url:'../a.mp4',hasVideo:true},{word:'없음',id:2,file:'',url:'',hasVideo:false}],unknown:[]};
 await assert.rejects(readResponseFile(file(video)),/상대 영상/);
 const list=await readResponseFile(file(video),'https://example.invalid/api/generate');assert.equal(list.items[0].url,'https://example.invalid/a.mp4');assert.equal(list.items[1].url,'');passed.push('relative playlist requires base and retains missing item');
 const legacy=await readResponseFile(file({source:'video',videoUrl:'https://example.invalid/movie.mp4',unknown:[]}));assert.equal(legacy.videoUrl,'https://example.invalid/movie.mp4');passed.push('absolute legacy video');
 await assert.rejects(readResponseFile(file({...video,items:[{...video.items[0],url:'javascript:alert(1)'}]})),/HTTP/);
 await assert.rejects(readResponseFile(file(video),'https://u:p@example.invalid/api'),/인증/);passed.push('unsafe media and credential base rejected');
 await assert.rejects(readResponseFile(file(Buffer.from('{"source":'))),/JSON/);
 await assert.rejects(readResponseFile(file(Buffer.from([0xff,0xfe]))),/UTF-8/);
 await assert.rejects(readResponseFile({size:5,arrayBuffer:async()=>new ArrayBuffer(4)}),/끝까지/);passed.push('truncated JSON, invalid UTF-8 and incomplete read');
 await assert.rejects(readResponseFile({size:40000001,arrayBuffer:async()=>{throw Error('should not read');}}),/40MB/);
 await assert.rejects(readResponseFile(file({...motion,data:'AAAA'})),/길이/);passed.push('oversize and invalid coordinates rejected');
 assert.equal(requests,0);passed.push('zero network requests');
 console.log(JSON.stringify({passed},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
