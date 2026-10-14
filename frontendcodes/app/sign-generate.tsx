import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Link, Stack } from 'expo-router';
import type { Href } from 'expo-router';
import GenerationLab from '@/components/sign-player/GenerationLab';
export default function SignGenerateScreen() {
  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Stack.Screen options={{title:'문장 입력 실습'}}/>
    <LabHomeLink/>
    <Text style={styles.title}>문장 입력부터 동작 재생까지</Text>
    <Text style={styles.description}>문장을 입력하고 응답 대기·안내·재생 흐름을 샘플로 확인하세요.</Text>
    <Link href={'/sign-player' as Href} style={{color:'#1f80e3'}}>동작 JSON 재생 화면 →</Link>
    <GenerationLab/>
  </ScrollView>;
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#eef2f8'},content:{padding:24,gap:12,width:'100%',maxWidth:1000,alignSelf:'center'},
 title:{fontSize:28,fontWeight:'700',color:'#152239'},description:{fontSize:14,lineHeight:22,color:'#526078'},
});
