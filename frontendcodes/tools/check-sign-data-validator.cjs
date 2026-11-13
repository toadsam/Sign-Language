const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sign-contract-'));
const tool=path.join(__dirname,'validate-sign-data.cjs');
const sample=JSON.parse(fs.readFileSync(path.join(__dirname,'../components/sign-player/demo-motion.json'),'utf8'));
const book=JSON.parse(fs.readFileSync(path.join(__dirname,'../components/sign-player/demo-codebook.json'),'utf8'));
const put=(name,value)=>{const file=path.join(dir,name);fs.writeFileSync(file,JSON.stringify(value));return file;};
const run=(...args)=>spawnSync(process.execPath,[tool,...args],{encoding:'utf8'});
try{
  const motion=put('motion.json',sample),codebook=put('book.json',book),before=fs.readFileSync(motion);
  let result=run(motion,codebook);assert.equal(result.status,0,result.stderr);let report=JSON.parse(result.stdout);assert.equal(report.results[0].kind,'motion');assert.equal(report.results[1].kind,'codebook');assert.equal(report.actualPlaybackTested,false);assert.equal(report.decoderFiles.motion.length,64);assert.equal(report.results[0].sha256.length,64);
  const list=put('video.json',{source:'video',items:[{word:'시험',id:1,file:'',url:'/test.mp4',hasVideo:true},{word:'없음',id:0,file:'',url:'',hasVideo:false}],unknown:[]});
  result=run(list);report=JSON.parse(result.stdout);assert.equal(result.status,0);assert.equal(report.results[0].summary.relativeUrls,1);assert.equal(report.results[0].summary.withoutVideo,1);
  const empty=put('empty.json',{source:'video',items:[],unknown:[]});report=JSON.parse(run(empty).stdout);assert.ok(report.results[0].warnings.some(w=>w.includes('재생 가능한')));
  const invalids=[{...sample,fps:0},{...sample,data:sample.data.slice(4)},{...sample,segments:[{gloss:'bad',start:0,end:sample.frames+1}]},{...book,entries:[book.entries[0],book.entries[0]]},{source:'video',items:[{word:'bad',id:1,file:'',url:'javascript:alert(1)',hasVideo:true}],unknown:[]}];
  for(const [i,value] of invalids.entries()){result=run(put('bad'+i+'.json',value),motion);report=JSON.parse(result.stdout);assert.equal(result.status,1);assert.equal(report.results[0].valid,false);assert.equal(report.results[1].valid,true);}
  const malformed=path.join(dir,'malformed.json');fs.writeFileSync(malformed,'{');assert.equal(run(malformed).status,1);assert.equal(run(path.join(dir,'missing.json')).status,1);assert.equal(run(path.join(dir,'missing.json'),'--report',path.join(dir,'missing.json')).status,2);
  const output=path.join(dir,'report.json');assert.equal(run(motion,'--report',output).status,0);assert.equal(JSON.parse(fs.readFileSync(output)).valid,true);assert.equal(run(motion,'--report',output).status,2);assert.equal(run(motion,'--report',motion).status,2);assert.deepEqual(fs.readFileSync(motion),before);
  assert.equal(run().status,2);assert.equal(run('--help').status,0);
  console.log(JSON.stringify({passed:['motion/codebook accepted by shared viewer decoders','video list, relative URLs and missing-video warning','empty list warning','invalid payloads rejected while subsequent files still checked','malformed/missing files reported','report export, no overwrite and original file preserved','help and command errors'],realTeamDataTested:false,actualPlaybackTested:false},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
