import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import ComparisonPlayer from '@/components/sign-player/ComparisonPlayer';
export default function SignCompareScreen() {
  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Stack.Screen options={{ title: '동작 비교 실습' }} />
    <LabHomeLink/>
    <Text style={styles.title}>네 동작을 함께 비교하기</Text>
    <Text style={styles.description}>공통 재생 버튼으로 움직임과 전환 구간을 나란히 확인하세요. 비교 이름은 직접 바꿀 수 있습니다.</Text>
    <ComparisonPlayer />
  </ScrollView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#eef2f8' }, content: { padding: 24, gap: 12, width: '100%', maxWidth: 1280, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#152239' }, description: { fontSize: 14, lineHeight: 22, color: '#526078' },
});
