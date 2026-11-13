// No browser or model inference; execute the actual atlas decoder on data only.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const exportsObject={};
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/sign-player/token-atlas.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(source,{exports:exportsObject});
const {readTokenAtlas,decodeTokenAtlas,atlasTokens,atlasPreviewFrame}=exportsObject;
const fixture={n:2,frames:4,body:13,lhand:34,lim:2.5,edges:[[1,0]],x:Array.from({length:2},()=>Array.from({length:4},()=>Array.from({length:55},()=>[0,1]))),use:[10,20],useWord:[7,12],useSen:[3,8],words:[[['학교',.5]],[['인사',1]]],hand:[2,1],move:[1,2],rest:[false,true],share:[.1,.2]};
const clone=()=>JSON.parse(JSON.stringify(fixture));
assert.equal(readTokenAtlas(JSON.stringify(fixture)).n,2);
assert.equal(readTokenAtlas('<script>const D = '+JSON.stringify(fixture)+'; throw new Error("must not execute");</script>').n,2);
assert.deepEqual(Array.from(atlasTokens(fixture,'학교','use',false)),[0]);
assert.deepEqual(Array.from(atlasTokens(fixture,'','use',true)),[0]);
assert.deepEqual(Array.from(atlasTokens(fixture,'','use',false)),[1,0]);
assert.deepEqual(Array.from(atlasTokens(fixture,'','id',false)),[0,1]);
assert.deepEqual(Array.from(atlasTokens(fixture,'1','id',false)),[1]);
assert.deepEqual(Array.from(atlasTokens(fixture,'없는단어','id',false)),[]);
assert.deepEqual(Array.from({length:7},(_,i)=>atlasPreviewFrame(i)),[0,1,2,3,2,1,0]);
for(const mutate of [d=>d.x[0][0].pop(),d=>d.x[0][0][0].push(3),d=>d.x[0][0][0][0]=NaN,d=>d.edges[0][1]=55,d=>d.use.pop(),d=>d.words[0][0][1]=2,d=>d.rest[0]='false',d=>d.n=2048,d=>d.share[0]=-1]){const d=clone();mutate(d);assert.throws(()=>decodeTokenAtlas(d));}
assert.throws(()=>readTokenAtlas('const D = (()=>({}))();'));
assert.throws(()=>readTokenAtlas('const D = '+JSON.stringify(fixture)));
const escaped=clone();escaped.words[0][0][0]='학교 } " test';assert.equal(readTokenAtlas('const D = '+JSON.stringify(escaped)+';').words[0][0][0],escaped.words[0][0][0]);
const actual=process.argv[2]?readTokenAtlas(fs.readFileSync(process.argv[2],'utf8')):null;
console.log(JSON.stringify({passed:['JSON and HTML data-only import','word and token search, rest filter, ordering and empty results','original ping-pong preview sequence','invalid dimensions, non-finite coordinates and metadata rejected','executable payload rejected and trailing script never evaluated','quoted JSON delimiters'],actualFile:actual?{tokens:actual.n,frames:actual.frames,joints:actual.x[0][0].length,dimensions:actual.x[0][0][0].length}:null,browserTested:false},null,2));
