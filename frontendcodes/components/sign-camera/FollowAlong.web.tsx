/**
 * 따라 하기 (웹): 친구(AI가 만든 동작)가 시범을 보이는 옆에서 카메라로 따라 하고 점수를 받는다.
 *
 *   준비 → 3 · 2 · 1 → 친구가 다시 한 번 하는 동안 내 움직임을 담는다 → 점수와 고칠 곳
 *
 * 영상은 이 화면에서만 쓰고 저장하거나 보내지 않는다. 채점은 기기 안에서 계산한다(body-score.ts).
 * 통역 화면과 작업실이 같이 쓰도록 친구 동작(reference)만 받는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Avatar3D } from '@/components/paint/avatar-3d';
import type { Motion } from '@/lib/api/generate';

import { toBodyFrame, type BodyCapture } from './body-frame';
import { scoreFollow, verdict, type FollowScore, type ScoreMotion } from './body-score';
import { BodySequence, resampleBody } from './body-sequence';
import BodyTracker from './BodyTracker.web';
import { CameraSession, cameraError } from './camera-session';

const CARD = '#FFFDF6';
const INK = '#2E2620';
const SOFT = '#6B5D4F';
const RED = '#F08A74';
const button = { background: CARD, color: INK, border: `1.5px solid ${INK}`, borderRadius: 10, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const;
const frame = { position: 'relative', flex: '1 1 260px', minWidth: 0, aspectRatio: '4 / 3', background: '#F3EADB', border: `1.5px solid ${INK}`, borderRadius: 14, overflow: 'hidden' } as const;
const COUNTDOWN_S = 3;

type Phase = 'idle' | 'countdown' | 'recording' | 'done';
type Outcome = { kind: 'score'; score: FollowScore } | { kind: 'none' };

/** 친구 동작 길이에 여유를 더한 담는 시간: 사람은 친구보다 조금 늦게 시작하고 조금 느리다 */
function recordMs(reference: Motion) {
  return Math.round(Math.min(12000, Math.max(3500, (reference.frames / (reference.fps || 30)) * 1000 * 1.3 + 1500)));
}

/** 점검용: 친구 동작을 조금 느리게, 조금 흔들어서 "사람이 따라 한 것처럼" 만든다 (카메라 없이 채점 흐름을 보려는 것) */
function shakenCopy(reference: Motion): ScoreMotion {
  const frames = Math.round(reference.frames * 1.25);
  const data = new Float32Array(frames * 165);
  let seed = 7;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return (seed / 4294967296 - 0.5) * 0.04;
  };
  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * (reference.frames - 1);
    const a = Math.floor(t);
    const b = Math.min(reference.frames - 1, a + 1);
    for (let j = 0; j < 165; j++) {
      const v = reference.data[a * 375 + j] + (reference.data[b * 375 + j] - reference.data[a * 375 + j]) * (t - a);
      data[f * 165 + j] = j % 3 === 2 ? v : v + noise();
    }
  }
  return { frames, fps: 30, data, stride: 165 };
}

function Bar({ label, score, note }: { label: string; score: number; note: string }) {
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
        <span>{label}</span>
        <span style={{ color: SOFT }}>{note}</span>
      </div>
      <div style={{ height: 12, background: '#F3EADB', border: `1.5px solid ${INK}`, borderRadius: 8, overflow: 'hidden' }} role="img" aria-label={`${label} ${score}점`}>
        <div style={{ width: `${score}%`, height: '100%', background: score >= 65 ? '#7CC6A4' : score >= 40 ? '#FFC83D' : RED }} />
      </div>
    </div>
  );
}

export default function FollowAlong({ reference, title }: { reference: Motion; title?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<CameraSession | null>(null);
  const sequence = useRef<BodySequence | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [bodySeen, setBodySeen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [clock, setClock] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [friendKey, setFriendKey] = useState(0);
  const [friend3d, setFriend3d] = useState(true);
  const duration = useMemo(() => recordMs(reference), [reference]);
  const friend: ScoreMotion = useMemo(() => ({ frames: reference.frames, fps: reference.fps || 30, data: reference.data, stride: 375 }), [reference]);

  if (!session.current) {
    session.current = new CameraSession(() =>
      navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } })
    );
  }
  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const stopCamera = useCallback(() => {
    stopTimer();
    sequence.current = null;
    session.current?.stop();
    setStream(null);
    setPending(false);
    setBodySeen(false);
    setPhase((p) => (p === 'done' ? p : 'idle'));
  }, []);

  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.hidden) stopCamera();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false;
      stopTimer();
      session.current?.stop();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [stopCamera]);
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
  // 친구 동작이 바뀌면 처음부터
  useEffect(() => {
    stopTimer();
    sequence.current = null;
    setOutcome(null);
    setPhase('idle');
    setFriendKey((k) => k + 1);
  }, [reference]);

  const startCamera = async () => {
    if (pending || stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('카메라는 HTTPS 또는 localhost 에서, 카메라를 지원하는 브라우저로 열어 주세요.');
      return;
    }
    setError('');
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

  const onCapture = useCallback((capture: BodyCapture | null) => {
    const body = capture ? toBodyFrame(capture) : null;
    setBodySeen(!!body);
    if (capture && sequence.current) sequence.current.add(body, capture.timestampMs);
  }, []);

  const finish = (seq: BodySequence) => {
    const mine = resampleBody(seq.frames);
    const score = mine ? scoreFollow({ frames: mine.frames, fps: mine.fps, data: mine.data, stride: 165, leftHand: mine.leftHand, rightHand: mine.rightHand }, friend, reference.segments) : null;
    setOutcome(score ? { kind: 'score', score } : { kind: 'none' });
    setPhase('done');
  };
  const follow = () => {
    if (!stream || phase === 'countdown' || phase === 'recording') return;
    setOutcome(null);
    setPhase('countdown');
    setClock(COUNTDOWN_S);
    const started = performance.now();
    stopTimer();
    timer.current = setInterval(() => {
      const left = COUNTDOWN_S - (performance.now() - started) / 1000;
      setClock(Math.max(0, left));
      if (left > 0) return;
      // 친구가 처음부터 다시 하고, 그동안 담는다
      const seq = new BodySequence(performance.now(), duration);
      sequence.current = seq;
      setFriendKey((k) => k + 1);
      setPhase('recording');
      setClock(0);
      stopTimer();
      timer.current = setInterval(() => {
        const passed = performance.now() - seq.startedMs;
        setClock(Math.min(duration, passed));
        if (passed >= duration) {
          stopTimer();
          sequence.current = null;
          finish(seq);
        }
      }, 100);
    }, 100);
  };
  const selfCheck = () => {
    const score = scoreFollow(shakenCopy(reference), friend, reference.segments);
    setOutcome(score ? { kind: 'score', score } : { kind: 'none' });
    setPhase('done');
  };

  const busy = phase === 'countdown' || phase === 'recording';
  const score = outcome?.kind === 'score' ? outcome.score : null;
  return (
    <section aria-label="따라 하기" style={{ fontFamily: 'GowunDodum_400Regular, system-ui, sans-serif', color: INK }}>
      {title ? <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{title}</div> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <div style={frame}>
          {friend3d ? (
            <Avatar3D key={friendKey} motion={reference} playing loop={phase !== 'recording'} onError={() => setFriend3d(false)} />
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: SOFT, padding: 16, textAlign: 'center' }}>3D 친구를 띄우지 못했어요.</div>
          )}
          <span style={{ position: 'absolute', left: 10, top: 8, background: CARD, border: `1.5px solid ${INK}`, borderRadius: 999, padding: '1px 10px', fontSize: 13 }}>친구</span>
        </div>
        <div style={{ ...frame, background: '#1d1a17' }}>
          <video ref={video} muted playsInline aria-label="내 카메라" style={{ display: stream ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'contain', transform: 'scaleX(-1)' }} />
          <BodyTracker input={video} enabled={!!stream} mirrored onStatus={setStatus} onCapture={onCapture} />
          {!stream && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#F3EADB', padding: 16, textAlign: 'center' }}>
              {pending ? '카메라 권한을 기다리고 있어요…' : '카메라를 켜면 여기에 내 모습이 보여요'}
            </div>
          )}
          {phase === 'countdown' && (
            <div aria-live="assertive" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 96, fontWeight: 700, background: 'rgba(0,0,0,.3)' }}>{Math.ceil(clock)}</div>
          )}
          <span style={{ position: 'absolute', left: 10, top: 8, background: CARD, border: `1.5px solid ${INK}`, borderRadius: 999, padding: '1px 10px', fontSize: 13 }}>나</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 12 }}>
        {!stream ? (
          <button style={button} disabled={pending} onClick={() => void startCamera()}>카메라 켜기</button>
        ) : (
          <button style={button} disabled={busy} onClick={stopCamera}>카메라 끄기</button>
        )}
        <button style={{ ...button, background: RED, fontWeight: 700 }} disabled={!stream || busy} onClick={follow}>
          {phase === 'recording' ? '따라 하는 중…' : outcome ? '다시 따라 하기' : '따라 하기 시작'}
        </button>
        {phase === 'recording' && <progress value={clock} max={duration} aria-label="담는 중" style={{ width: 200 }} />}
        {__DEV__ && (
          <button style={{ ...button, borderStyle: 'dashed', color: SOFT }} disabled={busy} onClick={selfCheck} title="카메라 없이 채점 흐름을 본다. 친구 동작을 조금 느리게 흔든 가짜 입력을 넣는다">
            점검: 가짜 입력으로 채점
          </button>
        )}
      </div>
      <p role="status" style={{ margin: '8px 0 0', color: SOFT, fontSize: 14, minHeight: 21 }}>
        {error ? '' : phase === 'recording' ? '친구를 보면서 같은 쪽 손으로 따라 해 보세요.' : stream ? (bodySeen ? `준비됐어요. 어깨와 손이 화면에 들어와 있어요. ${status ? '(' + status + ')' : ''}` : status || '상체를 찾는 중…') : '친구 동작을 먼저 보고, 카메라를 켠 뒤 따라 해 보세요.'}
      </p>
      {error && <p role="alert" style={{ color: '#9E2E1C', margin: '6px 0 0' }}>{error}</p>}

      {outcome?.kind === 'none' && (
        <p role="status" style={{ marginTop: 12, color: '#9E2E1C' }}>움직임이 잘 잡히지 않아서 점수를 내지 못했어요. 어깨와 손이 화면에 들어오게 서서 다시 해 보세요.</p>
      )}
      {score && (
        <div aria-live="polite" style={{ marginTop: 14, background: CARD, border: `1.5px solid ${INK}`, borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
            <div style={{ width: 96, height: 96, borderRadius: '50%', border: `3px solid ${INK}`, display: 'grid', placeItems: 'center', background: score.score >= 65 ? '#E6F5EC' : score.score >= 40 ? '#FFE08A' : '#FDEAE4', flex: '0 0 auto' }}>
              <span style={{ fontSize: 36, fontWeight: 700 }}>{score.score}</span>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{verdict(score.score)}</div>
              <Bar label="손의 자리" score={score.position.score} note={`거리 ${score.position.distance.toFixed(2)}`} />
              {score.shape ? <Bar label="손가락 모양" score={score.shape.score} note={`거리 ${score.shape.distance.toFixed(2)}`} /> : <div style={{ color: SOFT, fontSize: 13 }}>손가락 모양은 견줄 장면이 없었어요.</div>}
            </div>
          </div>
          {score.words.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {score.words.map((w, i) => (
                <span key={`${w.gloss}-${i}`} style={{ border: `1.5px solid ${INK}`, borderRadius: 999, padding: '2px 12px', background: w.score >= 65 ? '#E6F5EC' : w.score >= 40 ? '#FFE08A' : '#FDEAE4' }}>
                  {w.gloss} <b>{w.score}</b>
                </span>
              ))}
            </div>
          )}
          {score.hints.length > 0 ? (
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
              {score.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: '12px 0 0' }}>고칠 곳이 보이지 않아요.</p>
          )}
          <p style={{ margin: '10px 0 0', color: SOFT, fontSize: 12.5 }}>
            친구 동작과 내 동작의 손 자리 · 손가락 모양을 시간을 맞춰 견준 점수입니다. 장 {score.compared.mine}개와 {score.compared.friend}개를 견줬어요. 기준선은 아직 임시값이고, 수어의 뜻이 맞는지를 판정한 것은 아닙니다.
          </p>
        </div>
      )}
    </section>
  );
}
