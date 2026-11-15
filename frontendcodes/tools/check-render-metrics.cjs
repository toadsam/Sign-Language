// Deterministic timing traces; these checks do not run a browser or GPU.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const exportsObject={};
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/sign-player/performance.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(code,{exports:exportsObject});
const {summarizeRendering,summarizeCadence}=exportsObject;
const trace=Array.from({length:300},(_,i)=>({time:i*1000/30,frame:i%120,cpuMs:2}));
const normal=summarizeRendering(trace,10000);
assert.equal(normal.updatesPerSecond,30);assert.equal(normal.meanCpuMs,2);assert.equal(normal.p95CpuMs,2);assert.equal(normal.samplingStatus,'recorded');assert.equal(normal.updateCadence.delayedIntervals,0);assert.ok(Math.abs(normal.updateCadence.p95GapMs-1000/30)<.001);
const repeated=summarizeRendering(trace.flatMap(sample=>[sample,{...sample,time:sample.time+1}]),10000);assert.equal(repeated.drawCalls,600);assert.equal(repeated.frameUpdates,300);
const stalled=summarizeRendering(trace.map(sample=>({...sample,time:sample.time+(sample.frame>=60?200:0)})).slice(0,120),10000);assert.ok(stalled.updateCadence.maxGapMs>200);assert.ok(stalled.updateCadence.delayedIntervals>0);assert.equal(stalled.samplingStatus,'partial');
const held=summarizeRendering(trace.map(sample=>({...sample,frame:0})),10000);assert.equal(held.frameUpdates,1);assert.equal(held.samplingStatus,'insufficient');
assert.equal(summarizeRendering([],10000).samplingStatus,'insufficient');assert.equal(summarizeRendering([],0).updatesPerSecond,0);
const heartbeat=summarizeCadence(Array.from({length:600},(_,i)=>i*1000/60),10000,30);assert.equal(heartbeat.callbacksPerSecond,60);assert.equal(heartbeat.delayedIntervals,0);
const outlier=summarizeRendering(trace.map((sample,i)=>({...sample,cpuMs:i>=280?25:2})),10000);assert.equal(outlier.p95CpuMs,25);
console.log(JSON.stringify({syntheticTimingTraces:true,browserOrGpuTested:false,passed:['30Hz timing and CPU summaries','duplicate redraws preserve pose update count','stalls and partial coverage detected','held pose and empty trace are insufficient','60Hz browser callbacks are distinct from 30Hz pose updates','CPU p95 detects slow tail']},null,2));
