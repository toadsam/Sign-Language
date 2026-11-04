import {createIcons, Clapperboard, Code2, BookOpen, RotateCcw, Expand, SkipBack, Play, Pause, SkipForward, VolumeX, Volume2, ArrowUpRight, Search, Copy} from 'lucide';
import {createScene} from './cinema.js';
import {chapters,guides,details,glossary} from './content.js';
import {film,examples} from './screenplay.js';
import catalog from '../catalog.json';
import './style.css';
import './cinema.css';
const icons={Clapperboard,Code2,BookOpen,RotateCcw,Expand,SkipBack,Play,Pause,SkipForward,VolumeX,Volume2,ArrowUpRight,Search,Copy};

const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>`<i data-lucide="${name}"></i>`;
const button=(id,name,label)=>`<button id="${id}" class="icon-btn" title="${label}" aria-label="${label}">${icon(name)}</button>`;
const total=chapters.reduce((n,c)=>n+c.duration,0);
const starts=chapters.map((_,i)=>chapters.slice(0,i).reduce((n,c)=>n+c.duration,0));
const fmt=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
let chapter=0,beat=0,elapsed=0,playing=false,speed=1,view='film',voice=false,animationTime=0,lab=0,started=false;
let exampleStep=0,exampleTimer=null;
let voiceTouched=false;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let selectedFile='prep/preprocess.py',selectedFunction='',search='',activeDepth='beginner';
let saved;try{saved=JSON.parse(localStorage.getItem('motion-story-v2')||'null');}catch{}
const progress=new Set(saved?.seen||[]);

$('#app').innerHTML=`
  <a class="skip" href="#lesson">본문으로 이동</a>
  <header class="header"><a class="brand" href="#film"><span>손짓의 알파벳<small>수어지교 · 정재훈</small></span></a>
    <nav aria-label="주요 화면"><button data-view="film" class="active">${icon('clapperboard')}<span>전체 흐름</span></button><button data-view="code">${icon('code-2')}<span>코드 해설</span></button><button data-view="terms">${icon('book-open')}<span>용어 사전</span></button></nav>
    <span class="version">연구 기록 <b>2026. 10.</b></span>
  </header>
  <main id="film-view">
    <section class="stage" aria-label="연구 이야기">
      <div id="scene"></div><div class="stage-shade"></div>
      <div class="chapter-copy"><p id="kicker" class="eyebrow"></p><h1 id="headline"></h1><p id="beat-title" class="beat-title"></p><p id="caption"></p>
      <div class="metric"><strong id="metric"></strong><span id="metric-label"></span></div></div>
      <div class="film-caption"><p id="spoken-line"></p><div class="shot-controls">${button('prev-shot','skip-back','이전 세부 장면')}<span id="shot-counter"></span>${button('next-shot','skip-forward','다음 세부 장면')}<button id="shot-code">${icon('code-2')} 이 일을 한 코드</button></div></div>
      <div class="scene-top">설명용 재현 장면 · 실제 수어 및 모델 출력과 다름</div>
      <div class="scene-tools">${button('reset-camera','rotate-ccw','카메라 초기화')}${button('fullscreen','expand','전체 화면')}</div>
      <div class="scene-footer"><span id="scene-label"></span></div>
    </section>
    <section class="transport" aria-label="영화 재생">
      <div class="transport-row">${button('previous','skip-back','이전 장면')}${button('play','play','재생')}${button('next','skip-forward','다음 장면')}
      <span id="time" class="mono">00:00 / ${fmt(total)}</span><label class="speed"><span class="sr-only">재생 속도</span><select id="speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
      ${button('voice','volume-x','한국어 음성 읽기 켜기')}<span id="voice-status" class="voice-status">자막</span><button id="resume" ${saved?.elapsed?'':'hidden'}>이어서 보기</button><span id="progress-text" class="progress-text"></span></div>
      <input id="timeline" type="range" min="0" max="${total}" step="0.1" value="0" aria-label="전체 재생 위치">
      <nav id="chapters" aria-label="장면 선택">${chapters.map((c,i)=>`<button data-chapter="${i}"><span>0${i+1}</span>${c.short}</button>`).join('')}</nav>
    </section>
    <section id="lesson" class="lesson"><div class="chapter-takeaway"><span>작업 요약</span><p id="takeaway"></p></div><div class="lesson-heading"><div><h2 id="lesson-title"></h2></div><button id="related-code" class="text-button">관련 코드 ${icon('arrow-up-right')}</button></div>
      <div class="learning-grid"><article id="lesson-copy"></article><aside><div id="lab" class="lab"></div><div id="quiz" class="quiz"></div></aside></div>
      <div id="source-links" class="source-links"></div>
    </section>
    <footer>근거: ml/experiments.md · docs/ai-log/jaehun.md · ml/prep/quality_policy.md <span>소스 ${catalog.commit.slice(0,7)} · 2026.10.16 기준 · E5는 v1 후보</span></footer>
  </main>
  <main id="code-view" hidden><div class="code-heading"><h1>코드 읽기</h1><p>파일별 역할과 예시, 실제 구현을 함께 정리했습니다. ${catalog.files.length}개 파일 · ${catalog.files.reduce((n,f)=>n+f.functions.length,0)}개 함수</p></div>
    <div class="code-layout"><aside class="file-sidebar"><label class="search">${icon('search')}<input id="search" type="search" placeholder="파일 · 함수 검색" aria-label="파일 또는 함수 검색"></label><div id="file-list"></div></aside>
    <article class="code-detail"><div id="file-heading"></div><div class="depth-tabs" role="tablist" aria-label="설명 깊이"><button role="tab" data-depth="beginner">처음 이해하기</button><button role="tab" data-depth="function">함수 따라가기</button><button role="tab" data-depth="source">원문 전체</button></div><div id="code-content"></div></article></div>
  </main>
  <main id="terms-view" hidden><div class="code-heading"><h1>용어 정리</h1><p>이 작업에서 사용하는 개념들.</p></div><dl class="glossary">${glossary.map(([a,b])=>`<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl></main>
  <div id="toast" role="status" hidden></div>`;

function refreshIcons(){createIcons({icons,attrs:{'stroke-width':1.6}});}
let scene;
try{scene=createScene($('#scene'));}catch(e){$('#scene').innerHTML='<p class="webgl-error">3D를 표시할 수 없습니다. 브라우저의 하드웨어 가속을 확인해 주세요. 자막과 코드 해설은 계속 볼 수 있습니다.</p>';console.warn('WebGL unavailable',e.message);}
const fitScene=()=>{const stage=$('.stage'),copy=$('.chapter-copy'),caption=$('.film-caption');stage.style.setProperty('--cinema-top',`${copy.offsetTop+copy.offsetHeight+10}px`);stage.style.setProperty('--cinema-bottom',`${caption.offsetHeight+parseFloat(getComputedStyle(caption).bottom)+12}px`);};
const sceneLayout=new ResizeObserver(fitScene);sceneLayout.observe($('.chapter-copy'));sceneLayout.observe($('.film-caption'));fitScene();

function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4500);}
function persist(){try{localStorage.setItem('motion-story-v2',JSON.stringify({elapsed,seen:[...progress]}));}catch{}}
function speak(){
  if(!voice||!playing||!('speechSynthesis' in window))return;
  speechSynthesis.cancel();const text=film[chapter][beat];const utter=new SpeechSynthesisUtterance(text[0]+'. '+text[1]);utter.lang='ko-KR';utter.rate=speed*.92;
  const ko=speechSynthesis.getVoices().find(v=>v.lang.startsWith('ko'));if(ko)utter.voice=ko;
  utter.onerror=e=>{if(!['canceled','interrupted'].includes(e.error)){toast('음성을 읽을 수 없어 자막으로 계속합니다.');voice=false;updateVoice();}};
  speechSynthesis.speak(utter);
}
function updateVoice(){ $('#voice').innerHTML=icon(voice?'volume-2':'volume-x');$('#voice').setAttribute('aria-pressed',String(voice));$('#voice').setAttribute('aria-label',voice?'한국어 음성 읽기 끄기':'한국어 음성 읽기 켜기');$('#voice-status').textContent=voice?'음성 켜짐':'자막';refreshIcons(); }
function setPlaying(value){playing=value;if(value)started=true;$('#play').innerHTML=icon(playing?'pause':'play');$('#play').setAttribute('aria-label',playing?'일시정지':'재생');$('#play').title=playing?'일시정지':'재생';if(!playing){window.speechSynthesis?.cancel();}else{speak();}refreshIcons();}
function seek(value,save=true){
  elapsed=Math.max(0,Math.min(total,Number(value)));
  const next=Math.max(0,starts.findLastIndex(s=>elapsed>=s));
  const nextBeat=Math.min(3,Math.floor((elapsed-starts[next])/chapters[next].duration*4));
  const changed=next!==chapter;const beatChanged=nextBeat!==beat;
  chapter=next;beat=nextBeat;
  if(changed){lab=0;renderChapter();}else if(beatChanged)renderCaption();
  if(changed||beatChanged)speak();
  $('#timeline').value=elapsed;$('#time').textContent=`${fmt(elapsed)} / ${fmt(total)}`;
  if(elapsed>=total){progress.add(chapter);persist();setPlaying(false);$('#progress-text').textContent='전체 흐름 완료';}
  animationTime=elapsed;if(save)persist();
}
function renderCaption(){
  const c=chapters[chapter],s=film[chapter][beat];$('#headline').textContent=s[0];$('#beat-title').textContent=s[2];$('#caption').textContent=s[1];$('#spoken-line').textContent=s[1];$('#shot-counter').textContent=`${chapter*4+beat+1} / 28`;scene?.set(c.scene,lab,beat);
  $('#prev-shot').disabled=chapter===0&&beat===0;$('#next-shot').disabled=chapter===6&&beat===3;
  if(!reduced){$('#spoken-line').animate([{opacity:.5},{opacity:1}],{duration:250});}
}
function renderChapter(){
  const c=chapters[chapter];$('#kicker').textContent=`${chapter+1}장 · ${c.title}`;$('#headline').textContent=c.lead;$('#metric').textContent=c.metric[0];$('#metric-label').textContent=c.metric[1];
  $('#lesson-title').textContent=c.title;$('#lesson-copy').innerHTML=c.lesson.map(([h,p])=>`<section><h3>${h}</h3><p>${p}</p></section>`).join('');
  $('#takeaway').textContent=film[chapter][3][2].replace(/^내가 한 일 [①②③④⑤⑥] /,'');
  $('#source-links').innerHTML=`<span>연결된 코드</span>${c.files.map(f=>`<button data-file="${f}">${f}${icon('arrow-up-right')}</button>`).join('')}`;
  document.querySelectorAll('[data-chapter]').forEach(b=>{b.classList.toggle('active',+b.dataset.chapter===chapter);b.setAttribute('aria-current',+b.dataset.chapter===chapter?'step':'false');});
  $('#progress-text').textContent=`${progress.size} / 7장 완료`;
  $('#scene-label').textContent=['125 JOINTS / 3 AXES','CENTER → ROTATE → SCALE','FRAME-BY-FRAME INSPECTION','TRAIN / VALIDATION / TEST','ENCODE → QUANTIZE → DECODE','SAME METRIC / SAME TEST','GLOSS → TOKENS → MOTION'][chapter];
  renderCaption();renderLab();renderQuiz();refreshIcons();
}
function renderQuiz(){const [q,answers,correct,reason]=chapters[chapter].quiz;$('#quiz').innerHTML=`<p class="eyebrow">확인 질문</p><h3>${q}</h3><div>${answers.map((a,i)=>`<button data-answer="${i}">${a}</button>`).join('')}</div><p id="quiz-result" role="status"></p>`;$('#quiz').onclick=e=>{const b=e.target.closest('[data-answer]');if(!b)return;$('#quiz-result').textContent=(+b.dataset.answer===correct?'맞았어요. ':'다시 살펴봐요. ')+reason;};}

function renderLab(){
  const host=$('#lab');
  const ranges=(title,label,min,max,val,unit)=>`<p class="eyebrow">작은 실험 · 교육용 수치</p><h3>${title}</h3><label>${label}<output id="lab-value">${val}${unit}</output><input id="lab-range" type="range" min="${min}" max="${max}" value="${val}" step="1"></label><p id="lab-result"></p>`;
  if(chapter===0){host.innerHTML=ranges('프레임을 쌓아보기','프레임 수',4,160,80,'');$('#lab-range').oninput=e=>{$('#lab-value').textContent=e.target.value;$('#lab-result').textContent=`[${e.target.value},125,3] = [${e.target.value},375] · ${e.target.value*375}개 숫자`;};}
  if(chapter===1){host.innerHTML=ranges('같은 0.05 오차, 다른 실제 길이','어깨너비',25,60,40,'cm');$('#lab-range').oninput=e=>{lab=+e.target.value;$('#lab-value').textContent=lab+'cm';$('#lab-result').textContent=`0.05 × ${(lab/100).toFixed(2)}m × 1000 = ${(lab*.5).toFixed(1)}mm`;scene?.set('prepare',lab,beat);};}
  if(chapter===2){host.innerHTML=ranges('경계값을 직접 확인하기','인접 프레임 이동',0,150,60,'cm');$('#lab-range').oninput=e=>{lab=+e.target.value;$('#lab-value').textContent=lab+'cm';$('#lab-result').textContent=`이동 조건만 적용: ${lab>100?'학습 보류':lab>50?'추가 확인':'통과'} · 100cm는 보류 경계에 포함되지 않습니다.`;scene?.set('quality',lab,beat);};}
  if(chapter===3){host.innerHTML='<p class="eyebrow">실제 분할 규칙</p><h3>이 사람은 어느 묶음일까?</h3><label>수행자<select id="signer">'+Array.from({length:16},(_,i)=>`<option>REAL${String(i+1).padStart(2,'0')}</option>`).join('')+'</select></label><p id="lab-result"></p>';$('#signer').onchange=e=>{$('#lab-result').textContent=['REAL03','REAL12'].includes(e.target.value)?'test · 학습에서 보지 않은 평가 사람':['REAL04','REAL11'].includes(e.target.value)?'val · 검증 사람':'train · 학습 사람';};$('#signer').dispatchEvent(new Event('change'));}
  if(chapter===4){host.innerHTML='<p class="eyebrow">2차원 축소 예시 · 실제 코드북 아님</p><h3>가장 가까운 코드를 고르기</h3><label>특징의 x 좌표 <output id="lab-value"></output><input id="lab-range" type="range" min="0" max="100" value="42"></label><div id="quantizer"></div><p id="lab-result"></p>';$('#lab-range').oninput=e=>{const x=+e.target.value/100,centers=[.1,.35,.65,.9],ds=centers.map(v=>(v-x)**2),idx=ds.indexOf(Math.min(...ds));$('#lab-value').textContent=x.toFixed(2);$('#quantizer').innerHTML=centers.map((v,i)=>`<div class="code-vector ${i===idx?'selected':''}"><b>#${i}</b><span>(${v}, 0.5)</span><small>d²=${ds[i].toFixed(4)}</small></div>`).join('');$('#lab-result').textContent=`특징 (${x.toFixed(2)}, 0.5) → argmin → 토큰 ${idx}. 같은 y이므로 x 차이의 제곱으로 비교합니다.`;};}
  if(chapter===5){host.innerHTML='<p class="eyebrow">동일 프레임 평균 · 손 MPJPE</p><h3>E4b → E5</h3><label>평가 구간<select id="region"><option value="0">WORD 전체</option><option value="1" selected>SEN 전체</option><option value="2">SEN 단어 구간</option><option value="3">SEN 전환</option></select></label><div id="bars"></div><p id="lab-result"></p>';$('#region').onchange=e=>{const [a,b]=[[27.1,28.4],[37.3,28.1],[50.6,33.7],[52.7,34.3]][+e.target.value];$('#bars').innerHTML=[['E4b',a],['E5',b]].map(([name,v])=>`<div class="bar-row"><span>${name}</span><div style="width:${v/55*65}%"></div><b>${v}mm</b></div>`).join('');$('#lab-result').textContent=`${Math.abs(a-b).toFixed(1)}mm ${b<a?'감소':'증가'} · 낮을수록 원본 좌표에 가깝습니다. 출처: 2026-10-16 개발 기록`;};$('#region').dispatchEvent(new Event('change'));}
  if(chapter===6){host.innerHTML='<p class="eyebrow">전달 패키지</p><h3>같은 버전으로 연결하기</h3><ul><li>tokens_e5.json · v0.3-e5</li><li>vq_e5/model.pt · 대응 코드북</li><li>full_all.json · 최신 exclude</li><li>heldout_sentences · 생성 학습 제외</li></ul><p>실제 파일을 읽거나 전송하지 않는 전달 항목 안내입니다.</p>';}
  $('#lab-range')?.dispatchEvent(new Event('input'));
}

function switchView(next){view=next;clearInterval(exampleTimer);exampleTimer=null;for(const key of ['film','code','terms']){$(`#${key}-view`).hidden=key!==next;document.querySelector(`[data-view="${key}"]`).classList.toggle('active',key===next);}
  if(next!=='film')setPlaying(false);if(next==='code'){renderFiles();renderFile();}window.scrollTo({top:0,behavior:'instant'});refreshIcons();}
function renderFiles(){
  const query=search.toLowerCase();const filtered=catalog.files.filter(f=>!query||f.path.toLowerCase().includes(query)||f.functions.some(fn=>fn.name.toLowerCase().includes(query)));
  $('#file-list').innerHTML=filtered.length?filtered.map(f=>`<button data-file="${f.path}" class="${selectedFile===f.path?'active':''}"><span>${f.path.split('/')[0]}</span><strong>${f.path.split('/')[1]}</strong><small>${f.functions.length} 함수</small></button>`).join(''):'<p class="empty">일치하는 파일·함수가 없습니다.</p>';
}
function openFile(path,name=''){selectedFile=path;selectedFunction=name;exampleStep=0;activeDepth='beginner';search='';$('#search').value='';switchView('code');history.replaceState(null,'',`#code/${path}${name?'@'+encodeURIComponent(name):''}`);}
function renderExample(){
  const e=examples[selectedFile];if(!e||!$('#example-stage'))return;
  $('#example-stage').innerHTML=`<div class="example-phase">${['들어온 것','이 파일이 하는 일','나온 것'][exampleStep]}</div><div class="example-payload">${esc(e[2][exampleStep])}</div><p>${esc(e[3][exampleStep])}</p>`;
  document.querySelectorAll('[data-example-step]').forEach(b=>{b.classList.toggle('active',+b.dataset.exampleStep===exampleStep);b.setAttribute('aria-current',+b.dataset.exampleStep===exampleStep?'step':'false');});
  if(!reduced)$('#example-stage').animate([{opacity:.15,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:400});
}
function renderFile(){
  clearInterval(exampleTimer);exampleTimer=null;
  const file=catalog.files.find(f=>f.path===selectedFile);const guide=guides[file.path];
  $('#file-heading').innerHTML=`<p class="mono">ml/${file.path}</p><h2>${guide[0]}</h2><p class="flow">${guide[1]}</p>`;
  document.querySelectorAll('[data-depth]').forEach(b=>{b.classList.toggle('active',b.dataset.depth===activeDepth);b.setAttribute('aria-selected',String(b.dataset.depth===activeDepth));});
  const host=$('#code-content');
  if(activeDepth==='beginner'){
    const e=examples[file.path];
    host.innerHTML=`<section class="reading"><div class="file-story-intro"><span class="eyebrow">작업 배경</span><h3>${esc(e[0])}</h3><p><b>구현</b> ${esc(e[1])}</p></div>
      <div class="example-theater"><div class="example-heading"><span>작은 예시로 따라가기</span><button id="example-play">${icon('play')} 순서대로 보기</button></div><nav class="example-timeline" aria-label="예시 단계">${['입력','처리','결과'].map((s,i)=>`<button data-example-step="${i}"><span>0${i+1}</span>${s}</button>`).join('')}</nav><div id="example-stage" aria-live="polite"></div><p class="fixture-note">설명을 위한 작은 예시입니다. Python 실행 결과나 실제 클립이 아닙니다. 실험 비교 수치는 기록 인용입니다.</p></div>
      <div class="example-links"><button data-function="${e[5]}">이 일을 하는 함수 <code>${e[5]}</code> ${icon('arrow-up-right')}</button><button data-file="${e[4]}">다음 연결 <code>${e[4]}</code> ${icon('arrow-up-right')}</button></div>
      <h3>실제 코드에서는 이렇게 이어져요</h3><p>${guide[2]}</p><h3>여기서 헷갈리지 않기</h3><p>${guide[3]}</p><details class="source-examples"><summary>원문 설명과 실행 예 펼치기</summary><pre class="docstring">${esc(file.doc||'별도 모듈 설명 없음. 아래 함수와 원문을 확인하세요.')}</pre><p class="muted">원문 예제는 참고용입니다. 이 페이지는 Python 명령을 실행하지 않습니다.</p></details><h3>이 파일의 함수 하나씩 보기</h3><div class="function-index">${file.functions.map(f=>`<button data-function="${f.name}"><code>${f.name}</code><span>L${f.line} ${icon('arrow-up-right')}</span></button>`).join('')}</div></section>`;
    renderExample();$('#example-play').onclick=()=>{if(exampleTimer){clearInterval(exampleTimer);exampleTimer=null;$('#example-play').innerHTML=icon('play')+' 순서대로 보기';refreshIcons();return;}exampleStep=0;renderExample();$('#example-play').innerHTML=icon('pause')+' 멈추기';refreshIcons();exampleTimer=setInterval(()=>{if(exampleStep===2){clearInterval(exampleTimer);exampleTimer=null;$('#example-play').innerHTML=icon('play')+' 다시 보기';refreshIcons();return;}exampleStep++;renderExample();},4500);};
  } else if(activeDepth==='source'){
    host.innerHTML=`<div class="source-meta"><span>${file.source.split('\n').length}줄 · SHA256 ${file.sha256.slice(0,12)}</span><button id="copy-source" title="소스 복사">${icon('copy')} 복사</button></div>${codeHTML(file.source,1)} `;
    $('#copy-source').onclick=async()=>{try{await navigator.clipboard.writeText(file.source);toast('소스를 복사했어요.');}catch{toast('브라우저에서 클립보드 접근을 허용하지 않았습니다.');}};
  } else {
    const fn=file.functions.find(f=>f.name===selectedFunction)||file.functions[0];
    if(!fn){host.innerHTML='<p>정의된 함수가 없습니다. 원문 전체에서 상수를 확인하세요.</p>';return;}
    selectedFunction=fn.name;
  const explanation=details[`${file.path}:${fn.name}`]||details[fn.name]||details[fn.name.split('.').at(-1)];
    host.innerHTML=`<label class="function-select">함수 선택<select id="function-select">${file.functions.map(f=>`<option value="${f.name}" ${f.name===fn.name?'selected':''}>${f.name} · L${f.line}</option>`).join('')}</select></label>
      <h3 class="function-title">${esc(fn.name)}</h3><p class="mono signature">(${esc(fn.signature)})</p>
      ${explanation?`<p class="domain-note">${explanation}</p>`:''}
      ${fn.doc?`<pre class="docstring">${esc(fn.doc)}</pre>`:''}
      <h3>한 블록씩 따라가기</h3><p class="muted">아래는 Python AST에서 추출한 문법 해설입니다. 계산의 목적은 위 설명과 파일 안내를 함께 읽으세요. 줄 번호를 누르면 해당 원문으로 이동합니다.</p>
      <ol class="steps">${fn.steps.map(s=>`<li><button data-line="${s.line}">L${s.line}</button><span>${esc(s.text)}</span></li>`).join('')}</ol>
      <details class="calls"><summary>이 함수가 호출하는 것 (${fn.calls.length})</summary><p>${fn.calls.map(c=>`<code>${esc(c)}</code>`).join(' · ')}</p></details>
      ${codeHTML(fn.source,fn.line)}`;
    $('#function-select').onchange=e=>{selectedFunction=e.target.value;renderFile();refreshIcons();};
  }
  refreshIcons();
}
function codeHTML(source,start){return `<div class="source-code" tabindex="0" aria-label="줄 번호가 있는 Python 소스">${source.split('\n').map((line,i)=>`<div id="line-${start+i}" class="source-line"><span>${start+i}</span><code>${esc(line)||' '}</code></div>`).join('')}</div>`;}

document.addEventListener('click',e=>{
  const v=e.target.closest('[data-view]');if(v){history.replaceState(null,'','#'+v.dataset.view);switchView(v.dataset.view);}
  const c=e.target.closest('[data-chapter]');if(c)seek(starts[+c.dataset.chapter]);
  const f=e.target.closest('[data-file]');if(f){openFile(f.dataset.file);}
  const d=e.target.closest('[data-depth]');if(d){activeDepth=d.dataset.depth;renderFile();}
  const fn=e.target.closest('[data-function]');if(fn){selectedFunction=fn.dataset.function;activeDepth='function';renderFile();}
  const line=e.target.closest('[data-line]');if(line){document.querySelectorAll('.source-line.selected').forEach(n=>n.classList.remove('selected'));const target=$(`#line-${line.dataset.line}`);target?.classList.add('selected');target?.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});}
  const step=e.target.closest('[data-example-step]');if(step){clearInterval(exampleTimer);exampleTimer=null;exampleStep=+step.dataset.exampleStep;renderExample();$('#example-play').innerHTML=icon('play')+' 순서대로 보기';refreshIcons();}
});
$('#search').oninput=e=>{search=e.target.value;renderFiles();};
$('#play').onclick=()=>{if(elapsed>=total)seek(0);setPlaying(!playing);};
$('#previous').onclick=()=>seek(starts[Math.max(0,chapter-1)]);
$('#next').onclick=()=>seek(starts[Math.min(chapters.length-1,chapter+1)]);
function shiftShot(delta){const n=Math.max(0,Math.min(27,chapter*4+beat+delta)),c=Math.floor(n/4);seek(starts[c]+chapters[c].duration*(n%4)/4);}
$('#prev-shot').onclick=()=>shiftShot(-1);$('#next-shot').onclick=()=>shiftShot(1);
$('#shot-code').onclick=()=>{const s=film[chapter][beat];openFile(s[3],s[4]);};
$('#timeline').oninput=e=>seek(e.target.value);
$('#speed').onchange=e=>{speed=+e.target.value;speak();};
$('#voice').onclick=()=>{voiceTouched=true;if(!('speechSynthesis' in window)){toast('이 브라우저에는 음성 읽기가 없습니다. 자막을 이용해 주세요.');return;}voice=!voice;updateVoice();if(voice)speak();else speechSynthesis.cancel();};
$('#resume').onclick=()=>{seek(saved.elapsed);setPlaying(true);$('#resume').hidden=true;};
$('#related-code').onclick=()=>openFile(chapters[chapter].files[0]);
$('#reset-camera').onclick=()=>scene?.reset();
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#film-view').requestFullscreen();}catch{toast('이 브라우저에서 전체 화면을 사용할 수 없습니다.');}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);});
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||view!=='film')return;if(e.code==='Space'){e.preventDefault();setPlaying(!playing);}if(e.key==='ArrowRight')seek(elapsed+10);if(e.key==='ArrowLeft')seek(elapsed-10);});
window.addEventListener('pagehide',()=>{persist();window.speechSynthesis?.cancel();});
renderChapter();
const hash=decodeURIComponent(location.hash.slice(1));
if(hash.startsWith('code/')){const [path,fn]=hash.slice(5).split('@');if(catalog.files.some(f=>f.path===path)){selectedFile=path;selectedFunction=fn||'';if(fn)activeDepth='function';switchView('code');}}
else if(['code','terms'].includes(hash))switchView(hash);
refreshIcons();
if('speechSynthesis' in window){const readyVoice=()=>{if(!voiceTouched&&speechSynthesis.getVoices().some(v=>v.lang.startsWith('ko'))){voice=true;updateVoice();if(playing)speak();}};speechSynthesis.addEventListener('voiceschanged',readyVoice);readyVoice();}
let previous=performance.now(),saveClock=0;
function animate(now){const dt=Math.min((now-previous)/1000,.1);previous=now;
  if(playing){const old=chapter;seek(elapsed+dt*speed,false);if(chapter!==old){progress.add(old);$('#progress-text').textContent=`${progress.size} / 7장 완료`;persist();}}
  if(view==='film'&&!document.hidden){if(playing)animationTime=elapsed;else if(!reduced&&!started)animationTime+=dt*.5;const phase=(elapsed-starts[chapter])/chapters[chapter].duration*4-beat;scene?.direct(phase,reduced);scene?.draw(animationTime);}
  saveClock+=dt;if(saveClock>5){persist();saveClock=0;}requestAnimationFrame(animate);
}requestAnimationFrame(animate);
