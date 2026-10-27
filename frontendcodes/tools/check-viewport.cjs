const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const result={};
const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/sign-player/viewport.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(js,{exports:result});
const {createViewportUpdater}=result;
function fixture(){const sizes=[];let projections=0;const camera={left:0,right:0,top:0,bottom:0,updateProjectionMatrix:()=>projections++};return {sizes,camera,get projections(){return projections;},update:createViewportUpdater({setSize:(...args)=>sizes.push(args)},camera)};}
const f=fixture();assert.equal(f.update(1072,420),true);
for(let i=0;i<300;i++)assert.equal(f.update(1072,420),false);
assert.equal(f.sizes.length,1);assert.equal(f.projections,1);assert.deepEqual(f.sizes[0],[1072,420,false]);
for(const [w,h] of [[320,420],[320,240],[1072,420]]){
 assert.equal(f.update(w,h),true);const scale=Math.min(w/3.2,h/3.6);
 assert.equal(f.camera.left,-w/scale/2);assert.equal(f.camera.right,w/scale/2);assert.equal(f.camera.top,h/scale/2);assert.equal(f.camera.bottom,-h/scale/2);
}
assert.equal(f.sizes.length,4);const before=f.projections;
for(const [w,h] of [[0,420],[320,0],[-1,20],[NaN,20],[20,Infinity]])assert.equal(f.update(w,h),false);
assert.equal(f.projections,before);assert.equal(f.update(1072,420),false);assert.equal(f.update(320,420),true);
const restored=fixture();assert.equal(restored.update(320,420),true);assert.equal(restored.sizes.length,1);
console.log(JSON.stringify({passed:['300 frame updates resize only once','width/height changes and return to previous size resize correctly','projection matches original framing at wide/narrow/short sizes','zero/nonfinite dimensions do not corrupt cached size','restored renderer has independent first resize'],actualDisplayFpsMeasured:false},null,2));
