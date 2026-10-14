import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Link, Stack } from 'expo-router';
import type { Href } from 'expo-router';
import ComparisonPlayer from '@/components/sign-player/ComparisonPlayer';
export default function SignReconstructScreen() {
  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Stack.Screen options={{title:'원본·복원 비교 실습'}}/>
    <LabHomeLink/>
    <Text style={styles.title}>원본과 복원 동작 비교하기</Text>
    <Text style={styles.description}>왼쪽은 원본, 오른쪽은 복원 동작입니다. 공통 재생과 프레임 이동으로 몸과 손의 자세를 비교하세요.</Text>
    <Link href={'/sign-codebook' as Href} style={{color:'#1f80e3'}}>코드북 격자 화면 →</Link>
    <ComparisonPlayer mode="reconstruction"/>
  </ScrollView>;
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#eef2f8'},content:{padding:24,gap:12,width:'100%',maxWidth:1280,alignSelf:'center'},
 title:{fontSize:28,fontWeight:'700',color:'#152239'},description:{fontSize:14,lineHeight:22,color:'#526078'},
});
