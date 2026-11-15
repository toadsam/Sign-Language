/**
 * 상체와 손을 같이 뽑는 부품 (웹). 영상(카메라 · 파일) 위에 겹쳐 그리고, 장마다 인식 결과를 알려 준다.
 *
 * 손 인식기는 승혁의 HandOverlay 와 같은 모델 · 같은 묶음(public/hand-landmarker)을 쓴다.
 * 상체 인식기 모델은 public/pose-landmarker/pose_landmarker_lite.task 가 있으면 그것을 쓰고,
 * 없으면 MediaPipe 공식 주소에서 받는다. 받는 것은 모델 파일뿐이고, 카메라 영상은 어디로도 보내지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';

import { publicAssetPath } from '../public-asset';
import type { BodyCapture } from './body-frame';
import { HAND_EDGES, fitPoint } from './hand-overlay';
import { loadVision } from './load-vision.web';

type Props = {
  input: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  /** 화면 표시만 뒤집는다. 좌표는 원본 그대로 */
  mirrored: boolean;
  onStatus: (status: string) => void;
  /** 한 장을 인식할 때마다. 꺼지면 null */
  onCapture: (capture: BodyCapture | null) => void;
};

const POSE_LOCAL = 'pose-landmarker/pose_landmarker_lite.task';
const POSE_REMOTE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const RUNS_PER_SECOND = 15;
// 상체 인식기 번호로 그릴 선: 어깨 · 팔 · 몸통
const POSE_LINES: [number, number][] = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];

/** 저장소에 모델 파일이 있으면 그것을 쓴다 (없으면 개발 서버가 HTML 을 돌려주므로 종류로 가린다) */
async function poseModelPath(): Promise<string> {
  const local = publicAssetPath(POSE_LOCAL);
  try {
    const response = await fetch(local, { method: 'HEAD' });
    if (response.ok && !(response.headers.get('content-type') ?? '').includes('text/html')) return local;
  } catch {
    // 아래 공식 주소로
  }
  return POSE_REMOTE;
}

export default function BodyTracker({ input, enabled, mirrored, onStatus, onCapture }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = useRef(onStatus);
  status.current = onStatus;
  const notify = useRef(onCapture);
  notify.current = onCapture;
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let hands: HandLandmarker | null = null;
    let pose: PoseLandmarker | null = null;
    let id = 0;
    let lastTime = -1;
    let lastRun = 0;
    let rest = 0;
    let lastStatus = 0;
    const clear = () => {
      const element = canvas.current;
      element?.getContext('2d')?.clearRect(0, 0, element.width, element.height);
    };
    clear();
    notify.current(null);
    setError('');
    if (!enabled) return;
    status.current('상체 · 손 인식을 준비하고 있어요…');

    const run = async () => {
      try {
        const { FilesetResolver, HandLandmarker, PoseLandmarker } = await loadVision();
        if (cancelled) return;
        const files = await FilesetResolver.forVisionTasks(publicAssetPath('hand-landmarker/wasm'));
        const poseModel = await poseModelPath();
        if (cancelled) return;
        // 그래픽 카드로 먼저 켜 보고, 안 되면 CPU 로 켠다. CPU 로만 돌리면 두 모델이 화면 그리기와 같은 줄에서 돌아 화면이 심하게 버벅였다 (2026-11-15)
        const create = (delegate: 'GPU' | 'CPU') =>
          Promise.all([
            HandLandmarker.createFromOptions(files, {
              baseOptions: { modelAssetPath: publicAssetPath('hand-landmarker/hand_landmarker.task'), delegate },
              runningMode: 'VIDEO',
              numHands: 2,
            }),
            PoseLandmarker.createFromOptions(files, {
              baseOptions: { modelAssetPath: poseModel, delegate },
              runningMode: 'VIDEO',
              numPoses: 1,
            }),
          ]);
        let created: [HandLandmarker, PoseLandmarker];
        try {
          created = await create('GPU');
        } catch {
          created = await create('CPU');
        }
        const [createdHands, createdPose] = created;
        if (cancelled) {
          createdHands.close();
          createdPose.close();
          return;
        }
        hands = createdHands;
        pose = createdPose;
        status.current('준비됐어요');

        const tick = (now: number) => {
          if (cancelled) return;
          const source = input.current;
          const element = canvas.current;
          if (document.hidden || !source || !element || source.readyState < 2) {
            id = requestAnimationFrame(tick);
            return;
          }
          const frameTime = source.currentTime;
          const sw = source.videoWidth;
          const sh = source.videoHeight;
          if (now - lastRun >= Math.max(1000 / RUNS_PER_SECOND, rest) && frameTime !== lastTime && sw && sh) {
            try {
              const began = performance.now();
              const handResult = hands!.detectForVideo(source, now);
              const poseResult = pose!.detectForVideo(source, now);
              // 인식에 걸린 시간의 두 배만큼은 쉰다. 느린 컴퓨터에서도 화면이 절반은 숨을 쉬게
              rest = (performance.now() - began) * 2;
              lastTime = frameTime;
              lastRun = now;
              const body = poseResult.landmarks[0] ?? null;

              const width = element.clientWidth;
              const height = element.clientHeight;
              element.width = width;
              element.height = height;
              const context = element.getContext('2d');
              if (context) {
                context.clearRect(0, 0, width, height);
                context.lineCap = 'round';
                if (body) {
                  const at = (i: number) => fitPoint(body[i].x, body[i].y, sw, sh, width, height);
                  context.strokeStyle = '#FFC83D';
                  context.fillStyle = '#FFC83D';
                  context.lineWidth = 4;
                  for (const [a, b] of POSE_LINES) {
                    if ((body[a].visibility ?? 1) < 0.5 || (body[b].visibility ?? 1) < 0.5) continue;
                    const p = at(a);
                    const q = at(b);
                    context.beginPath();
                    context.moveTo(p.x, p.y);
                    context.lineTo(q.x, q.y);
                    context.stroke();
                  }
                  const nose = at(0);
                  context.beginPath();
                  context.arc(nose.x, nose.y, 6, 0, Math.PI * 2);
                  context.fill();
                }
                handResult.landmarks.forEach((hand) => {
                  context.strokeStyle = '#F2937A';
                  context.fillStyle = '#F2937A';
                  context.lineWidth = 2;
                  const points = hand.map((p) => fitPoint(p.x, p.y, sw, sh, width, height));
                  for (const [a, b] of HAND_EDGES) {
                    context.beginPath();
                    context.moveTo(points[a].x, points[a].y);
                    context.lineTo(points[b].x, points[b].y);
                    context.stroke();
                  }
                  for (const point of points) {
                    context.beginPath();
                    context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
                    context.fill();
                  }
                });
              }

              notify.current({
                timestampMs: now,
                width: sw,
                height: sh,
                pose: body ? body.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) : null,
                hands: handResult.landmarks.map((hand) => hand.map((p) => ({ x: p.x, y: p.y, z: p.z }))),
              });
              if (now - lastStatus > 500) {
                lastStatus = now;
                status.current(
                  body
                    ? `상체를 찾았어요 · 손 ${handResult.landmarks.length}개`
                    : '상체를 찾지 못했어요. 어깨가 화면에 들어오게 서 주세요'
                );
              }
            } catch {
              setError('인식 중에 문제가 생겼어요. 껐다가 다시 켜 주세요.');
              status.current('인식 멈춤');
              notify.current(null);
              clear();
              return;
            }
          }
          id = requestAnimationFrame(tick);
        };
        id = requestAnimationFrame(tick);
      } catch (cause) {
        console.error('Body tracker initialization failed', cause);
        if (!cancelled) {
          setError('인식 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.');
          status.current('준비 실패');
        }
      }
    };
    void run();

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      hands?.close();
      pose?.close();
      notify.current(null);
      clear();
    };
  }, [enabled, input]);

  return (
    <>
      <canvas
        ref={canvas}
        aria-label="찾은 상체와 손 표시"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', transform: mirrored ? 'scaleX(-1)' : 'none' }}
      />
      {error && (
        <p role="alert" style={{ position: 'absolute', top: 0, left: 0, margin: 0, background: '#2E2620', color: '#FDEAE4', padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}
    </>
  );
}
