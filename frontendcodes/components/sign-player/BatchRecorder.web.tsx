/**
 * 평가 영상 일괄 녹화 (웹).
 * export_motion_json.py가 만든 `<조건>/sentence-NN.json` 폴더를 고르면, 같은 크기 · 시점 · 표시 설정으로 하나씩 재생하며 녹화하고
 * prepare_videos.py가 바로 읽는 `<조건>/sentence-NN.webm` 구조의 ZIP 하나로 내려 준다. 조건 이름은 영상에 찍지 않는다.
 * 좌표 파일은 브라우저 안에서만 읽고 어디로도 보내지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import MotionCanvas from './MotionCanvas.web';
import { frameAtTime } from './timeline';
import { outputName, planJobs, type BatchJob, type BatchPlan } from './batch-jobs';
import { makeZip } from './zip-store';

const CREDIT = '한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용';
const HOLD_SECONDS = 0.5; // 앞뒤 정지 화면
// 모든 영상이 같은 크기가 되도록 고정
const WIDTH = 640;
const HEIGHT = 480;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const control: CSSProperties = {
  background: '#232935',
  color: '#edf0fa',
  border: '1px solid #495266',
  borderRadius: 8,
  padding: '8px 12px',
  font: 'inherit',
};
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
/**
 * 녹화된 영상의 실제 길이(초). 창이 가려지면 캔버스가 화면에 안 그려져 녹화가 한두 장면만 담기므로,
 * 끝날 때마다 잰다
 */
async function videoSeconds(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('녹화한 영상을 읽지 못했습니다.'));
    });
    // MediaRecorder webm은 길이 정보가 비어 있는 경우가 많아, 끝으로 넘겨 길이를 알아낸다
    if (!Number.isFinite(video.duration)) {
      video.currentTime = 1e9;
      await new Promise<void>((resolve) => {
        video.ontimeupdate = () => resolve();
        setTimeout(resolve, 2000);
      });
    }
    return Number.isFinite(video.duration) ? video.duration : 0;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}
const MIN_LENGTH_RATIO = 0.8;

type Done = { job: BatchJob; blob: Blob; mime: string; seconds: number; videoSeconds: number };

export default function BatchRecorder() {
  const [plan, setPlan] = useState<BatchPlan | null>(null);
  const [reading, setReading] = useState(false);
  const [view, setView] = useState<'front' | 'side'>('front');
  const [showFace, setShowFace] = useState(false);
  const [current, setCurrent] = useState<BatchJob | null>(null);
  const [frame, setFrame] = useState(0);
  const [tick, setTick] = useState(0); // 녹화 중 매 화면마다 다시 그리게 한다 (정지 구간도 영상에 담기도록)
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; name: string; count: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const cancelled = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const resultUrl = useRef<string | null>(null);
  const yaw = view === 'side' ? Math.PI / 2 : 0;

  useEffect(() => {
    // 다른 탭으로 가면 그리기와 녹화가 멈춰 영상이 망가지므로 그만둔다
    const hidden = () => {
      if (document.hidden && running) cancelled.current = true;
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [running]);
  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    },
    [],
  );

  const pick = async (list: FileList | null) => {
    if (!list || !list.length) return;
    setReading(true);
    setError('');
    setPlan(null);
    clearResult();
    try {
      const files = Array.from(list).filter((f) => f.name.toLowerCase().endsWith('.json'));
      const big = files.find((f) => f.size > MAX_FILE_BYTES);
      if (big) throw new Error(`${big.name}: 40MB를 넘는 파일은 읽지 않습니다.`);
      const read = await Promise.all(
        files.map(async (f) => ({
          path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
          text: await f.text(),
        })),
      );
      const next = planJobs(read);
      setPlan(next);
      if (next.jobs[0]) {
        setCurrent(next.jobs[0]);
        setFrame(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setReading(false);
    }
  };

  function clearResult() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setResult(null);
  }

  const recordOne = async (job: BatchJob, mimeType: string): Promise<Done> => {
    setCurrent(job);
    setFrame(0);
    await nextPaint();
    await nextPaint();
    const node = canvas.current;
    if (!node || !node.captureStream) throw new Error('녹화할 그림을 찾지 못했습니다.');
    const stream = node.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    recorder.current = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    const { fps, frames } = job.motion.response;
    const duration = frames / fps;
    const started = performance.now();
    rec.start();
    try {
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (cancelled.current) return reject(new Error('녹화를 멈췄습니다. 녹화 중에는 이 탭을 앞에 두세요.'));
          const t = (performance.now() - started) / 1000 - HOLD_SECONDS;
          setFrame(t < 0 ? 0 : frameAtTime(t, fps, frames));
          setTick((n) => n + 1);
          if (t >= duration + HOLD_SECONDS) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await nextPaint();
      await nextPaint(); // 마지막 자세가 담기도록
    } finally {
      if (rec.state === 'recording') rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
    }
    const blob = new Blob(chunks, { type: rec.mimeType });
    if (!blob.size) throw new Error(`${outputName(job, 'webm')}: 영상이 비어 있습니다.`);
    const expected = duration + 2 * HOLD_SECONDS;
    const got = await videoSeconds(blob);
    if (got < expected * MIN_LENGTH_RATIO) {
      throw new Error(
        `${outputName(job, 'webm')}: 녹화된 영상이 ${got.toFixed(2)}초로 너무 짧습니다(기대 약 ${expected.toFixed(1)}초). 창이 가려지거나 최소화되면 녹화가 끊깁니다. 이 창을 화면에 보이게 두고 다시 녹화하세요.`,
      );
    }
    return { job, blob, mime: rec.mimeType, seconds: (performance.now() - started) / 1000, videoSeconds: got };
  };

  const start = async () => {
    if (!plan || !plan.jobs.length || plan.problems.length || running) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('이 브라우저에서는 영상 녹화를 지원하지 않습니다. 최신 Chrome에서 열어 주세요.');
      return;
    }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    if (!mimeType) {
      setError('지원하는 영상 형식을 찾지 못했습니다.');
      return;
    }
    cancelled.current = false;
    setRunning(true);
    setError('');
    clearResult();
    setProgress({ done: 0, total: plan.jobs.length });
    const done: Done[] = [];
    let size = '';
    try {
      for (const job of plan.jobs) {
        const clip = await recordOne(job, mimeType);
        // 녹화 도중 창 배율 · 화면이 바뀌면 영상 크기가 달라진다. 묶음 안 크기가 다르면 prepare_videos.py가 거부하므로 여기서 멈춘다
        const now = `${canvas.current?.width}x${canvas.current?.height}`;
        if (size && now !== size) {
          throw new Error(
            `${outputName(job, 'webm')}: 영상 크기가 ${size}에서 ${now}로 바뀌었습니다. 녹화 중에는 창을 다른 화면으로 옮기거나 확대 배율을 바꾸지 마세요.`,
          );
        }
        size = now;
        done.push(clip);
        setProgress({ done: done.length, total: plan.jobs.length });
      }
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const entries = await Promise.all(
        done.map(async (d) => ({ name: outputName(d.job, ext), data: new Uint8Array(await d.blob.arrayBuffer()) })),
      );
      const node = canvas.current;
      const info = {
        createdAt: new Date().toISOString(),
        credit: CREDIT,
        mimeType,
        canvas: { cssWidth: WIDTH, cssHeight: HEIGHT, width: node?.width ?? null, height: node?.height ?? null },
        settings: { view, showBody: true, showHands: true, showFace, holdSeconds: HOLD_SECONDS, speed: 1 },
        conditions: [...new Set(done.map((d) => d.job.condition))],
        clips: done.map((d) => ({
          file: outputName(d.job, ext),
          source: d.job.source,
          frames: d.job.motion.response.frames,
          fps: d.job.motion.response.fps,
          recordedSeconds: Number(d.seconds.toFixed(2)),
          videoSeconds: Number(d.videoSeconds.toFixed(2)),
          bytes: d.blob.size,
        })),
        note: '조건 · 원본 파일 이름이 있으므로 평가 참가자에게 주지 않는다. 참가자용 묶음은 prepare_videos.py로 만든다.',
      };
      const conditions = info.conditions.join(',');
      entries.push({ name: 'recording-info.json', data: new TextEncoder().encode(JSON.stringify(info, null, 2)) });
      entries.push({
        name: 'README.txt',
        data: new TextEncoder().encode(
          `평가 영상 일괄 녹화 결과 (${done.length}개)\n` +
            `압축을 새 폴더에 풀고 프로젝트 루트에서:\n` +
            `python3 viewer/seunghyeok/evaluation/prepare_videos.py --input <푼 폴더> --output <새 출력 폴더> --conditions ${conditions}\n` +
            `recording-info.json에는 조건 · 원본 파일 이름이 있으므로 평가 참가자에게 주지 않는다.\n` +
            `출처: ${CREDIT}\n` +
            `AI Hub 좌표로 만든 영상이다. 원본 좌표 파일은 승인된 사람의 컴퓨터 밖으로 내보내지 않는다.\n`,
        ),
      });
      const zip = makeZip(entries);
      const url = URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }));
      resultUrl.current = url;
      setResult({
        url,
        name: `evaluation-recordings-${new Date().toISOString().slice(0, 10)}.zip`,
        count: done.length,
      });
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : '녹화 중 오류가 났습니다.'} (${done.length}개까지 녹화, ZIP은 만들지 않았습니다)`,
      );
    } finally {
      setRunning(false);
      cancelled.current = false;
    }
  };

  const jobs = plan?.jobs ?? [];
  const conditionList = [...new Set(jobs.map((j) => j.condition))];
  const sentenceCount = new Set(jobs.map((j) => j.sentence)).size;
  return (
    <section aria-label="평가 영상 일괄 녹화" style={{ fontFamily: 'system-ui,sans-serif', color: '#152239' }}>
      <p style={{ padding: 14, borderRadius: 12, background: '#fff4dc', color: '#754b16', lineHeight: 1.6 }}>
        export_motion_json.py가 만든 출력 폴더를 고르세요. <code>&lt;조건&gt;/sentence-NN.json</code>만 읽고 나머지(private · README)는 건너뜁니다.
        모든 영상을 같은 크기({WIDTH}×{HEIGHT}) · 시점 · 표시 설정으로, 앞뒤 {HOLD_SECONDS}초 정지 화면을 넣어 1배속으로 녹화합니다. 녹화 중에는 이 탭을 앞에 두세요.
        좌표 파일은 이 브라우저 안에서만 읽습니다.
      </p>
      <div style={{ background: '#fff', padding: 20, borderRadius: 14, display: 'grid', gap: 12 }}>
        <label>출력 폴더 고르기{' '}
          <input
            aria-label="출력 폴더 고르기"
            type="file"
            disabled={running || reading}
            onChange={(e) => {
              const list = e.target.files;
              void pick(list);
              e.target.value = '';
            }}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
        </label>
        <label>또는 JSON 파일 여러 개 고르기 (파일 이름에 폴더가 없으면 조건을 알 수 없어 건너뜁니다){' '}
          <input
            aria-label="JSON 파일 고르기"
            type="file"
            multiple
            accept=".json,application/json"
            disabled={running || reading}
            onChange={(e) => {
              const list = e.target.files;
              void pick(list);
              e.target.value = '';
            }}
          />
        </label>
        {reading && <p role="status">파일을 읽는 중…</p>}
        {plan && (
          <p role="status">
            녹화할 영상 {jobs.length}개 · 조건 {conditionList.join(', ') || '없음'} · 문장 {sentenceCount}개
            {plan.skipped.length ? ` · 건너뛴 파일 ${plan.skipped.length}개` : ''}
          </p>
        )}
        {plan && plan.problems.length > 0 && (
          <div role="alert" style={{ color: '#b42318' }}>
            <b>고칠 것이 있어 녹화하지 않습니다.</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {plan.problems.slice(0, 20).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label>
            시점 <select
              aria-label="시점"
              style={control}
              disabled={running}
              value={view}
              onChange={(e) => setView(e.target.value as 'front' | 'side')}
            >
              <option value="front">정면</option>
              <option value="side">측면</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={showFace}
              disabled={running}
              onChange={(e) => setShowFace(e.target.checked)}
            /> 얼굴 좌표 표시 (기본 끔: 조건마다 얼굴 처리가 달라 평가가 기울 수 있다)
          </label>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            style={control}
            disabled={!plan || !jobs.length || plan.problems.length > 0 || running}
            onClick={() => void start()}
          >
            {running ? `녹화 중… ${progress.done} / ${progress.total}` : `일괄 녹화 시작 (${jobs.length}개)`}
          </button>
          {running && (
            <button
              style={control}
              onClick={() => {
                cancelled.current = true;
              }}
            >
              멈추기
            </button>
          )}
        </div>
        {running && (
          <progress value={progress.done} max={progress.total} aria-label="녹화 진행" style={{ width: '100%' }} />
        )}
        {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
        {result && (
          <p role="status">
            {result.count}개 녹화 완료. <a href={result.url} download={result.name}>ZIP 받기 ({result.name})</a>
            <br />새 폴더에 풀고 <code>prepare_videos.py --conditions {conditionList.join(',')}</code>로 번호 영상 묶음을
            만드세요.
          </p>
        )}
      </div>
      {current && (
        <div style={{ marginTop: 16, maxWidth: '100%', overflowX: 'auto' }}>
          <div style={{ width: WIDTH, background: '#111318', borderRadius: 14, padding: 12 }}>
            <p style={{ color: '#adb7ca', margin: 0, fontSize: 13 }}>
              {running ? '녹화 중인 영상' : '미리보기'} · {current.condition} /
              문장 {String(current.sentence).padStart(2, '0')} · {current.motion.response.frames}프레임 (이 글자는 영상에
              들어가지 않는다)
            </p>
            {/* 창 폭과 상관없이 같은 크기로 그린다(좁으면 가로로 넘긴다). 묶음 안 영상 크기가 다르면 prepare_videos.py가 거부한다 */}
            <div style={{ width: WIDTH }}>
              <MotionCanvas
                data={current.motion}
                frame={frame}
                tick={tick}
                yaw={yaw}
                pitch={0}
                showBody
                showHands
                showFace={showFace}
                height={HEIGHT}
                onCanvasReady={(c) => {
                  canvas.current = c;
                }}
                onViewChange={() => {
                  /* 녹화 시점은 위 선택으로만 바꾼다 */
                }}
              />
            </div>
          </div>
        </div>
      )}
      <p style={{ color: '#526078', fontSize: 13, marginTop: 12 }}>출처: {CREDIT}</p>
    </section>
  );
}
