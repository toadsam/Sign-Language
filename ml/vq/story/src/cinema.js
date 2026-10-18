import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const C={mint:0x86dfca,pink:0xefb7cb,gold:0xe1c879,red:0xff796b,white:0xe5ece8,dim:0x536b61};
const ease=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
const mix=THREE.MathUtils.lerp;

// Authored workflow diagrams only, not motion capture or learned reconstructions.
export function createScene(host){
 const scene=new THREE.Scene();scene.background=new THREE.Color('#17191b');
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(renderer.domElement);
 renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','재훈의 작업을 순서대로 보여주는 합성 3D 장면');
 const camera=new THREE.PerspectiveCamera(36,1,.1,100);camera.position.set(0,.25,9);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableDamping=true;controls.minDistance=4;controls.maxDistance=25;
 let manual=false;controls.addEventListener('start',()=>manual=true);
 scene.add(new THREE.HemisphereLight(0xeafff5,0x354539,2.2));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,5,7);scene.add(key);
 const stage=new THREE.Group();scene.add(stage);
 const ground=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-4,-1.65,0),new THREE.Vector3(4,-1.65,0)]),new THREE.LineBasicMaterial({color:0x363a3e}));scene.add(ground);
 const ball=new THREE.SphereGeometry(.032,10,8),bone=new THREE.CylinderGeometry(.014,.014,1,8),cube=new THREE.BoxGeometry(.11,.11,.11);
 const a=new THREE.Vector3(),b=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
 const mats=Object.fromEntries(Object.entries(C).map(([n,color])=>[n,new THREE.MeshStandardMaterial({color,metalness:.25,roughness:.4})]));
 const edges=[[0,1],[1,2],[2,3],[3,4],[1,5],[5,6],[6,7],[1,8],[0,9],[0,10],[9,11],[10,12]];
 const parents=[-1,0,1,2,3,0,5,6,7,0,9,10,11,0,13,14,15,0,17,18,19];
 for(const base of [13,34])parents.forEach((p,i)=>{if(p>=0)edges.push([base+p,base+i]);});
 const actors=Array.from({length:3},()=>{const group=new THREE.Group();stage.add(group);const dots=Array.from({length:125},(_,i)=>{const m=new THREE.Mesh(ball,mats.mint);if(i>=55)m.scale.setScalar(.42);group.add(m);return m;});const bones=edges.map(()=>{const m=new THREE.Mesh(bone,mats.mint);group.add(m);return m;});return {group,dots,bones};});
 const alert=new THREE.Mesh(new THREE.TorusGeometry(.105,.017,8,36),mats.red);stage.add(alert);
 const preserve=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.5,2.4,.55)),new THREE.LineBasicMaterial({color:C.dim}));stage.add(preserve);
 const lattice=new THREE.InstancedMesh(cube,new THREE.MeshStandardMaterial({color:0xffffff,metalness:.25,roughness:.4}),512);stage.add(lattice);const dummy=new THREE.Object3D();
 const query=new THREE.Mesh(new THREE.OctahedronGeometry(.13),mats.white);stage.add(query);
 const tickets=Array.from({length:24},()=>{const m=new THREE.Mesh(new THREE.BoxGeometry(.25,.38,.08),mats.mint);stage.add(m);return m;});
 const bars=Array.from({length:4},()=>{const m=new THREE.Mesh(new THREE.BoxGeometry(.7,1,.45),mats.mint);stage.add(m);return m;});
 const arrow=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(-.5,0,0),1,C.gold,.16,.09);stage.add(arrow);
 const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);const measure=new THREE.Line(geo,new THREE.LineDashedMaterial({color:C.red,dashSize:.07,gapSize:.04}));stage.add(measure);
 const labels=new THREE.Group();stage.add(labels);const textures=[];
 function label(text,x,y,color='#d9e9df',width=2.4){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=160;const ctx=canvas.getContext('2d');ctx.font='500 46px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,512,80,980);const texture=new THREE.CanvasTexture(canvas);textures.push(texture);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));sprite.position.set(x,y,.6);sprite.scale.set(width,width*160/1024,1);labels.add(sprite);}
 let chapter=0,shot=0,phase=0,time=0,reduced=false;
 const names=['motion','prepare','quality','split','vq','evidence','handoff'];
 function titles(){
  for(const child of [...labels.children]){child.material.dispose();labels.remove(child);}textures.splice(0).forEach(t=>t.dispose());
  const top=(s)=>label(s,0,1.8,'#e1c879',5.4),bottom=(s)=>label(s,0,-1.5,'#86dfca',4.5);
  if(chapter===0){
   if(shot===0){top('사람의 손짓을 어떻게 기록할까?');bottom('움직이는 점의 위치를 기록');}
   if(shot===1){label('몸 13',-1.7,1.4,'#86dfca',1.3);label('양손 42',1.7,.3,'#efb7cb',1.6);label('얼굴 70',1.6,1.4,'#e5ece8',1.5);bottom('125 × 3 = 375개의 숫자');}
   if(shot===2){[-1.8,0,1.8].forEach((x,i)=>label(`${i+1}번 순간`,x,-1.1,'#e5ece8',1.4));top('시간 →');}
   if(shot===3){label('자세',-1.6,-1.35);label('[x, y, z]',1.7,1.15,'#e1c879',2);label('순서대로 쌓인 숫자',1.7,-1.05,'#86dfca',2.3);}
  }
  if(chapter===1){
   if(shot===0){['ZIP','정면 F','변환 확인'].forEach((s,i)=>label(s,(i-1)*1.8,1.4,['#e1c879','#86dfca','#efb7cb'][i],1.6));}
   if(shot===1){label('사람 A · 작고 왼쪽',-1.6,-1.35,'#86dfca',2.7);label('사람 B · 크고 오른쪽',1.45,-1.35,'#e1c879',2.7);}
   if(shot===2){top('목 위치 → 방향 → 어깨너비');bottom('같은 기준으로 겹쳐집니다');}
   if(shot===3){label('좌표',-1.7,1.3);label('이름 + 시간',1.7,1.3,'#e1c879');bottom('가상 라벨: 학교 / 1.0~2.0초');}
  }
  if(chapter===2){
   if(shot===0){label('정상 동작 중…',-1.5,-1.35,'#86dfca',2.1);label('귀 위치 오류',1.9,1.6,'#ff796b',2.1);}
   if(shot===1){top('시간을 멈추고 문제 점을 확인');label('정상 귀 위치',-.9,-1.15,'#86dfca',2);bottom('실제 움직임이 아닌 검출 오류');}
   if(shot===2){label('원본 보관',-1.9,1.55,'#9bb0a4',1.8);label('반대쪽 귀에서 위치 추정',.9,1.8,'#86dfca',3.5);label('나머지 관절은 그대로',.9,-1.4,'#efb7cb',3);}
   if(shot===3){label('학습에 사용',-1.65,1.4,'#86dfca',2.4);label('학습 보류',1.65,1.4,'#ff796b',2.4);bottom('검사 기준을 목록으로 남김');}
  }
  if(chapter===3){
   if(shot<2){['연습 12명','검증 2명','시험 2명'].forEach((s,i)=>label(s,(i-1)*1.9,1.45,['#86dfca','#e1c879','#efb7cb'][i],1.7));label('REAL03 · REAL12',1.9,-1.3,'#efb7cb',2.2);}
   else{label('연습: 아는 단어들',-1.6,1.4,'#86dfca',2.5);label('시험: 새로운 조합',1.6,1.4,'#efb7cb',2.5);label('나',-2,.35,'#86dfca',.8);label('학교',-1.2,-.2,'#e1c879',1);label('가다',-2,-.7,'#efb7cb',1);label('나 → 학교 → 가다',1.3,0,'#e5ece8',3);bottom('이 문장은 개념 설명용 예시');}
  }
  if(chapter===4){
   top(['80장의 자세 → 20칸의 특징','512개 사전에서 가장 가까운 특징 선택','번호 → 사전의 특징 → 복원된 자세','동작을 번호로, 번호를 동작으로'][shot]);
   if(shot===0){label('80프레임',-1.5,-1.4,'#efb7cb',2);label('20개 위치',1.5,-1.4,'#86dfca',2);}
   if(shot===1)bottom('선택된 번호 = 토큰');
   if(shot===2){label('예시 번호: 7 · 12 · 4',-1.6,-1.35,'#efb7cb',2.8);label('몸·손 복원',1.4,-1.35,'#86dfca',2.5);}
   if(shot===3){label('원본',-1.6,-1.35,'#e5ece8',1.4);label('복원 원리 예시',1.6,-1.35,'#86dfca',2.4);label('실제 E5 복원 결과가 아닙니다',0,1.35,'#9bb0a4',4);}
  }
  if(chapter===5){
   if(shot===0){top('낮을수록 손 위치 오차가 작음');['E1 28.1','E4a 29.9','E4b 27.0'].forEach((s,i)=>label(s,(i-1)*1.6,-1.35,i===2?'#86dfca':'#efb7cb',1.9));}
   if(shot===1){['단어 A','사이의 움직임','단어 B'].forEach((s,i)=>label(s,(i-1)*1.9,1.45,i===1?'#ff796b':'#86dfca',2));bottom('전환 구간도 배워야 합니다');}
   if(shot>=2){top('같은 SEN 평가 · 손 오차(mm)');label('E4b 37.3',-1.3,-1.35,'#efb7cb',2.2);label('E5 28.1',1.3,-1.35,'#86dfca',2.2);if(shot===3)label('WORD는 27.1 → 28.4mm 증가',0,1.3,'#efb7cb',4.5);}
  }
  if(chapter===6){
   if(shot===0){['단어 목록','번호','동작'].forEach((s,i)=>label(s,(i-1)*1.9,1.4,['#e1c879','#efb7cb','#86dfca'][i],2));bottom('다음 모델 → 재훈의 디코더');}
   if(shot===1){label('토큰',-1.7,1.4,'#efb7cb',1.6);label('E5 사전',1.7,1.4,'#86dfca',2);bottom('같은 버전끼리 연결');}
   if(shot>=2){['준비','점검','분할','학습','평가','전달'].forEach((s,i)=>label(s,(i%3-1)*1.8,i<3?.8:-.8,['#86dfca','#efb7cb','#e1c879'][i%3],1.4));top('정재훈의 작업');}
  }
 }
 function pose(r,t,ear=0,points=false,color='mint'){
  const p=[[0,1,0],[0,.61,0],[-.43,.55,0],[-.65,.08,.08],[-.43,.35+Math.sin(t)*.22,.35],[.43,.55,0],[.65,.09,0],[.44,.43+Math.cos(t)*.24,.3],[0,-.77,0],[-.1,1.08,.04],[.1,1.08,.04],[-.22,1.02,0],[.22+ear,1.02+ear*.22,0]];
  for(const w of [p[7],p[4]]){p.push([...w]);for(let f=0;f<5;f++)for(let j=1;j<=4;j++)p.push([w[0]+(f-2)*.047*j/2,w[1]+j*(f===0?.035:.056),w[2]+Math.sin(t+f)*.018*j]);}
  for(let i=0;i<70;i++){const angle=i*Math.PI*2/70;p.push([Math.cos(angle)*.22,1.01+Math.sin(angle)*.28,.01]);}
  p.forEach((v,i)=>{r.dots[i].position.fromArray(v);r.dots[i].material=i===12&&ear>.1?mats.red:i>=55?mats.white:i>=13?mats.pink:mats[color];});
  edges.forEach(([x,y],i)=>{const m=r.bones[i];m.visible=!points;a.copy(r.dots[x].position);b.copy(r.dots[y].position);m.position.copy(a).add(b).multiplyScalar(.5);m.scale.y=b.sub(a).length();m.quaternion.setFromUnitVectors(up,b.normalize());m.material=y===12&&ear>.1?mats.red:x>=13?mats.pink:mats[color];});
 }
 function actor(i,x,y=0,scale=1,t=time,ear=0,points=false){const r=actors[i];r.group.visible=true;r.group.position.set(x,y,0);r.group.scale.setScalar(scale);r.group.rotation.set(0,0,0);pose(r,t,ear,points,['mint','gold','dim'][i]);return r;}
 function ticket(i,x,y,color='mint',s=1){const m=tickets[i];m.visible=true;m.position.set(x,y,0);m.rotation.set(0,.2,0);m.scale.setScalar(s);m.material=mats[color];}
 function field(count,mode,p){lattice.visible=true;lattice.count=count;for(let i=0;i<count;i++){
  if(mode==='book')dummy.position.set((i%16-7.5)*.22,(Math.floor(i/16)%8-3.5)*.22,(Math.floor(i/128)-1.5)*.24);
  else if(mode==='compress')dummy.position.set((i%20-9.5)*.21,mix((Math.floor(i/20)-1.5)*.3,0,p),0);
  else dummy.position.set((i%10-4.5)*.2,(Math.floor(i/10)-.5)*.23,0);
  dummy.scale.setScalar(mode==='book'&&i===124?1.8:1);dummy.updateMatrix();lattice.setMatrixAt(i,dummy.matrix);lattice.setColorAt(i,new THREE.Color(i===124?C.gold:i%4===0?C.pink:C.mint));
 }lattice.instanceMatrix.needsUpdate=true;lattice.instanceColor.needsUpdate=true;}
 function bar(i,x,h,color='mint'){const m=bars[i];m.visible=true;m.material=mats[color];m.position.set(x,-1+h/2,0);m.scale.y=h;}
 function render(){
  actors.forEach(r=>r.group.visible=false);tickets.forEach(m=>m.visible=false);bars.forEach(m=>m.visible=false);lattice.visible=alert.visible=arrow.visible=preserve.visible=measure.visible=query.visible=false;
  lattice.position.set(0,0,0);lattice.rotation.set(0,.18,0);lattice.scale.setScalar(1);
  const p=reduced?1:ease(phase*1.8),t=time*.7;
  if(chapter===0){if(shot<2)actor(0,0,0,1.18,t,0,shot===1&&phase<.5);if(shot===2)[-1.8,0,1.8].forEach((x,i)=>actor(i,x,0,.75,i*.9));if(shot===3){actor(0,-1.6,0,1,t);field(20,'tokens',0);lattice.position.x=1.6;arrow.visible=true;}}
  if(chapter===1){
   if(shot===0)for(let i=0;i<18;i++){const g=i%3,j=Math.floor(i/3);ticket(i,mix(-1.8+(i%2)*.15,(g-1)*1.8+(j%2)*.3,p),mix((i/18-.5)*1.6,(Math.floor(j/2)-1)*.52,p),['gold','mint','pink'][g]);}
   if(shot===1){actor(0,-1.5,-.25,.75,t);actor(1,1.4,.15,1.3,t);actors[1].group.rotation.y=.5;}
   if(shot===2){actor(0,mix(-1.5,0,p),mix(-.25,0,p),mix(.75,1,p),t);actor(1,mix(1.4,.025,p),mix(.15,0,p),mix(1.3,1,p),t);actors[1].group.rotation.y=mix(.5,0,p);}
   if(shot===3){actor(0,-1.7,0,.95,t);for(let i=0;i<6;i++)ticket(i,1+(i%3)*.47,(Math.floor(i/3)-.5)*.5,i<3?'gold':'pink');arrow.visible=true;}
  }
  if(chapter===2){
   if(shot<2){const spike=shot===0?ease((phase-.18)*4)*1.8:1.8;const r=actor(0,-.7,-.1,1.15,shot===0&&phase<.22?t:1.2,spike);alert.visible=spike>.2;alert.position.copy(r.dots[12].position).multiplyScalar(1.15).add(r.group.position);if(shot===1){measure.visible=true;const from=r.dots[10].position.clone().multiplyScalar(1.15).add(r.group.position);geo.setFromPoints([from,alert.position]);measure.computeLineDistances();}}
   if(shot===2){actor(2,-1.9,-.05,.65,1.2,.9);preserve.visible=true;preserve.position.set(-1.9,.2,0);preserve.scale.set(.8,.8,1);const r=actor(0,.8,0,1.05,1.2,1.2*(1-p));alert.visible=p<.98;alert.position.copy(r.dots[12].position).multiplyScalar(1.05).add(r.group.position);}
   if(shot===3)for(let i=0;i<16;i++){const bad=i%4===0;ticket(i,mix((i%4-1.5)*.4,bad?1.5+(i%2)*.32:-2.1+(i%3)*.38,p),(Math.floor(i/4)-1.5)*.4,bad?'red':'mint');}
  }
  if(chapter===3){if(shot<2)for(let i=0;i<16;i++){const g=i<12?0:i<14?1:2,j=i<12?i:i%2;ticket(i,mix((i%4-1.5)*.5,(g-1)*1.9+(g===0?(j%3-1)*.35:0),p),mix((Math.floor(i/4)-1.5)*.5,g===0?(Math.floor(j/3)-1.5)*.35:(j-.5)*.55,p),['mint','gold','pink'][g]);}else arrow.visible=true;}
  if(chapter===4){
   if(shot===0)field(p>.98?20:80,'compress',p);
   if(shot===1){field(512,'book',0);lattice.rotation.y=.2+Math.sin(time*.12)*.2;alert.visible=true;alert.position.set(.99,.77,-.36).applyEuler(lattice.rotation);alert.scale.setScalar(1.3);query.visible=true;query.position.lerpVectors(new THREE.Vector3(-2.4,.3,1),alert.position,p);query.rotation.y=time;}
   if(shot===2){field(20,'tokens',0);lattice.position.x=-1.7;lattice.scale.setScalar(.75);actor(0,1.6,0,.95,t);arrow.visible=true;}
   if(shot===3){actor(0,-1.6,0,.95,t);actor(1,1.6,0,.95,t+.08);arrow.visible=true;}
  }
  if(chapter===5){if(shot===0)[28.1,29.9,27].forEach((v,i)=>bar(i,(i-1)*1.6,v/16*(.15+.85*p),i===2?'mint':'pink'));if(shot===1){actor(0,-1.9,-.1,.7,.3);actor(1,1.9,-.1,.7,2);actor(2,0,-.1,.7,mix(.3,2,p));}if(shot>=2){bar(0,-1.3,37.3/19*(.15+.85*p),'pink');bar(1,1.3,28.1/19*(.15+.85*p),'mint');}}
  if(chapter===6){if(shot===0){for(let i=0;i<3;i++)ticket(i,-2.1+i*.3,.1,'gold');field(12,'tokens',0);lattice.scale.setScalar(.55);actor(0,1.9,-.1,.8,t);}if(shot===1){for(let i=0;i<8;i++)ticket(i,-1.8+(i%2)*.3,(Math.floor(i/2)-1.5)*.3,'pink',.6);field(512,'book',0);lattice.position.x=1.3;lattice.scale.setScalar(.55);arrow.visible=true;}if(shot>=2)for(let i=0;i<6;i++)ticket(i,(i%3-1)*1.8,i<3?.35:-1.25,['mint','pink','gold'][i%3],.7+.25*ease((phase-i*.1)*4));}
  if(!manual){const base=Math.max(8.5,5.9/(2*Math.tan(THREE.MathUtils.degToRad(18))*camera.aspect)),close=chapter===2&&shot===1;camera.position.set(close?.45:Math.sin(phase*Math.PI)*.25,close?.55:.2,base*(close?.86:1-.055*p));controls.target.set(close?.35:0,close?.45:.1,0);}
  controls.update();renderer.render(scene,camera);
 }
 const resize=()=>{const {width,height}=host.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();};new ResizeObserver(resize).observe(host);resize();titles();
 return {set(name,value=0,beat=0){const next=names.indexOf(name);if(next!==chapter||beat!==shot){chapter=next;shot=beat;manual=false;alert.scale.setScalar(1);titles();}},direct(p,reduce=false){phase=p;reduced=reduce;},draw(t){time=t;render();},reset(){manual=false;controls.target.set(0,.1,0);},renderer};
}
