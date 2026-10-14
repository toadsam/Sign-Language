import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { ScrollView,StyleSheet,Text } from 'react-native';
import { Link,Stack } from 'expo-router';
import type { Href } from 'expo-router';
import CameraLab from '@/components/sign-camera/CameraLab';
export default function SignCameraScreen(){return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
  <Stack.Screen options={{title:'웹캠 입력 실습'}}/>
  <LabHomeLink/>
    <Text style={styles.title}>웹캠 입력 준비</Text>
  <Text style={styles.description}>선택 기능인 웹캠 수어 인식에 앞서 카메라 연결과 화면 표시를 점검합니다.</Text>
  <Link href={'/sign-player' as Href} style={{color:'#1f80e3'}}>동작 재생 화면 →</Link>
  <Link href={'/sign-hand-review' as Href} style={{color:'#1f80e3'}}>저장한 손 좌표 재생 점검 →</Link>
  <CameraLab/>
</ScrollView>;}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#eef2f8'},content:{padding:24,gap:12,maxWidth:1000,width:'100%',alignSelf:'center'},title:{fontSize:28,fontWeight:'700',color:'#152239'},description:{fontSize:14,lineHeight:22,color:'#526078'}});
