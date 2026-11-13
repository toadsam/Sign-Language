import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Link, Stack } from 'expo-router';
import type { Href } from 'expo-router';
import GenerationLab from '@/components/sign-player/GenerationLab';
export default function SignGenerateScreen() {
  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Stack.Screen options={{title:'단어 입력 실습'}}/>
    <LabHomeLink/>
    <Text style={styles.title}>단어 입력부터 동작 재생까지</Text>
    <Text style={styles.description}>단어 하나를 입력해 수어 동작을 재생하세요. 실제 모델은 지정한 API에서, 합성 시험은 샘플에서 확인할 수 있습니다.</Text>
    <Link href={'/sign-player' as Href} style={{color:'#1f80e3'}}>동작 JSON 재생 화면 →</Link>
    <GenerationLab/>
  </ScrollView>;
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#eef2f8'},content:{padding:24,gap:12,width:'100%',maxWidth:1000,alignSelf:'center'},
 title:{fontSize:28,fontWeight:'700',color:'#152239'},description:{fontSize:14,lineHeight:22,color:'#526078'},
});
