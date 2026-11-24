import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import BatchRecorder from '@/components/sign-player/BatchRecorder';
export default function SignBatchRecordScreen() {
  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Stack.Screen options={{ title: '평가 영상 일괄 녹화' }} />
    <LabHomeLink/>
    <Text style={styles.title}>평가 영상 일괄 녹화</Text>
    <Text style={styles.description}>조건별 동작 JSON 폴더를 고르면 같은 설정으로 하나씩 녹화해 prepare_videos.py가 읽는 ZIP으로 내려 줍니다.</Text>
    <BatchRecorder />
  </ScrollView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#eef2f8' }, content: { padding: 24, gap: 12, width: '100%', maxWidth: 1000, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#152239' }, description: { fontSize: 14, lineHeight: 22, color: '#526078' },
});
