import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { ScrollView,StyleSheet,Text } from 'react-native';
import { Link,Stack } from 'expo-router';
import type { Href } from 'expo-router';
import SequenceReview from '@/components/sign-camera/SequenceReview';
export default function HandReviewScreen(){return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
  <Stack.Screen options={{title:'손 좌표 재생 점검'}}/><LabHomeLink/>
    <Text style={styles.title}>수집한 손 좌표 다시 보기</Text>
  <Text style={styles.description}>저장한 연속 좌표를 재생하며 손 자세와 미감지 구간을 확인하세요.</Text>
  <Link href={'/sign-camera' as Href} style={{color:'#1f80e3'}}>웹캠 좌표 수집 화면 →</Link><SequenceReview/>
</ScrollView>;}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#eef2f8'},content:{padding:24,gap:12,maxWidth:1000,width:'100%',alignSelf:'center'},title:{fontSize:28,fontWeight:'700',color:'#152239'},description:{fontSize:14,lineHeight:22,color:'#526078'}});
