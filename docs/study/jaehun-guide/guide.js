'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const lessons = [...document.querySelectorAll('.lesson')];
  const key = 'jaehun-study-2df9317-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) {}
  let completed = new Set(Array.isArray(saved.completed) ? saved.completed : []);
  let current = 0, all = false;
  const persist = () => { try { localStorage.setItem(key, JSON.stringify({completed:[...completed], notes:$('myNotes').value, chapter:lessons[current].id})); return true; } catch (_) { return false; } };
  $('toc').innerHTML = lessons.map(s => `<a class="toc-link" href="#${s.id}" data-chapter="${s.id}"><span class="tick" aria-hidden="true"></span><span>${s.dataset.title}</span></a>`).join('');
  function updateProgress() {
    $('progress').value = completed.size; $('progress').max = lessons.length;
    $('progressText').textContent = `${completed.size} / ${lessons.length}`;
    document.querySelectorAll('.toc-link').forEach(a => {
      const id = a.dataset.chapter;
      a.setAttribute('aria-current', String(id === lessons[current].id));
      a.querySelector('.tick').textContent = completed.has(id) ? '✓' : '·';
    });
    $('done').checked = completed.has(lessons[current].id);
  }
  function route() {
    const targetId = decodeURIComponent(location.hash.slice(1));
    const target = $(targetId);
    let section = target?.closest('.lesson');
    if (!section && !targetId && saved.chapter) section = $(saved.chapter);
    if (!section) section = lessons[0];
    current = lessons.indexOf(section);
    lessons.forEach((s, i) => s.hidden = !all && i !== current);
    if (target?.closest('.file-entry')) {
      $('fileSearch').value = ''; filterFiles();
      target.closest('.file-entry').querySelector('details').open = true;
    }
    if (target?.classList.contains('code-line')) target.closest('details').open = true;
    $('prev').disabled = current === 0; $('next').disabled = current === lessons.length-1;
    $('pageCount').textContent = `${current + 1} / ${lessons.length}`;
    updateProgress(); persist();
    if (target && target !== section) target.scrollIntoView({block:'start'});
    else if (targetId) section.scrollIntoView({block:'start'});
  }
  $('done').addEventListener('change', () => { const id=lessons[current].id; $('done').checked ? completed.add(id) : completed.delete(id); updateProgress();persist(); });
  $('prev').addEventListener('click', () => { if(current>0) location.hash=lessons[current-1].id; });
  $('next').addEventListener('click', () => { if(current<lessons.length-1) location.hash=lessons[current+1].id; });
  $('allMode').addEventListener('click', () => { all=!all;document.body.classList.toggle('all-mode',all);$('allMode').setAttribute('aria-pressed',String(all));$('allMode').textContent=all?'한 장씩 읽기':'전체 이어 읽기';route(); });
  $('myNotes').value = typeof saved.notes === 'string' ? saved.notes : '';
  $('myNotes').addEventListener('input', () => { $('notesStatus').textContent=persist()?'이 브라우저에 메모를 저장했습니다.':'이 환경에서는 저장할 수 없습니다. 필요한 메모는 따로 복사해 주세요.'; });
  function filterFiles() { const query=$('fileSearch').value.trim().toLowerCase();let count=0;document.querySelectorAll('.file-entry').forEach(a=>{a.hidden=!!query&&!a.textContent.toLowerCase().includes(query);if(!a.hidden)count++;});$('searchCount').textContent=`${count}개 파일 표시`; }
  $('fileSearch').addEventListener('input',filterFiles);filterFiles();
  let openBefore=[];
  window.addEventListener('beforeprint',()=>{openBefore=[...document.querySelectorAll('details')].map(d=>[d,d.open]);document.querySelectorAll('.answer,.deeper').forEach(d=>d.open=true);});
  window.addEventListener('afterprint',()=>{openBefore.forEach(([d,o])=>d.open=o);});
  $('print').addEventListener('click',()=>window.print());
  window.addEventListener('hashchange',route);

  // Teaching-only synthetic skeleton. No dataset or model is loaded.
  const line=(x1,y1,x2,y2,color='#175d8c',width=5)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  const text=(x,y,t,color='#536776',size=14)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="Malgun Gothic,sans-serif">${t}</text>`;
  function renderFrame(){
    const f=+$('frameRange').value, wristY=174-f*14, compact=window.innerWidth<=760;
    $('frameSvg').setAttribute('viewBox',compact?'75 5 280 250':'0 0 600 260');
    $('frameValue').textContent=f;
    let s=`<circle cx="190" cy="43" r="21" fill="none" stroke="#175d8c" stroke-width="5"/>`;
    s+=line(190,64,190,181)+line(135,92,245,92)+line(135,92,110,140)+line(110,140,130,185);
    s+=line(245,92,276,119)+line(276,119,315,wristY,'#17746b');
    s+=line(190,181,157,235)+line(190,181,225,235);
    s+=`<circle cx="315" cy="${wristY}" r="9" fill="#17746b"/>`;
    if(!compact){s+=line(333,wristY,383,wristY,'#a1b2be',1)+text(394,wristY+5,`손목 y = ${(wristY/100).toFixed(2)}`);
    for(let i=0;i<8;i++)s+=`<circle cx="${360+i*29}" cy="228" r="${i===f?7:4}" fill="${i===f?'#17746b':'#c8d5df'}"/>`;
    s+=text(360,258,'시간순으로 저장된 8개의 자세', '#536776',12);}
    $('frameSvg').innerHTML=s;
    $('frameReadout').textContent=`한 프레임의 손목 좌표 예시: [x=3.15, y=${(wristY/100).toFixed(2)}, z=0.00]. 다음 프레임에서는 값이 달라집니다. y가 작아지면 화면에서 위로 올라갑니다.`;
  }
  $('frameRange').addEventListener('input',renderFrame);renderFrame();
  function renderNorm(){ const o=+$('originRange').value,s=+$('scaleRange').value;$('originValue').textContent=o.toFixed(1);$('scaleValue').textContent=s.toFixed(2);$('rawPoint').textContent=`${(o+s).toFixed(2)}m`;$('centerPoint').textContent=`${s.toFixed(2)}m`;$('normReadout').textContent=`(손 ${(o+s).toFixed(2)} − 기준 위치 ${o.toFixed(2)}) ÷ 어깨너비 ${s.toFixed(2)} = 1.00`; }
  ['originRange','scaleRange'].forEach(id=>$(id).addEventListener('input',renderNorm));renderNorm();
  const codes=[[1.5,2],[2,7.5],[4.5,4],[6,8],[7.5,2],[9,6]];
  function renderVQ(){ const x=+$('vx').value,y=+$('vy').value;$('vxOut').textContent=x.toFixed(1);$('vyOut').textContent=y.toFixed(1);const distances=codes.map(([a,b])=>(x-a)**2+(y-b)**2);const idx=distances.indexOf(Math.min(...distances));const compact=window.innerWidth<=760;const px=v=>55+v*(compact?27:49),py=v=>270-v*23;
    $('vqSvg').setAttribute('viewBox',compact?'0 0 360 310':'0 0 600 310');
    let s='';for(let i=0;i<=10;i+=2){s+=line(px(i),py(0),px(i),py(10),'#e0e7ed',1)+line(px(0),py(i),px(10),py(i),'#e0e7ed',1)+text(px(i)-3,294,i,'#657a88',12)+text(30,py(i)+4,i,'#657a88',12);}
    s+=line(px(x),py(y),px(codes[idx][0]),py(codes[idx][1]),'#17746b',2);
    codes.forEach(([a,b],i)=>{s+=`<circle cx="${px(a)}" cy="${py(b)}" r="${i===idx?13:9}" fill="${i===idx?'#17746b':'#a4b9c8'}"/>`+text(px(a)+16,py(b)+5,`코드 ${i}`, '#192b3b',13);});
    s+=`<path d="M${px(x)} ${py(y)-9}l9 9-9 9-9-9z" fill="#ae542c" stroke="white" stroke-width="2"/>`+text(56,18,'◆ 입력 특징    ● 대표 특징', '#536776',13);
    $('vqSvg').innerHTML=s;$('vqResult').textContent=`가장 가까운 대표: 코드 ${idx}. 제곱 거리 ${(distances[idx]).toFixed(2)} → 번호 ${idx}로 표현합니다.`;
  }
  ['vx','vy'].forEach(id=>$(id).addEventListener('input',renderVQ));renderVQ();
  window.addEventListener('resize',()=>{renderFrame();renderVQ();});
  let w=0,iterations=0;
  function renderTrain(){const pred=2*w,loss=(pred-6)**2;$('trainReadout').innerHTML=`${iterations}번 수정 · w = <b>${w.toFixed(4)}</b><br>예측 2×w = <b>${pred.toFixed(4)}</b> / 정답 6<br>제곱 오차 (예측−6)² = <b>${loss.toFixed(6)}</b>`;}
  $('trainStep').addEventListener('click',()=>{const gradient=4*(2*w-6);w-=0.05*gradient;iterations++;renderTrain();});$('trainReset').addEventListener('click',()=>{w=0;iterations=0;renderTrain();});renderTrain();
  function renderLength(){const t=+$('lengthRange').value,n=Math.floor(t/4),used=n*4;$('lengthValue').textContent=t;$('lengthReadout').innerHTML=`${t}프레임 → 끝 ${t-used}프레임 제외 → <b>${used}프레임 / 토큰 ${n}개</b><br>이 토큰을 디코딩하면 ${used}프레임이 나옵니다.`;$('tokenStrip').innerHTML=Array.from({length:n},(_,i)=>`<span>${i+1}</span>`).join('');}
  $('lengthRange').addEventListener('input',renderLength);renderLength();
  function renderMetric(){const b=+$('metricRange').value;const weighted=(10*10+30*b)/(10+b);$('metricValue').textContent=b;$('metricReadout').innerHTML=`클립 평균: (10 + 30) ÷ 2 = <b>20.0mm</b><br>프레임 평균: (10×10 + 30×${b}) ÷ ${10+b} = <b>${weighted.toFixed(1)}mm</b>`;}
  $('metricRange').addEventListener('input',renderMetric);renderMetric();
  const rows=[['WORD 전체',27.1,28.4],['SEN 전체',37.3,28.1],['SEN 단어',50.6,33.7],['SEN 전환',52.7,34.3]];
  $('experimentChart').innerHTML='<p class="chart-legend">손 오차 mm · 낮을수록 원본에 가까움 · 막대 공통 범위 0~60mm</p>'+rows.map(([name,a,b])=>`<div class="chart-row"><div class="chart-name">${name}</div><div><div class="bar-track"><div class="bar e4" style="width:${a/60*100}%"></div><span>E4b · ${a}mm</span></div><div class="bar-track"><div class="bar e5" style="width:${b/60*100}%"></div><span>E5 · ${b}mm</span></div></div></div>`).join('');
  route();
})();
