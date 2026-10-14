import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import ReconstructionMetrics from './ReconstructionMetrics.web';
import AiViewerImport from './AiViewerImport.web';
import RecordingControls from './RecordingControls';
import { useCanvasRecorder } from './useCanvasRecorder';
import PerformanceCheck from './PerformanceCheck';
import { useRenderCheck } from './useRenderCheck';
import MotionCanvas from './MotionCanvas.web';
import { decodeMotion } from './motion';
import type { DecodedMotion } from './motion';
import type { ComparisonPlayerProps } from './ComparisonPlayer';
import { createComparisonSamples, createReconstructionSamples } from './demo-comparison';
import { frameAtTime, TIMELINE_FPS, timelineFrames } from './timeline';

type Slot = { label: string; name: string; motion: DecodedMotion; error: string | null; loading: boolean };
const initialSlots = (mode: ComparisonPlayerProps['mode']): Slot[] => {
  const pair = mode === 'reconstruction';
  return (pair ? createReconstructionSamples() : createComparisonSamples()).map((r, i) => ({
    label: (pair ? ['원본', '복원'] : ['원본', 'B1', 'B2', '우리 방법'])[i],
    name: pair ? (i === 0 ? '합성 원본 샘플' : '손 좌표를 변형한 합성 복원 샘플') : '합성 샘플 ' + (i + 1),
    motion: decodeMotion(r), error: null, loading: false,
  }));
};
const control: CSSProperties = { background: '#232935', color: '#edf0fa', border: '1px solid #495266', borderRadius: 8, padding: '8px 12px', font: 'inherit' };
export default function ComparisonPlayer({mode = 'four'}: ComparisonPlayerProps) {
  const pair = mode === 'reconstruction';
  const check=useRenderCheck();
  const recorder=useCanvasRecorder();
  const {active:recordingActive,stop:stopRecording}=recorder;
  const canvases=useRef<(HTMLCanvasElement|null)[]>([]);
  const [recordSlot,setRecordSlot]=useState(0);
  const [importing,setImporting]=useState(false);
  const recordEnd=useRef(0);
  const [finalSlot,setFinalSlot]=useState<number|null>(null);
  const [slots, setSlots] = useState(()=>initialSlots(mode));
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [yaw, setYaw] = useState(0), [pitch, setPitch] = useState(0);
  const [showBody, setShowBody] = useState(true), [showHands, setShowHands] = useState(true), [showFace, setShowFace] = useState(false);
  const cursor = useRef(0), versions = useRef([0, 0, 0, 0]);
  const count = timelineFrames(slots.map(s => s.motion.response)), last = count - 1;
  const time = Math.min(frame, last) / TIMELINE_FPS;
  const seek = (n: number) => { setFinalSlot(null); cursor.current = n; setFrame(n); setPlaying(false); };
  useEffect(() => () => { versions.current = versions.current.map(v => v + 1); }, []);
  useEffect(() => {
    if (!playing) return;
    let id = 0, previous: number | undefined;
    const tick = (now: number) => {
      const dt = previous === undefined ? 0 : Math.min((now - previous) / 1000, .1); previous = now;
      cursor.current += dt * TIMELINE_FPS * speed;
      if(recordingActive.current && cursor.current>=recordEnd.current){cursor.current=Math.max(0,Math.ceil(recordEnd.current)-1);setFrame(Math.floor(cursor.current));setFinalSlot(recordSlot);setPlaying(false);stopRecording(true);return;}
      cursor.current %= count;
      setFrame(Math.floor(cursor.current)); id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id);
  }, [playing, speed, count, recordSlot,recordingActive,stopRecording]);

  const load = async (index: number, file: File | undefined) => {
    if (!file) return;
    const version = ++versions.current[index];
    setSlots(old => old.map((s, i) => i === index ? { ...s, loading: true, error: null } : s));
    try {
      if (file.size > 40000000) throw new Error('40MB 이하 JSON을 선택해주세요.');
      const motion = decodeMotion(JSON.parse(await file.text()));
      if (version !== versions.current[index]) return;
      setSlots(old => old.map((s, i) => i === index ? { ...s, name: file.name, motion, error: null, loading: false } : s));
      seek(0);
    } catch (e) {
      if (version !== versions.current[index]) return;
      setSlots(old => old.map((s, i) => i === index ? { ...s, loading: false, error: e instanceof Error ? e.message : '불러오기 실패' } : s));
    }
  };
  return <section style={{ fontFamily: 'system-ui,sans-serif', color: '#edf0fa' }} aria-label={pair ? '원본과 복원 동작 비교' : '4개 동작 비교'}>
    <p style={{ padding: 14, background: '#fff4dc', color: '#754b16', borderRadius: 12 }}>{pair ? '기본 두 동작은 화면 점검용 합성 샘플입니다. 복원 샘플은 손 좌표를 조금 변형한 것이며 학습 모델의 복원 결과가 아닙니다.' : '기본 4개 동작은 동기 재생 점검용 합성 샘플입니다. B1·B2·생성 모델의 실제 결과가 아닙니다.'}</p>
    {pair&&<AiViewerImport disabled={recorder.busy||check.running||slots.some(s=>s.loading)} onBusy={setImporting} onPair={(motions,name)=>{versions.current=versions.current.map(v=>v+1);setSlots(motions.map((motion,i)=>({label:i===0?'원본':'복원',name,motion,error:null,loading:false})));setRecordSlot(0);seek(0);}}/>}
    <fieldset disabled={recorder.busy||check.running||importing} style={{border:0,padding:0,margin:0}}><div style={{ background: '#111318', borderRadius: 14, padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      <button style={control} aria-pressed={playing} onClick={() => {setFinalSlot(null);setPlaying(!playing);}}>{playing ? '모두 일시정지' : '모두 재생'}</button>
      <button style={control} onClick={() => seek(0)}>처음으로</button>
      <label>속도 <select style={control} value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.25, .5, 1, 1.5, 2].map(s => <option key={s} value={s}>{s}배</option>)}</select></label>
      <label>시점 <select style={control} value={pitch === -Math.PI / 2 ? 'top' : yaw === Math.PI / 2 && pitch === 0 ? 'side' : yaw === 0 && pitch === 0 ? 'front' : 'custom'} onChange={e => { setYaw(e.target.value === 'side' ? Math.PI / 2 : 0); setPitch(e.target.value === 'top' ? -Math.PI / 2 : 0); }}><option value="front">정면</option><option value="side">측면</option><option value="top">위</option><option value="custom" disabled>자유 시점</option></select></label>
      <label><input type="checkbox" checked={showBody} onChange={e => setShowBody(e.target.checked)} /> 몸</label>
      <label><input type="checkbox" checked={showHands} onChange={e => setShowHands(e.target.checked)} /> 손</label>
      <label><input type="checkbox" checked={showFace} onChange={e => setShowFace(e.target.checked)} /> 얼굴 좌표</label>
    </div>
    <label style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#111318', padding: 16, marginTop: 8, borderRadius: 14 }}>공통 프레임 <input aria-label="공통 프레임" type="range" min={0} max={last} value={Math.min(frame, last)} onChange={e => seek(Number(e.target.value))} style={{ flex: 1 }} /><output>{Math.min(frame, last)} / {last} · {time.toFixed(2)}초</output></label>
    </fieldset>
    <label style={{color:"#526078"}}>녹화할 동작 <select disabled={recorder.busy||check.running||importing} style={control} value={recordSlot} onChange={e=>setRecordSlot(Number(e.target.value))}>{slots.map((s,i)=><option key={i} value={i}>{s.label}</option>)}</select></label>
    <PerformanceCheck check={check} disabled={recorder.busy||importing||slots.some(s=>s.loading)} onStart={()=>check.start(slots.map(s=>s.label),{inputs:slots.map(s=>({name:s.name,demo:!!s.motion.response.demo,fps:s.motion.response.fps,frames:s.motion.response.frames})),yaw,pitch,showBody,showHands,showFace},()=>{seek(0);setSpeed(1);setPlaying(true);})}/>
    <RecordingControls recorder={recorder} disabled={check.running||importing||slots.some(s=>s.loading)} onStop={()=>{setPlaying(false);recorder.stop();}} onStart={()=>{const s=slots[recordSlot],r=s.motion.response;recordEnd.current=r.frames/r.fps*TIMELINE_FPS;void recorder.start(canvases.current[recordSlot],{condition:s.label,inputFile:s.name,source:r.source,demo:!!r.demo,fps:r.fps,frames:r.frames,yaw,pitch,showBody,showHands,showFace},()=>{seek(0);setSpeed(1);},()=>setPlaying(true));}}/>
    <p style={{ color: '#526078', fontSize: 14 }}>모든 칸은 같은 시간·시점·배율로 재생합니다. 각 동작의 FPS를 유지하며 먼저 끝난 동작은 마지막 자세에서 기다립니다. 한 그림을 끌면 모든 시점이 함께 바뀝니다.</p>
    {pair && <p style={{color:'#526078',fontSize:14}}>원본과 복원 JSON은 같은 문장·시작 시점의 파일로 선택해주세요. 현재 화면은 입력 시간대로 재생하며 동작의 시작점을 자동 정렬하지 않습니다.
      {Math.abs(slots[0].motion.response.frames/slots[0].motion.response.fps-slots[1].motion.response.frames/slots[1].motion.response.fps)>1e-6 ? ' 두 파일의 길이가 다릅니다. 짧은 동작은 마지막 자세를 유지합니다.' : ''}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))', gap: 16 }}>
      {slots.map((slot, i) => {
        const r = slot.motion.response, f = finalSlot===i ? r.frames-1 : frameAtTime(time, r.fps, r.frames), ended = finalSlot===i || time >= r.frames / r.fps;
        const caption = r.segments.find(s => f >= s.start && f < s.end)?.gloss;
        return <article key={i} style={{ background: '#111318', borderRadius: 14, padding: 16 }} aria-label={'비교 동작 ' + (i + 1)}>
          <label>비교 이름 <input aria-label={'동작 ' + (i + 1) + ' 이름'} disabled={recorder.busy||check.running||importing} value={slot.label} style={{ ...control, maxWidth: '100%', width: 170 }} onChange={e => { const label = e.target.value; setSlots(old => old.map((s, j) => i === j ? { ...s, label } : s)); }} /></label>
          <p style={{ color: '#adb7ca', marginBottom: 8 }}>{slot.loading ? '읽는 중…' : slot.name} · {r.demo ? '합성 샘플' : '불러온 파일'}</p>
          <label style={{ display: 'block', fontSize: 13 }}>동작 {i + 1} JSON <input aria-label={'동작 ' + (i + 1) + ' JSON'} disabled={recorder.busy||check.running||importing} type="file" accept=".json,application/json" style={{ maxWidth: '100%' }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void load(i, file); }} /></label>
          {slot.error ? <p role="alert" style={{ color: '#ffb3b3' }}>{slot.error} 기존 동작을 유지합니다.</p> : null}
          <MotionCanvas data={slot.motion} frame={f} yaw={yaw} pitch={pitch} showBody={showBody} showHands={showHands} showFace={showFace} height={300} onRenderSample={sample=>check.record(i,sample)} onCanvasReady={c=>{canvases.current[i]=c;}} onViewChange={(y, p) => { if(!recorder.busy&&!check.running){setYaw(y); setPitch(p);} }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10, fontSize: 13 }}><span>{f} / {r.frames - 1}프레임 · {r.fps}fps</span><span>{ended ? '재생 끝 · 마지막 자세 유지' : '재생 구간'}</span></div>
          <p style={{ minHeight: 20, textAlign: 'center', color: '#adb7ca', marginBottom: 0 }}>{caption || '자막 없는 구간'}</p>
        </article>;
      })}
    </div>
    {pair&&<ReconstructionMetrics original={slots[0].motion} reconstructed={slots[1].motion} inputNames={[slots[0].name,slots[1].name]} disabled={recorder.busy||check.running||importing||slots.some(s=>s.loading)} onSeek={seconds=>seek(Math.min(last,Math.round(seconds*TIMELINE_FPS)))}/>}
    <button disabled={recorder.busy||check.running||importing} style={{ ...control, marginTop: 16 }} onClick={() => { versions.current = versions.current.map(v => v + 1); setSlots(initialSlots(mode));setRecordSlot(0); seek(0); }}>합성 샘플로 초기화</button>
  </section>;
}
