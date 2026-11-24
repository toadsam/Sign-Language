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
import { requestReading, type ReadCandidate } from '@/lib/api/recognize';

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
/** 읽는 모델이 읽은 결과. 낱말 구간마다 친구 동작과 내 동작을 따로 읽는다 */
type ReadRow = { gloss: string | null; friend: ReadCandidate[]; mine: ReadCandidate[] };
type ReadState = { kind: 'loading' } | { kind: 'rows'; rows: ReadRow[]; classes: number } | { kind: 'error'; message: string };
/**
 * 기준선 맞추기용 기록 (개발 때만 보인다). 카메라로 실제로 따라 한 시도의 점수와 거리를 쌓아 두고 복사한다.
 * 점수 기준선(body-score.ts 의 POSITION_RANGE · SHAPE_RANGE)을 실제 시도 숫자로 다시 정하려는 것이다.
 */
type Attempt = { kind: string; score: number; position: number; shape: number | null; mirrored: boolean; words: string };
// '손 모양만 다름': 손 자리는 친구와 똑같이, 손 모양만 일부러 다르게(주먹 · 다른 손가락). 웹캠이 손 모양을 가르는지 보려는 것 (2026-11-17 재훈 요청)
const ATTEMPT_KINDS = ['잘 따라 함', '대충 따라 함', '손 모양만 다름', '다른 동작'];
const ATTEMPT_KEY = 'signlingo-follow-attempts';
function loadAttempts(): Attempt[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}
function saveAttempts(list: Attempt[]) {
  try {
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify(list));
  } catch {
    // 저장이 막혀 있으면 화면에만 남는다
  }
}
const attemptLine = (a: Attempt, i: number) =>
  `${i + 1}\t${a.kind}\t점수 ${a.score}\t자리 ${a.position.toFixed(3)}\t모양 ${a.shape === null ? '없음' : a.shape.toFixed(3)}${a.mirrored ? '\t반대 손' : ''}${a.words ? `\t${a.words}` : ''}`;
/**
 * 카메라에 너무 가까운가. 목에서 어깨너비만큼 아래(가슴 아래쪽)가 화면 밖이면 손이 화면 아래로 나가 잡히지 않는다.
 * 실제로 얼굴만 크게 잡힌 채 따라 해서 "손 0개"로 점수가 낮게 나온 일이 있었다 (2026-11-15)
 */
function tooClose(capture: BodyCapture): boolean {
  const l = capture.pose?.[11];
  const r = capture.pose?.[12];
  if (!l || !r || !(capture.width > 0) || !(capture.height > 0)) return false;
  const shoulder = Math.hypot((l.x - r.x) * capture.width, (l.y - r.y) * capture.height);
  const chestY = ((l.y + r.y) / 2) * capture.height + shoulder;
  return chestY > capture.height * 1.05;
}
const readName = (c: ReadCandidate) => c.name ?? c.item;
const percent = (p: number) => `${Math.round(p * 100)}%`;

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

/** 읽는 모델이 읽은 결과 한 칸: 1등 단어와 확률, 그 아래 2 · 3등 */
function ReadCell({ top, gloss }: { top: ReadCandidate[]; gloss: string | null }) {
  if (top.length === 0) return <span style={{ color: SOFT }}>읽지 못함</span>;
  const hit = gloss !== null && top[0].name === gloss;
  return (
    <>
      <b>{readName(top[0])}</b> {percent(top[0].prob)}
      {hit ? ' ✓' : ''}
      <div style={{ color: SOFT, fontSize: 12 }}>{top.slice(1, 3).map((c) => `${readName(c)} ${percent(c.prob)}`).join(' · ')}</div>
    </>
  );
}

/** devGen 은 개발용 주소 바꾸기(?gen=…). 읽는 모델 주소도 여기서 따라 나온다 */
export default function FollowAlong({ reference, title, devGen }: { reference: Motion; title?: string; devGen?: string }) {
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
  const [close, setClose] = useState(false);
  const closeRun = useRef(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [clock, setClock] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [friendKey, setFriendKey] = useState(0);
  const [friend3d, setFriend3d] = useState(true);
  const [read, setRead] = useState<ReadState | null>(null);
  const readRun = useRef(0);
  // 좁은 화면에서는 점수가 상자 아래 화면 밖에 나오므로, 결과가 나오면 그 자리로 내려 보낸다
  const result = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);
  useEffect(() => {
    if (outcome) result.current?.scrollIntoView({ block: 'start' });
  }, [outcome]);
  // 개발용 칸(가짜 입력 점검, 기준선 맞추기 기록, 거리 숫자)은 개발 서버에서 주소에 calib 를 붙였을 때만 보인다.
  // 개발 서버로 시연할 때 사용자 화면에 섞이지 않게 하려는 것이다 (예: /translator?calib=1)
  const tools = useMemo(() => __DEV__ && new URLSearchParams(window.location.search).has('calib'), []);
  const [attempts, setAttempts] = useState<Attempt[]>(() => (__DEV__ ? loadAttempts() : []));
  const [attemptKind, setAttemptKind] = useState(ATTEMPT_KINDS[0]);
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
    setClose(false);
    closeRun.current = 0;
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
    setRead(null);
    readRun.current++;
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
    // 몇 장 이어서 같은 판정이 나와야 안내를 바꾼다 (경계에서 깜빡이지 않게)
    const near = !!capture && !!body && tooClose(capture);
    closeRun.current = near ? Math.max(1, closeRun.current + 1) : Math.min(-1, closeRun.current - 1);
    if (closeRun.current >= 5) setClose(true);
    else if (closeRun.current <= -5) setClose(false);
    if (capture && sequence.current) sequence.current.add(body, capture.timestampMs);
  }, []);

  /** 읽는 모델에게 물어본다: 낱말 구간마다 친구 동작과 내 동작이 어떤 단어로 읽히는지. 주소를 정해 두지 않았으면 아무것도 하지 않는다 */
  const askReading = async (mine: ScoreMotion, score: FollowScore) => {
    const run = ++readRun.current;
    const parts: { gloss: string | null; friend: [number, number]; mine: [number, number] }[] =
      score.aligned.length > 0 ? score.aligned : [{ gloss: null, friend: score.active.friend, mine: score.active.mine }];
    setRead({ kind: 'loading' });
    // 추론 서버는 한 번에 한 요청만 받으므로 차례로 묻는다
    const friendRead = await requestReading({ frames: reference.frames, joints: 125, data: reference.data }, parts.map((p) => p.friend), { devGenEndpoint: devGen });
    if (run !== readRun.current) return;
    if (friendRead.kind === 'off') return setRead(null);
    if (friendRead.kind === 'error') return setRead({ kind: 'error', message: friendRead.message });
    const mineRead = await requestReading({ frames: mine.frames, joints: 55, data: mine.data }, parts.map((p) => p.mine), { devGenEndpoint: devGen });
    if (run !== readRun.current) return;
    if (mineRead.kind !== 'ok') return setRead({ kind: 'error', message: mineRead.kind === 'error' ? mineRead.message : '읽는 모델에 물어보지 못했어요.' });
    setRead({ kind: 'rows', classes: friendRead.classes, rows: parts.map((p, i) => ({ gloss: p.gloss, friend: friendRead.results[i]?.top ?? [], mine: mineRead.results[i]?.top ?? [] })) });
  };
  /** record 는 카메라로 실제로 따라 한 시도일 때만 true (가짜 입력 점검은 기록하지 않는다) */
  const judge = (mine: ScoreMotion | null, record = false) => {
    const score = mine ? scoreFollow(mine, friend, reference.segments) : null;
    setOutcome(score ? { kind: 'score', score } : { kind: 'none' });
    setPhase('done');
    shownAt.current = performance.now();
    if (tools && record && score) {
      const attempt: Attempt = { kind: attemptKind, score: score.score, position: score.position.distance, shape: score.shape ? score.shape.distance : null, mirrored: score.mirrored, words: score.words.map((w) => `${w.gloss} ${w.score}`).join(', ') };
      setAttempts((list) => {
        const next = [...list, attempt];
        saveAttempts(next);
        return next;
      });
    }
    if (mine && score) void askReading(mine, score);
    else setRead(null);
  };
  const finish = (seq: BodySequence) => {
    const mine = resampleBody(seq.frames);
    judge(mine ? { frames: mine.frames, fps: mine.fps, data: mine.data, stride: 165, leftHand: mine.leftHand, rightHand: mine.rightHand } : null, true);
  };
  const follow = () => {
    if (!stream || phase === 'countdown' || phase === 'recording') return;
    // 결과가 막 나온 직후의 누름은 받지 않는다. 화면이 버벅일 때 밀려 있던 누름이 뒤늦게 들어와 점수를 지우고 다시 시작하는 일을 막는다
    if (performance.now() - shownAt.current < 1200) return;
    setOutcome(null);
    setRead(null);
    readRun.current++;
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
  const selfCheck = () => judge(shakenCopy(reference));

  const busy = phase === 'countdown' || phase === 'recording';
  const score = outcome?.kind === 'score' ? outcome.score : null;
  return (
    // position: relative 가 꼭 있어야 한다. 통역 화면은 이 패널을 RoughBox(바탕을 absolute SVG 로 칠한다) 안에 넣는데,
    // 이 줄이 없으면 그 바탕이 제목 · 버튼 · 점수 카드를 덮어서 "점수가 나왔다가 사라지는" 것처럼 보였다 (2026-11-15)
    <section aria-label="따라 하기" style={{ position: 'relative', fontFamily: 'GowunDodum_400Regular, system-ui, sans-serif', color: INK }}>
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
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 14, color: '#F3EADB', padding: 16, textAlign: 'center' }}>
              <div>{pending ? '카메라 권한을 기다리고 있어요…' : '카메라를 켜면 여기에 내 모습이 보여요'}</div>
              {/* 좁은 화면에서는 상자 아래 버튼이 화면 밖으로 밀려서, 켜는 버튼을 상자 안에 둔다 */}
              <button style={{ ...button, fontWeight: 700, fontSize: 16, padding: '10px 20px' }} disabled={pending} onClick={() => void startCamera()}>
                카메라 켜기
              </button>
            </div>
          )}
          {stream && close && (
            <div role="status" style={{ position: 'absolute', left: '50%', top: 10, transform: 'translateX(-50%)', zIndex: 2, background: '#FFC83D', color: INK, border: `1.5px solid ${INK}`, borderRadius: 999, padding: '4px 14px', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
              조금 더 뒤로! 가슴과 손까지 보이게
            </div>
          )}
          {stream && !busy && (
            <button style={{ ...button, position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)', zIndex: 2, background: RED, fontWeight: 700, fontSize: 16, padding: '10px 20px', whiteSpace: 'nowrap' }} onClick={follow}>
              {outcome ? '다시 따라 하기' : '따라 하기 시작'}
            </button>
          )}
          {phase === 'countdown' && (
            <div aria-live="assertive" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 96, fontWeight: 700, background: 'rgba(0,0,0,.3)' }}>{Math.ceil(clock)}</div>
          )}
          <span style={{ position: 'absolute', left: 10, top: 8, background: CARD, border: `1.5px solid ${INK}`, borderRadius: 999, padding: '1px 10px', fontSize: 13 }}>나</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 12 }}>
        {stream && <button style={button} disabled={busy} onClick={stopCamera}>카메라 끄기</button>}
        {phase === 'recording' && (
          <>
            <b>따라 하는 중…</b>
            <progress value={clock} max={duration} aria-label="담는 중" style={{ width: 200 }} />
          </>
        )}
        {tools && (
          <button style={{ ...button, borderStyle: 'dashed', color: SOFT }} disabled={busy} onClick={selfCheck} title="카메라 없이 채점 흐름을 본다. 친구 동작을 조금 느리게 흔든 가짜 입력을 넣는다">
            점검: 가짜 입력으로 채점
          </button>
        )}
      </div>
      <p role="status" style={{ margin: '8px 0 0', color: SOFT, fontSize: 14, minHeight: 21 }}>
        {error ? '' : phase === 'recording' ? '친구를 보면서 같은 쪽 손으로 따라 해 보세요.' : stream ? (bodySeen ? `준비됐어요. 어깨와 손이 화면에 들어와 있어요. ${status ? '(' + status + ')' : ''}` : status || '상체를 찾는 중…') : '친구 동작을 먼저 보고, 카메라를 켠 뒤 따라 해 보세요.'}
      </p>
      {error && <p role="alert" style={{ color: '#9E2E1C', margin: '6px 0 0' }}>{error}</p>}

      <div ref={result} style={{ scrollMarginTop: 12 }} />
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
              <Bar label="손의 자리" score={score.position.score} note={tools ? `거리 ${score.position.distance.toFixed(2)}` : ''} />
              {score.shape ? <Bar label="손가락 모양" score={score.shape.score} note={tools ? `거리 ${score.shape.distance.toFixed(2)}` : ''} /> : <div style={{ color: SOFT, fontSize: 13 }}>손가락 모양은 견줄 장면이 없었어요.</div>}
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
          {read && (
            <details style={{ marginTop: 14, borderTop: `1.5px dashed ${INK}`, paddingTop: 12 }}>
              <summary style={{ fontWeight: 700, cursor: 'pointer' }}>읽는 모델이 읽은 단어 (실험)</summary>
              {read.kind === 'loading' && <p role="status" style={{ margin: '6px 0 0', color: SOFT }}>읽는 모델에게 물어보는 중…</p>}
              {read.kind === 'error' && <p role="status" style={{ margin: '6px 0 0', color: SOFT }}>읽는 모델에 물어보지 못했어요. {read.message}</p>}
              {read.kind === 'rows' && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 6, fontSize: 14 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: SOFT, fontSize: 12.5 }}>
                          <th style={{ padding: '4px 10px 4px 0', fontWeight: 400 }}>낱말</th>
                          <th style={{ padding: '4px 10px 4px 0', fontWeight: 400 }}>친구 동작은 이렇게 읽힘</th>
                          <th style={{ padding: '4px 0', fontWeight: 400 }}>내 동작은 이렇게 읽힘</th>
                        </tr>
                      </thead>
                      <tbody>
                        {read.rows.map((row, i) => (
                          <tr key={i} style={{ borderTop: '1px solid rgba(46,38,32,.18)', verticalAlign: 'top' }}>
                            <td style={{ padding: '6px 10px 6px 0', whiteSpace: 'nowrap' }}>{row.gloss ?? '동작 전체'}</td>
                            <td style={{ padding: '6px 10px 6px 0' }}><ReadCell top={row.friend} gloss={row.gloss} /></td>
                            <td style={{ padding: '6px 0' }}><ReadCell top={row.mine} gloss={row.gloss} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ margin: '8px 0 0', color: SOFT, fontSize: 12.5 }}>
                    읽는 모델은 스튜디오에서 찍은 단어 {read.classes.toLocaleString()}개로 배웠습니다. 문장 속 낱말이나 웹캠으로 받은 좌표는 잘 못 읽을 수 있어서, 위 점수에는 넣지 않고 읽힌 결과만 보여 줍니다. ✓ 는 1등으로 읽힌 단어가 그 낱말과 같다는 뜻입니다.
                  </p>
                </>
              )}
            </details>
          )}
          <p style={{ margin: '10px 0 0', color: SOFT, fontSize: 12.5 }}>
            친구 동작과 내 동작의 손 자리 · 손가락 모양을 시간을 맞춰 견준 점수예요. 수어의 뜻이 맞는지를 판정한 것은 아니에요.{tools ? ` (장 ${score.compared.mine}개와 ${score.compared.friend}개를 견줌)` : ''}
          </p>
        </div>
      )}
      {tools && (
        <div style={{ marginTop: 14, borderTop: `1.5px dashed ${INK}`, paddingTop: 10, fontSize: 13.5 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <b>기준선 맞추기 기록 (개발용)</b>
            <label htmlFor="attempt-kind">이번에는</label>
            <select id="attempt-kind" value={attemptKind} onChange={(e) => setAttemptKind(e.target.value)} style={{ font: 'inherit', padding: '4px 6px', border: `1.5px solid ${INK}`, borderRadius: 8, background: CARD }}>
              {ATTEMPT_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <button style={{ ...button, padding: '4px 10px' }} disabled={attempts.length === 0} onClick={() => void navigator.clipboard?.writeText(attempts.map(attemptLine).join('\n'))}>
              복사
            </button>
            <button
              style={{ ...button, padding: '4px 10px', color: SOFT }}
              disabled={attempts.length === 0}
              onClick={() => {
                setAttempts([]);
                saveAttempts([]);
              }}
            >
              지우기
            </button>
          </div>
          <p style={{ margin: '6px 0', color: SOFT }}>따라 하기 전에 어떻게 할지 고르고, 카메라로 따라 하면 한 줄씩 쌓입니다. 가짜 입력 점검은 쌓이지 않아요. ({attempts.length}번)</p>
          {attempts.length > 0 && <textarea readOnly aria-label="따라 한 기록" value={attempts.map(attemptLine).join('\n')} rows={Math.min(12, attempts.length + 1)} style={{ width: '100%', boxSizing: 'border-box', font: '12.5px ui-monospace, monospace', border: `1.5px solid ${INK}`, borderRadius: 8, background: CARD, padding: 8 }} />}
        </div>
      )}
    </section>
  );
}
