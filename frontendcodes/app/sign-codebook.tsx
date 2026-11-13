import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Link, Stack } from 'expo-router';
import type { Href } from 'expo-router';
import CodebookGrid from '@/components/sign-player/CodebookGrid';
export default function SignCodebookScreen() {
  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Stack.Screen options={{title:'코드북 동작 실습'}}/>
    <LabHomeLink/>
    <Text style={styles.title}>토큰별 짧은 동작 살펴보기</Text>
    <Text style={styles.description}>코드북의 토큰 하나에 대응하는 4프레임 동작을 나란히 확인하세요.</Text>
    <Link href={'/sign-player' as Href} style={{color:'#1f80e3'}}>단일 동작 재생 화면 →</Link>
    <CodebookGrid/>
  </ScrollView>;
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#eef2f8'},content:{padding:24,gap:12,width:'100%',maxWidth:1280,alignSelf:'center'},
 title:{fontSize:28,fontWeight:'700',color:'#152239'},description:{fontSize:14,lineHeight:22,color:'#526078'},
});
