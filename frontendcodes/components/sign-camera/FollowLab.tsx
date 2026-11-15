import { Text } from 'react-native';

/** 폰 앱에서는 아직 따라 하기 채점을 하지 않는다. 웹 판은 FollowLab.web.tsx */
export default function FollowLab(_props: { genEndpoint?: string }) {
  return <Text>따라 하기 채점은 PC의 웹 브라우저에서 열어 주세요.</Text>;
}
