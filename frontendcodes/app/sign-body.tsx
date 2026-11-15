import { ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';

import BodyLab from '@/components/sign-camera/BodyLab';
import LabHomeLink from '@/components/sign-player/LabHomeLink';

/** 내 움직임을 AI 동작과 같은 좌표(상체 13 + 양손 42 = 55점)로 받는 화면. 채점의 앞 단계 */
export default function SignBodyScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: '내 움직임 좌표 받기' }} />
      <LabHomeLink />
      <Text style={styles.title}>내 움직임을 좌표로</Text>
      <Text style={styles.description}>
        손만 잡던 화면에 상체 인식을 더했습니다. 손이 몸의 어디에 있는지까지 알 수 있어서, AI가 만든 동작과 같은 자로 잴 수 있습니다.
      </Text>
      <BodyLab />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3EADB' },
  content: { padding: 24, gap: 12, maxWidth: 1000, width: '100%', alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#2E2620' },
  description: { fontSize: 14, lineHeight: 22, color: '#6B5D4F' },
});
