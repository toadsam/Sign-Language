// Runs the real component's file-input handlers with isolated React hook state.
// No browser/GPU claim: child renderers are placeholders; file parsing and state updates are real.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react');
const root=path.resolve(__dirname,'../components/sign-player');
const empty=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/generation-jiheon/unknown.json'),'utf8'));
const normal=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/generation-jiheon/normal.json'),'utf8'));
function harness(mode){
 const state=[],refs=[],cache={};let cursor=0,refCursor=0;
 const hooks={...React,useState(init){const n=cursor++;if(!(n in state))state[n]=typeof init==='function'?init():init;return [state[n],value=>{state[n]=typeof value==='function'?value(state[n]):value;}];},useRef(init){const n=refCursor++;return refs[n]??(refs[n]={current:init});},useEffect(){}};
 function load(name){
  if(cache[name])return cache[name];
  if(name==='react')return hooks;
  if(name==='react/jsx-runtime')return require(name);
  if(name==='./useRenderCheck')return {useRenderCheck:()=>({running:false})};
  if(name==='./useCanvasRecorder')return {useCanvasRecorder:()=>({busy:false,active:{current:false},stop(){}})};
  const actual=['./motion','./timeline','./demo-comparison'];
  if(name!=='./ComparisonPlayer.web'&&!actual.includes(name)&&!name.endsWith('.json'))return {__esModule:true,default:name};
  if(name.endsWith('.json'))return require(path.join(root,name));
  const filename=path.join(root,name+(name==='./ComparisonPlayer.web'?'.tsx':'.ts'));
  const exports={};cache[name]=exports;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require:load,atob,btoa,Uint8Array,Float32Array,DataView});return exports;
 }
 const Component=load('./ComparisonPlayer.web').default;
 function render(){cursor=0;refCursor=0;return Component({mode});}
 function nodes(tree,predicate,out=[]){if(!tree)return out;if(Array.isArray(tree)){tree.forEach(n=>nodes(n,predicate,out));return out;}if(typeof tree==='object'){if(predicate(tree))out.push(tree);nodes(tree.props?.children,predicate,out);}return out;}
 const canvases=tree=>nodes(tree,n=>n.type==='./MotionCanvas.web');
 const articles=tree=>nodes(tree,n=>n.type==='article');
 const errors=tree=>nodes(tree,n=>n.props?.role==='alert').map(n=>n.props.children.flat().join(''));
 const text=tree=>nodes(tree,n=>n.type==='p').map(n=>JSON.stringify(n.props.children)).join(' ');
 async function choose(index,value,name){
  const tree=render(),fileInput=nodes(articles(tree)[index],n=>n.type==='input'&&n.props.type==='file')[0];
  let resolve;const pending=new Promise(r=>{resolve=r;});
  const target={files:[{name,size:100,text:()=>pending}],value:'selected'};
  fileInput.props.onChange({target});assert.equal(target.value,'');
  const loadingTree=render();assert(text(articles(loadingTree)[index]).includes('읽는 중'));
  resolve(JSON.stringify(value));await new Promise(setImmediate);
  return render();
 }
 return {render,canvases,articles,errors,text,choose};
}
(async()=>{
 for(const mode of ['four','reconstruction']){
  const h=harness(mode),count=mode==='four'?4:2;
  assert.equal(h.canvases(h.render()).length,count);
  for(let index=0;index<count;index++){
   const before=h.canvases(h.render()).map(n=>n.props.data);
   const after=await h.choose(index,empty,'all-unknown.json');
   const retained=h.canvases(after).map(n=>n.props.data);
   retained.forEach((data,i)=>assert.equal(data,before[i],'empty import must retain every previous motion'));
   assert(h.errors(after).some(x=>x.includes('비교할 수 있는 동작이 없습니다')&&x.includes('기존 동작을 유지합니다')));
   assert(!h.text(after).includes('all-unknown.json'));
   for(const node of h.canvases(after)){assert(node.props.data.response.frames>0);assert(node.props.frame>=0);}
  }
  let after=await h.choose(0,normal,'valid-one-frame.json');
  assert.equal(h.canvases(after)[0].props.data.response.frames,1);assert.equal(h.errors(after).length,count-1);
  assert(h.text(h.articles(after)[0]).includes('valid-one-frame.json'));
  const preserved=h.canvases(after)[0].props.data;
  after=await h.choose(0,empty,'empty-again.json');assert.equal(h.canvases(after)[0].props.data,preserved);
  console.log(`PASS ${mode}: ${count} slots retain motions on empty file, no negative frame, loading cleared; 1-frame recovery then empty rejection`);
 }
 console.log('Real component handlers and decoder tested; browser rendering and native WebView not exercised.');
})().catch(e=>{console.error(e);process.exitCode=1;});
