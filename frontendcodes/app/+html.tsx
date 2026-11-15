/**
 * 웹 페이지의 뼈대 (웹에서만 쓰인다. 폰 앱 빌드와는 무관).
 *
 * 2026-11-15 재훈: 폰에서도 브라우저로 열어 "홈 화면에 추가"하면 앱처럼 쓸 수 있게(PWA)
 * 설치 정보(public/manifest.json)와 아이콘을 연결했다. 따라 하기(카메라 인식)는 웹에서만 되므로
 * 폰에서는 이 길로 쓴다. 내용은 Expo 기본 뼈대에 head 몇 줄을 더한 것이다.
 *
 * 주소는 배포 경로(app.json 의 experiments.baseUrl = /Sign-Language)를 따라야 해서 publicAssetPath 로 만든다.
 * manifest 안의 주소는 그 파일 기준 상대 주소라 경로가 바뀌어도 그대로 쓴다.
 * 오프라인 저장(service worker)은 넣지 않았다. 설치만 되고, 열 때는 인터넷이 필요하다.
 */
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { publicAssetPath } from '@/components/public-asset';

const PAPER = '#FBF5E6';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <link rel="manifest" href={publicAssetPath('manifest.json')} />
        <meta name="theme-color" content={PAPER} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="수어링고" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href={publicAssetPath('pwa/apple-touch-icon.png')} />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
