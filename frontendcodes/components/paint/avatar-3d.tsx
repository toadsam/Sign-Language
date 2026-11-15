/**
 * 3D 캐릭터 (폰): public/avatar3d 페이지를 WebView 로 띄우고 postMessage 로 동작을 보낸다.
 * 페이지 주소는 avatar3dNativeUrl() — 배포 주소(EXPO_PUBLIC_AVATAR3D_URL) 또는 개발 서버.
 * 주소가 없거나 8초 안에 준비되지 않으면 onError 로 알리고, 부르는 쪽이 2D 펜 아바타로 돌아간다.
 */
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { AVATAR3D_READY_TIMEOUT, avatar3dNativeUrl, motionMessage, parseEvent, type Avatar3DProps } from './avatar-3d-shared';

export function Avatar3D({ motion, playing = true, loop = false, speed = 1, style, onFrame, onEnd, onError }: Avatar3DProps) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const latest = useRef({ motion, loop, playing, speed, onFrame, onEnd, onError });
  latest.current = { motion, loop, playing, speed, onFrame, onEnd, onError };
  const uri = avatar3dNativeUrl();
  const send = (msg: object) => web.current?.postMessage(JSON.stringify(msg));

  useEffect(() => {
    if (!uri) {
      latest.current.onError?.('3D 캐릭터 페이지 주소가 없어요');
      return;
    }
    const timer = setTimeout(() => {
      if (!ready.current) latest.current.onError?.('3D 캐릭터를 불러오지 못했어요');
    }, AVATAR3D_READY_TIMEOUT);
    return () => clearTimeout(timer);
  }, [uri]);

  useEffect(() => {
    if (ready.current) send(motionMessage(motion, loop));
  }, [motion, loop]);
  useEffect(() => {
    if (ready.current) send({ type: playing ? 'avatar3d-play' : 'avatar3d-pause' });
  }, [playing]);
  useEffect(() => {
    if (ready.current) send({ type: 'avatar3d-rate', rate: speed });
  }, [speed]);

  if (!uri) return <View style={style} />;
  return (
    <View style={[{ width: '100%', height: '100%' }, style]}>
      <WebView
        ref={web}
        source={{ uri }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        containerStyle={{ backgroundColor: 'transparent' }}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        onError={() => latest.current.onError?.('3D 캐릭터 페이지에 연결하지 못했어요')}
        onMessage={(e) => {
          const ev = parseEvent(e.nativeEvent.data);
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
        }}
      />
    </View>
  );
}
