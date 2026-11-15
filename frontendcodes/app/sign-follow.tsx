import { ScrollView, StyleSheet, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import FollowLab from '@/components/sign-camera/FollowLab';
import LabHomeLink from '@/components/sign-player/LabHomeLink';

/** 친구(AI 동작)를 보고 따라 하면 점수와 고칠 곳을 알려 주는 화면. 통역 화면에 붙이기 전 단계 */
export default function SignFollowScreen() {
  const params = useLocalSearchParams<{ gen?: string }>();
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: '따라 하기 채점' }} />
      <LabHomeLink />
      <Text style={styles.title}>따라 하고 점수 받기</Text>
      <Text style={styles.description}>
        친구가 하는 수어를 보고 따라 하면, 내 움직임을 같은 좌표로 바꿔 친구 동작과 견줍니다. 수어의 뜻을 판정하는 것은 아니고, 동작이 얼마나 비슷한지를 봅니다.
      </Text>
      <FollowLab genEndpoint={params.gen} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3EADB' },
  content: { padding: 24, gap: 12, maxWidth: 1000, width: '100%', alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#2E2620' },
  description: { fontSize: 14, lineHeight: 22, color: '#6B5D4F' },
});
