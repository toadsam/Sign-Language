/**
 * 3D 캐릭터 (웹): 같은 앱 주소의 public/avatar3d 페이지를 iframe 으로 띄우고 postMessage 로 동작을 보낸다.
 */
import { createElement, useEffect, useRef } from 'react';
import { View } from 'react-native';

import { AVATAR3D_READY_TIMEOUT, avatar3dWebPath, motionMessage, parseEvent, type Avatar3DProps } from './avatar-3d-shared';

export function Avatar3D({ motion, playing = true, loop = false, speed = 1, style, onFrame, onEnd, onError }: Avatar3DProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const ready = useRef(false);
  // 메시지 처리기는 한 번만 달고, 최신 값은 ref 로 읽는다
  const latest = useRef({ motion, loop, playing, speed, onFrame, onEnd, onError });
  latest.current = { motion, loop, playing, speed, onFrame, onEnd, onError };
  const send = (msg: object) => frame.current?.contentWindow?.postMessage(msg, window.location.origin);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!ready.current) latest.current.onError?.('3D 캐릭터를 불러오지 못했어요');
    }, AVATAR3D_READY_TIMEOUT);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const ev = parseEvent(e.data);
      if (!ev) return;
      const l = latest.current;
      if (ev.type === 'avatar3d-ready') {
        ready.current = true;
        send(motionMessage(l.motion, l.loop));
        if (!l.playing) send({ type: 'avatar3d-pause' });
        if (l.speed !== 1) send({ type: 'avatar3d-rate', rate: l.speed });
      } else if (ev.type === 'avatar3d-frame') l.onFrame?.(ev.frame);
      else if (ev.type === 'avatar3d-end') l.onEnd?.();
      else if (ev.type === 'avatar3d-error') l.onError?.(ev.message);
    };
    window.addEventListener('message', onMessage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  // 동작이 바뀌면 (페이지가 준비된 뒤라면) 새로 보낸다
  useEffect(() => {
    if (ready.current) send(motionMessage(motion, loop));
  }, [motion, loop]);
  useEffect(() => {
    if (ready.current) send({ type: playing ? 'avatar3d-play' : 'avatar3d-pause' });
  }, [playing]);
  useEffect(() => {
    if (ready.current) send({ type: 'avatar3d-rate', rate: speed });
  }, [speed]);

  return (
    <View style={[{ width: '100%', height: '100%' }, style]}>
      {createElement('iframe', {
        ref: frame,
        src: avatar3dWebPath(),
        title: '수어 3D 캐릭터',
        style: { width: '100%', height: '100%', border: 0, background: 'transparent', display: 'block' },
      })}
    </View>
  );
}
