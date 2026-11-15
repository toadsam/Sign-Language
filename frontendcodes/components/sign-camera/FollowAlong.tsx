import { Text } from 'react-native';

import type { Motion } from '@/lib/api/generate';

/** 폰 앱에서는 아직 따라 하기를 하지 않는다 (카메라 좌표 받기가 웹에서만 된다). 웹 판은 FollowAlong.web.tsx */
export default function FollowAlong(_props: { reference: Motion; title?: string }) {
  return <Text>따라 하기는 PC의 웹 브라우저에서 할 수 있어요.</Text>;
}
