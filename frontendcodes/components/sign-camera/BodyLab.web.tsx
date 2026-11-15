/**
 * 내 움직임을 AI 동작과 같은 좌표로 받기 (웹).
 * 카메라나 영상에서 상체 + 양손을 뽑아 55점 좌표로 바꾸고, 5초를 담아 3D 친구에게 입혀 본다.
 * 수어 뜻을 판별하거나 채점하지는 않는다. 채점은 다음 단계에서 이 좌표를 쓴다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Avatar3D } from '@/components/paint/avatar-3d';
import type { Motion } from '@/lib/api/generate';

import { publicAssetPath } from '../public-asset';
import { bodyEdges, toBodyFrame, type BodyCapture, type BodyFrame } from './body-frame';
import { BodySequence, bodySequenceJson, bodyToMotion, resampleBody, summarizeBody } from './body-sequence';
import BodyTracker from './BodyTracker.web';
import { CameraSession, cameraError } from './camera-session';

const PAPER = '#FBF5E6';
const CARD = '#FFFDF6';
const INK = '#2E2620';
const SOFT = '#6B5D4F';
const button = { background: CARD, color: INK, border: `1.5px solid ${INK}`, borderRadius: 10, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const;
const EDGES = bodyEdges();
const RECORD_MS = 5000;
const COUNTDOWN_S = 3;

type Phase = 'idle' | 'countdown' | 'recording' | 'done';
type Result = { summary: ReturnType<typeof summarizeBody>; motion: Motion | null; json: string };

/** 55점 좌표를 그대로 그린다: 목이 가운데, 어깨너비가 일정한 크기 */
function drawBody(canvas: HTMLCanvasElement | null, frame: BodyFrame | null) {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  if (!frame) return;
  const unit = width / 3.2;
  const at = (j: number) => ({ x: width / 2 + frame.points[j * 3] * unit, y: height * 0.36 + frame.points[j * 3 + 1] * unit });
  context.lineCap = 'round';
  for (const [a, b] of EDGES) {
    const hand = a >= 13;
    if (hand && !(a < 34 ? frame.mask.leftHand : frame.mask.rightHand)) continue;
    context.strokeStyle = !hand ? INK : a < 34 ? '#3E7CB1' : '#DD4B35';
    context.lineWidth = hand ? 2 : 4;
    const p = at(a);
    const q = at(b);
    context.beginPath();
    context.moveTo(p.x, p.y);
    context.lineTo(q.x, q.y);
    context.stroke();
  }
}

export default function BodyLab() {
  const video = useRef<HTMLVideoElement>(null);
  const sample = useRef<HTMLVideoElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const session = useRef<CameraSession | null>(null);
  const sequence = useRef<BodySequence | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [testVideo, setTestVideo] = useState(false);
  const [mirrored, setMirrored] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('꺼져 있어요');
  const [live, setLive] = useState<BodyFrame | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [clock, setClock] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const [replay3d, setReplay3d] = useState(true);

  if (!session.current) {
    session.current = new CameraSession(() =>
      navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } })
    );
  }
  const recorded = testVideo || !!file;
  const active = !!stream || recorded;

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const stopAll = useCallback(() => {
    stopTimer();
    sequence.current = null;
    session.current?.stop();
    sample.current?.pause();
    setStream(null);
    setPending(false);
    setFile(null);
    setTestVideo(false);
    setLive(null);
    setPhase('idle');
    setStatus('꺼져 있어요');
    setError('');
  }, []);

  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.hidden) stopAll();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false;
      stopTimer();
      session.current?.stop();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [stopAll]);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) void element.play().catch(() => setError('미리보기를 시작하지 못했어요. 카메라를 껐다가 다시 켜 주세요.'));
    return () => {
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);
  useEffect(() => drawBody(preview.current, live), [live]);

  const startCamera = async () => {
    if (pending || stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('카메라는 HTTPS 또는 localhost 에서, 카메라를 지원하는 브라우저로 열어 주세요.');
      return;
    }
    stopAll();
    setResult(null);
    setPending(true);
    try {
      const next = await session.current!.start();
      if (mounted.current && next) setStream(next);
    } catch (e) {
      if (mounted.current) setError(cameraError(e));
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  const loadFile = (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > 200 * 1024 * 1024) return setError('200MB 이하 영상을 골라 주세요.');
    if (!picked.type.startsWith('video/') && !/\.(mp4|webm|mov)$/i.test(picked.name)) return setError('MP4, WebM, MOV 영상을 골라 주세요.');
    stopAll();
    setResult(null);
    setFile({ url: URL.createObjectURL(picked), name: picked.name });
  };

  const onCapture = useCallback((capture: BodyCapture | null) => {
    const frame = capture ? toBodyFrame(capture) : null;
    setLive(frame);
    if (capture && sequence.current) sequence.current.add(frame, capture.timestampMs);
  }, []);

  const finish = (seq: BodySequence, source: string) => {
    const body = resampleBody(seq.frames);
    setResult({ summary: summarizeBody(seq), motion: body ? bodyToMotion(body) : null, json: JSON.stringify(bodySequenceJson(seq, source)) });
    setReplayKey((k) => k + 1);
    setPhase('done');
  };
  const record = () => {
    if (phase === 'countdown' || phase === 'recording' || !active) return;
    setResult(null);
    const source = file ? 'local-video' : testVideo ? 'test-video' : 'camera';
    // 영상 파일은 처음부터 바로 담고, 카메라는 자리를 잡을 시간을 준다
    const begin = () => {
      const seq = new BodySequence(performance.now(), RECORD_MS);
      sequence.current = seq;
      setPhase('recording');
      setClock(0);
      if (recorded && sample.current) {
        sample.current.currentTime = 0;
        void sample.current.play().catch(() => undefined);
      }
      stopTimer();
      timer.current = setInterval(() => {
        const passed = performance.now() - seq.startedMs;
        setClock(Math.min(RECORD_MS, passed));
        if (passed >= RECORD_MS) {
          stopTimer();
          sequence.current = null;
          finish(seq, source);
        }
      }, 100);
    };
    if (recorded) return begin();
    setPhase('countdown');
    const started = performance.now();
    setClock(COUNTDOWN_S);
    stopTimer();
    timer.current = setInterval(() => {
      const left = COUNTDOWN_S - (performance.now() - started) / 1000;
      setClock(Math.max(0, left));
      if (left <= 0) begin();
    }, 100);
  };
  const saveJson = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `body-sequence-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const percent = (v: number) => `${Math.round(v * 100)}%`;
  const shown = stream ? mirrored : false;
  return (
    <section aria-label="내 움직임을 좌표로 받기" style={{ fontFamily: 'system-ui, sans-serif', color: INK, background: PAPER, padding: 20, borderRadius: 16, border: `1.5px solid ${INK}` }}>
      <p style={{ marginTop: 0, color: SOFT, lineHeight: 1.6 }}>
        카메라 앞에서 움직이면 상체와 양손을 찾아, AI가 만든 동작과 <b>같은 모양의 좌표</b>로 바꿉니다. 영상은 이 화면에서만 쓰고 저장하거나 보내지 않습니다. 수어 뜻을 맞히거나 점수를 매기지는 않습니다.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button style={button} disabled={pending || !!stream || phase === 'recording'} onClick={() => void startCamera()}>카메라 켜기</button>
        <button style={button} disabled={!active && !pending} onClick={stopAll}>끄기</button>
        <label style={{ ...button, display: 'inline-block' }}>
          내 영상 불러오기{' '}
          <input aria-label="내 영상" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" style={{ maxWidth: 190 }} disabled={phase === 'recording'} onChange={(e) => { const picked = e.target.files?.[0]; e.target.value = ''; loadFile(picked); }} />
        </label>
        <button style={button} disabled={pending || phase === 'recording'} onClick={() => { stopAll(); setResult(null); setTestVideo(true); }}>손만 나오는 점검 영상</button>
        <label><input type="checkbox" checked={mirrored} onChange={(e) => setMirrored(e.target.checked)} /> 거울처럼 보기</label>
      </div>
      <p role="status" style={{ margin: '10px 0 6px' }}>
        {pending ? '카메라 권한을 기다리고 있어요…' : stream ? '카메라 연결됨' : file ? `영상: ${file.name}` : testVideo ? '점검 영상은 손만 나옵니다. 상체가 없어서 좌표는 만들어지지 않고, 인식기가 켜지는지만 봅니다.' : '카메라를 켜거나 영상을 골라 주세요.'}
        {active ? ` · ${status}` : ''}
      </p>
      {error && <p role="alert" style={{ color: '#9E2E1C', margin: '0 0 8px' }}>{error}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ position: 'relative', flex: '2 1 360px', minWidth: 0, background: '#1d1a17', borderRadius: 12, overflow: 'hidden', minHeight: 200 }}>
          {recorded ? (
            <video key={file?.url ?? 'test'} ref={sample} src={file?.url ?? publicAssetPath('hand-landmarker/test-hands.mp4')} controls={phase !== 'recording'} muted playsInline loop={phase !== 'recording'} autoPlay aria-label="불러온 영상" style={{ display: 'block', width: '100%', maxHeight: 440 }} onError={() => setError('영상을 재생할 수 없어요. MP4 또는 WebM 파일을 골라 주세요.')} />
          ) : (
            <video ref={video} muted playsInline aria-label="카메라 미리보기" style={{ display: stream ? 'block' : 'none', width: '100%', maxHeight: 440, transform: shown ? 'scaleX(-1)' : 'none' }} />
          )}
          <BodyTracker input={recorded ? sample : video} enabled={active} mirrored={shown} onStatus={setStatus} onCapture={onCapture} />
          {phase === 'countdown' && (
            <div aria-live="assertive" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 96, fontWeight: 700, background: 'rgba(0,0,0,.25)' }}>{Math.ceil(clock)}</div>
          )}
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <b>바뀐 좌표</b>
          <div style={{ color: SOFT, fontSize: 13, margin: '2px 0 6px' }}>목이 가운데, 어깨너비가 1. 멀리 서도 기울여도 같은 크기로 나옵니다.</div>
          <canvas ref={preview} width={260} height={300} aria-label="바뀐 좌표로 그린 내 뼈대" style={{ width: '100%', maxWidth: 260, background: CARD, border: `1.5px solid ${INK}`, borderRadius: 12 }} />
          <div style={{ fontSize: 13, color: SOFT, marginTop: 6 }}>
            {live ? `왼손 ${live.mask.leftHand ? '보임' : '안 보임'} · 오른손 ${live.mask.rightHand ? '보임' : '안 보임'}${live.flipped ? ' · 뒤집힌 영상이라 되돌림' : ''}` : active ? '상체를 찾는 중' : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 14 }}>
        <button style={{ ...button, background: '#F08A74', fontWeight: 700 }} disabled={!active || phase === 'countdown' || phase === 'recording'} onClick={record}>
          {phase === 'recording' ? '담는 중…' : '5초 담기'}
        </button>
        {phase === 'recording' && <progress value={clock} max={RECORD_MS} aria-label="담는 중" style={{ width: 220 }} />}
        {phase === 'recording' && <span>{(clock / 1000).toFixed(1)} / 5.0초</span>}
      </div>

      {result && (
        <div style={{ marginTop: 16, borderTop: `1.5px solid ${INK}`, paddingTop: 12 }}>
          <b>담은 결과</b>
          <ul style={{ margin: '6px 0', paddingLeft: 18, lineHeight: 1.7 }}>
            <li>좌표 {result.summary.frames}장 · 초당 {result.summary.observedHz.toFixed(1)}번 · 상체를 놓친 장 {result.summary.missedBody}</li>
            <li>왼손을 본 비율 {percent(result.summary.leftHandSeen)} · 오른손 {percent(result.summary.rightHandSeen)}</li>
            <li>어깨너비 평균 {Math.round(result.summary.meanShoulderPx)}픽셀{result.summary.meanShoulderPx > 0 && result.summary.meanShoulderPx < 80 ? ' (조금 더 가까이 서면 손이 잘 잡혀요)' : ''}</li>
          </ul>
          {result.motion ? (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '8px 0' }}>
                <button style={button} onClick={() => setReplayKey((k) => k + 1)}>다시 보기</button>
                <button style={button} onClick={saveJson}>좌표 JSON 저장</button>
                <span style={{ color: SOFT, fontSize: 13 }}>30fps {result.motion.frames}장으로 고르게 다시 뽑아 3D 친구에게 입혔어요.</span>
              </div>
              {replay3d ? (
                <div style={{ width: '100%', maxWidth: 420, aspectRatio: '4 / 3', background: '#F3EADB', border: `1.5px solid ${INK}`, borderRadius: 14, overflow: 'hidden' }}>
                  <Avatar3D key={replayKey} motion={result.motion} playing loop onError={() => setReplay3d(false)} />
                </div>
              ) : (
                <p style={{ color: SOFT }}>3D 친구를 띄우지 못했어요. 좌표는 위의 JSON 저장으로 확인할 수 있어요.</p>
              )}
            </>
          ) : (
            <p role="status" style={{ color: '#9E2E1C' }}>상체가 잡힌 장이 두 장보다 적어서 동작을 만들지 못했어요. 어깨가 화면에 들어오게 서서 다시 담아 주세요.</p>
          )}
        </div>
      )}
    </section>
  );
}
