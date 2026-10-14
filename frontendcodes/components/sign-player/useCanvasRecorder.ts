import { useCallback, useEffect, useRef, useState } from 'react';

export function useCanvasRecorder() {
  const active = useRef(false);
  const completed = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; filename: string; metadata: string } | null>(null);
  const url = useRef<string | null>(null);
  const release = useCallback(() => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; recorder.current = null; }, []);
  const cancel = useCallback(() => {
    generation.current++; active.current = false;
    if (recorder.current?.state !== 'inactive') recorder.current?.stop();
    release(); if (alive.current) setBusy(false);
  }, [release]);
  const stop = useCallback((fullMotion = false) => {
    if (!active.current) return;
    completed.current = fullMotion; active.current = false;
    const finishing = recorder.current;
    // Let React render the final pose before finishing the capture.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (finishing?.state === 'recording' && recorder.current === finishing) finishing.stop();
    }));
  }, []);
  const start = async (canvas: HTMLCanvasElement | null, metadata: Record<string, unknown>, prepare: () => void, play: () => void) => {
    if (active.current || busy) return;
    if (!canvas || !canvas.captureStream || typeof MediaRecorder === 'undefined') {
      setError('이 브라우저에서는 영상 저장을 지원하지 않습니다. 최신 Chrome에서 다시 시도해주세요.'); return;
    }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) { setError('지원하는 영상 형식을 찾지 못했습니다.'); return; }
    const version = ++generation.current;
    setError(''); setBusy(true); active.current = true; completed.current = false;
    try {
      prepare();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (version !== generation.current) return;
      const capture = canvas.captureStream(30); stream.current = capture;
      const rec = new MediaRecorder(capture, { mimeType, videoBitsPerSecond: 5000000 }); recorder.current = rec;
      const chunks: Blob[] = [], id = crypto.randomUUID(), started = performance.now();
      rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      rec.onerror = () => { cancel(); setError('녹화 중 오류가 발생했습니다. 다시 시도해주세요.'); };
      rec.onstop = () => {
        if (version !== generation.current || !alive.current) return;
        release(); active.current = false; setBusy(false);
        const blob = new Blob(chunks, { type: rec.mimeType });
        if (!blob.size) { setError('영상이 비어 있습니다. 다시 시도해주세요.'); return; }
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = URL.createObjectURL(blob);
        const filename = `motion-${id}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
        setResult({ url: url.current, filename, metadata: JSON.stringify({ id, filename, ...metadata, width: canvas.width, height: canvas.height, fullMotion: completed.current, captureFpsTarget: 30, elapsedSeconds: (performance.now()-started)/1000, mimeType: rec.mimeType }, null, 2) });
      };
      rec.start(); play();
    } catch (e) { cancel(); setError(e instanceof Error ? e.message : '녹화를 시작할 수 없습니다.'); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); if (url.current) URL.revokeObjectURL(url.current); }; }, [cancel]);
  return { active, busy, error, result, start, stop, cancel };
}
export type CanvasRecorder = ReturnType<typeof useCanvasRecorder>;
