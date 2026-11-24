import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { currentMotionToken, decodeMotion } from './motion';
import type { SignPlayerProps } from './SignPlayer';
import RecordingControls from './RecordingControls';
import { useCanvasRecorder } from './useCanvasRecorder';
import PerformanceCheck from './PerformanceCheck';
import { useRenderCheck } from './useRenderCheck';
import MotionCanvas from './MotionCanvas.web';
import { pickFrame } from './frame-pick';
import { control } from './lab-style';

const plainFieldset: CSSProperties = { border: 0, padding: 0, margin: 0 };
const toolbar: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' };

function FrameInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() && Number.isInteger(n) && n >= min && n <= max) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      value={draft}
      style={{ ...control, width: 85 }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export default function SignPlayer({ motion }: SignPlayerProps) {
  const parsed = useMemo(() => {
    try {
      return { value: decodeMotion(motion), error: null };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : '동작을 읽을 수 없습니다.' };
    }
  }, [motion]);
  const check = useRenderCheck();
  const recorder = useCanvasRecorder();
  const { active: recordingActive, stop: stopRecording, cancel: cancelRecording } = recorder;
  const { cancel: cancelCheck } = check;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const cursor = useRef(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [showBody, setShowBody] = useState(true);
  const [showHands, setShowHands] = useState(true);
  const [showFace, setShowFace] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(0);
  const data = parsed.value;
  // 2026-11-23 승혁: 주소에 ?fpsmark=1 을 붙이면 동작 프레임마다 흑백이 바뀌는 네모와 프레임 번호를 띄운다.
  // 화면을 슬로모션(240fps)으로 찍어 tools/fps-from-video.py로 세면 실제 모니터에 보인 갱신 수를 알 수 있다. 평소에는 안 보인다.
  const [fpsMark] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fpsmark'),
  );

  useEffect(() => {
    cancelCheck();
    cancelRecording();
    cursor.current = 0;
    setFrame(0);
    setPlaying(false);
    setLoopStart(0);
    setLoopEnd(data ? Math.max(0, data.response.frames - 1) : 0);
  }, [data, cancelCheck, cancelRecording]);
  useEffect(() => {
    if (!data || !playing) return;
    let id = 0;
    let last: number | undefined;
    const tick = (now: number) => {
      const dt = last === undefined ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;
      const step = dt * data.response.fps * speed;
      cursor.current += step;
      if (recordingActive.current && cursor.current >= data.response.frames) {
        cursor.current = data.response.frames - 1;
        setFrame(data.response.frames - 1);
        setPlaying(false);
        stopRecording(true);
        return;
      }
      const length = loopEnd - loopStart + 1;
      if (cursor.current >= loopEnd + 1) cursor.current = loopStart + ((cursor.current - loopStart) % length);
      // 녹화 중에는 앞당기지 않는다(마지막 장 뒤에 첫 장이 한 번 끼어 녹화되지 않게). 고르는 방식은 frame-pick.ts
      setFrame(pickFrame(cursor.current, recordingActive.current ? 0 : step, loopStart, loopEnd));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [data, playing, speed, loopStart, loopEnd, recordingActive, stopRecording]);

  if (!data) return <p role="alert">{parsed.error}</p>;
  if (data.response.frames === 0) return <p role="status">생성할 수 있는 단어가 없어 재생할 동작이 없습니다.</p>;
  const last = data.response.frames - 1;
  const token = currentMotionToken(data.response, frame);
  const seek = (n: number) => {
    cursor.current = n;
    setFrame(n);
    setPlaying(false);
  };
  const segment = data.response.segments.find((s) => frame >= s.start && frame < s.end);
  const viewValue =
    Math.abs(pitch) > 0.1 ? 'top' : yaw === Math.PI / 2 ? 'side' : yaw === 0 ? 'front' : 'custom';
  return (
    <section
      aria-label="수어 동작 재생기"
      style={{
        background: '#111318',
        color: '#edf0fa',
        borderRadius: 16,
        padding: 20,
        fontFamily: 'system-ui,sans-serif',
      }}
    >
      <fieldset disabled={recorder.busy || check.running} style={plainFieldset}>
        <div style={toolbar}>
          <button
            style={control}
            aria-pressed={playing}
            onClick={() => {
              if (frame < loopStart || frame > loopEnd) {
                cursor.current = loopStart;
                setFrame(loopStart);
              }
              setPlaying(!playing);
            }}
          >
            {playing ? '일시정지' : '재생'}
          </button>
          <button style={control} onClick={() => seek(loopStart)}>처음으로</button>
          <label>
            속도 <select style={control} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[0.25, 0.5, 1, 1.5, 2].map((s) => (
                <option key={s} value={s}>{s}배</option>
              ))}
            </select>
          </label>
          <label>
            시점 <select
              style={control}
              value={viewValue}
              onChange={(e) => {
                const v = e.target.value;
                setYaw(v === 'side' ? Math.PI / 2 : 0);
                setPitch(v === 'top' ? -Math.PI / 2 : 0);
              }}
            >
              <option value="front">정면</option>
              <option value="side">측면</option>
              <option value="top">위</option>
              <option value="custom" disabled>자유 시점</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={showBody} onChange={(e) => setShowBody(e.target.checked)} /> 몸
          </label>
          <label>
            <input type="checkbox" checked={showHands} onChange={(e) => setShowHands(e.target.checked)} /> 손
          </label>
          <label>
            <input type="checkbox" checked={showFace} onChange={(e) => setShowFace(e.target.checked)} /> 얼굴 좌표
          </label>
        </div>
      </fieldset>
      {fpsMark && (
        <div aria-label="표시 FPS 촬영 표지" style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12 }}>
          <div
            style={{
              width: 120,
              height: 120,
              background: frame % 2 ? '#ffffff' : '#000000',
              border: '4px solid #ff3b30',
            }}
          />
          <output style={{ fontSize: 72, fontFamily: 'ui-monospace,monospace', fontVariantNumeric: 'tabular-nums' }}>
            {String(frame).padStart(3, '0')}
          </output>
        </div>
      )}
      <MotionCanvas
        data={data}
        frame={frame}
        yaw={yaw}
        pitch={pitch}
        showBody={showBody}
        showHands={showHands}
        showFace={showFace}
        onRenderSample={(sample) => check.record(0, sample)}
        onCanvasReady={(c) => {
          canvas.current = c;
        }}
        onViewChange={(y, p) => {
          if (!recorder.busy && !check.running) {
            setYaw(y);
            setPitch(p);
          }
        }}
      />
      <fieldset disabled={recorder.busy || check.running} style={plainFieldset}>
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
          프레임 <input
            aria-label="프레임"
            type="range"
            min={0}
            max={last}
            value={Math.min(frame, last)}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <output>{Math.min(frame, last)} / {last}</output>
        </label>
        <p aria-label="현재 토큰" style={{ color: '#adb7ca', fontSize: 14 }}>
          현재 토큰: {token === undefined ? '정보 없음' : `#${token}`} · 4프레임 단위 참고 표시
        </p>
        {!data.response.demo && data.response.tokens.length > 0 && (
          <p style={{ color: '#adb7ca', fontSize: 13 }}>
            단어 연결 시 프레임이 조정될 수 있어 토큰 번호는 실제 동작과 정확히 대응하지 않을 수 있습니다.
          </p>
        )}
        <div style={{ ...toolbar, marginTop: 16 }}>
          <label>
            반복 시작 <FrameInput
              label="반복 시작"
              min={0}
              max={loopEnd}
              value={loopStart}
              onCommit={(n) => {
                setLoopStart(n);
                seek(n);
              }}
            />
          </label>
          <label>
            반복 끝 <FrameInput
              label="반복 끝"
              min={loopStart}
              max={last}
              value={loopEnd}
              onCommit={(n) => {
                setLoopEnd(n);
                seek(loopStart);
              }}
            />
          </label>
          <button
            style={control}
            onClick={() => {
              setLoopStart(0);
              setLoopEnd(last);
              seek(0);
            }}
          >
            전체 구간
          </button>
        </div>
      </fieldset>
      <PerformanceCheck
        check={check}
        disabled={recorder.busy}
        onStart={() =>
          check.start(
            ['단일 동작'],
            {
              demo: !!data.response.demo,
              source: data.response.source,
              fps: data.response.fps,
              frames: data.response.frames,
              yaw,
              pitch,
              showBody,
              showHands,
              showFace,
            },
            () => {
              seek(0);
              setSpeed(1);
              setLoopStart(0);
              setLoopEnd(last);
              setPlaying(true);
            },
          )
        }
      />
      <RecordingControls
        disabled={check.running}
        recorder={recorder}
        onStop={() => {
          setPlaying(false);
          recorder.stop();
        }}
        onStart={() =>
          void recorder.start(
            canvas.current,
            {
              source: data.response.source,
              demo: !!data.response.demo,
              fps: data.response.fps,
              frames: data.response.frames,
              yaw,
              pitch,
              showBody,
              showHands,
              showFace,
            },
            () => {
              seek(0);
              setSpeed(1);
              setLoopStart(0);
              setLoopEnd(last);
            },
            () => setPlaying(true),
          )
        }
      />
      <p aria-label="현재 자막" style={{ minHeight: 24, textAlign: 'center', fontSize: 20 }}>
        {segment?.gloss ?? '자막 없는 구간'}
      </p>
      <p style={{ color: '#adb7ca', fontSize: 13 }}>그림을 끌어서 돌려보세요. 왼손은 민트색, 오른손은 주황색입니다.</p>
    </section>
  );
}
