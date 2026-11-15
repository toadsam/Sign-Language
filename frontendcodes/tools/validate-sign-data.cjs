#!/usr/bin/env node
// Uses the viewer's own decoders. Input files are parsed as JSON, never executed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const cache={};
function load(name){
  if(!['motion','playback','codebook'].includes(name))throw new Error('허용되지 않은 검사 모듈입니다.');
  if(cache[name])return cache[name];
  const exports={};cache[name]=exports;
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/sign-player',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source,{exports,require:p=>load(p.replace('./','')),URL,ArrayBuffer,Uint8Array,Float32Array,DataView,atob});
  return exports;
}
function inspect(value){
  const warnings=[];
  if(value&&typeof value==='object'&&('entries' in value||'version' in value)&&!('source' in value)){
    const entries=load('codebook').decodeCodebook(value);
    const demoCount=entries.filter(entry=>entry.motion.response.demo===true).length;
    if(demoCount)warnings.push('합성 표식이 있는 코드북 항목이 포함되어 있습니다.');
    return {kind:'codebook',summary:{entries:entries.length,framesPerEntry:4,demoEntries:demoCount},warnings};
  }
  const result=load('playback').decodePlayback(value);
  if(result.demo===true)warnings.push('합성 시험 자료입니다.');
  if(result.source==='video'){
    const playable=result.items.filter(item=>item.hasVideo);
    if(!playable.length)warnings.push('재생 가능한 영상이 없습니다.');
    const relative=playable.filter(item=>{try{new URL(item.url);return false;}catch{return true;}}).length;
    if(relative)warnings.push('상대 영상 주소가 있습니다. 실제 API 또는 배포 주소를 기준으로 해석해야 합니다.');
    warnings.push('영상 파일에 접속하지 않았습니다. 파일 존재·코덱·연속 재생은 별도 확인이 필요합니다.');
    return {kind:'video',summary:{items:result.items.length,playable:playable.length,withoutVideo:result.items.length-playable.length,relativeUrls:relative,unknown:result.unknown.length,demo:result.demo===true},warnings};
  }
  const sorted=[...result.segments].sort((a,b)=>a.start-b.start);
  let end=0;
  for(const segment of sorted){if(segment.start<end){warnings.push('자막 구간이 겹칩니다. 화면은 먼저 일치하는 자막을 표시합니다.');break;}end=Math.max(end,segment.end);}
  return {kind:'motion',summary:{source:result.source,joints:result.joints,frames:result.frames,fps:result.fps,durationSeconds:result.frames/result.fps,tokens:result.tokens.length,segments:result.segments.length,unknown:result.unknown.length,demo:result.demo===true},warnings};
}
function main(args){
  const files=[];let output;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--help'){console.log('사용: node tools/validate-sign-data.cjs FILE.json [FILE2.json ...] [--report NEW_REPORT.json]\n동작/영상목록/로컬 코드북 형식을 검사합니다. 원본은 수정하지 않습니다.');return 0;}
    if(args[i]==='--report'){if(output||!args[i+1]||args[i+1].startsWith('--'))throw new Error('--report 뒤에 새 보고서 경로 하나를 지정해주세요.');output=path.resolve(args[++i]);}
    else if(args[i].startsWith('--'))throw new Error('알 수 없는 옵션입니다: '+args[i]);
    else files.push(path.resolve(args[i]));
  }
  if(!files.length)throw new Error('검사할 JSON 파일을 지정해주세요. --help로 사용법을 확인하세요.');
  if(output&&files.includes(output))throw new Error('입력 파일과 보고서 경로는 달라야 합니다.');
  if(output&&fs.existsSync(output))throw new Error('보고서 경로에 파일이 이미 있습니다. 다른 이름을 지정해주세요.');
  const results=files.map(file=>{
    let bytes,sha256;
    try{
      const stat=fs.statSync(file);if(!stat.isFile()||stat.size>40000000)throw new Error('40MB 이하의 일반 JSON 파일이 필요합니다.');
      bytes=fs.readFileSync(file);if(bytes.length>40000000)throw new Error('40MB 이하 파일이 필요합니다.');sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('올바른 JSON 문서가 아닙니다.');}
      return {file,bytes:bytes.length,sha256,valid:true,...inspect(value)};
    }catch(error){return {file,...(bytes?{bytes:bytes.length,sha256}:{}),valid:false,error:error.message};}
  });
  const report={schemaVersion:1,checkedAt:new Date().toISOString(),scope:'viewer-data-contract',networkAccessed:false,actualPlaybackTested:false,modelAccuracyTested:false,decoderFiles:Object.fromEntries(['motion','playback','codebook'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../components/sign-player',name+'.ts'))).digest('hex')])),valid:results.every(result=>result.valid),results};
  const text=JSON.stringify(report,null,2)+'\n';
  if(output)fs.writeFileSync(output,text,{flag:'wx'});
  process.stdout.write(text);
  return report.valid?0:1;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=2;}}
module.exports={inspect,main};
