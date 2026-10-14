import { Platform,Pressable,ScrollView,StyleSheet,Text,View } from 'react-native';
import { Link,Stack } from 'expo-router';
import type { Href } from 'expo-router';
const screens=[
  {route:'/sign-player',title:'동작 하나 재생',state:'동작 JSON 불러오기',description:'몸·손·얼굴 좌표, 속도와 시점을 조절합니다. 합성 샘플로도 점검할 수 있습니다.'},
  {route:'/sign-compare',title:'네 동작 함께 비교',state:'조건별 JSON 필요',description:'원본·B1·B2·우리 방법을 같은 시간과 시점으로 재생합니다. 기본 자료는 합성 샘플입니다.'},
  {route:'/sign-reconstruct',title:'원본·복원 비교',state:'AI HTML 또는 JSON 불러오기',description:'팀 viewer.html의 클립을 선택하거나 두 JSON을 불러옵니다. 좌표 차이와 비교 보고서를 확인합니다.'},
  {route:'/sign-codebook',title:'코드북 살펴보기',state:'실제 코드북 연결 대기',description:'토큰별 4프레임 동작을 검색하고 재생합니다. 기본 목록은 모의 코드북입니다.'},
  {route:'/sign-generate',title:'문장 입력 흐름 점검',state:'모의 응답 · API 연결 대기',description:'입력·로딩·취소·실패·영상 대체 재생을 점검합니다. 실제 문장을 수어로 변환하지 않습니다.'},
  {route:'/sign-camera',title:'손 좌표 수집',state:'PC 웹 · 단어 모델 연결 대기',description:'카메라, 내 영상 또는 공개 시험 영상에서 손 관절을 추출하고 5초 좌표를 수집합니다.'},
  {route:'/sign-hand-review',title:'손 좌표 재생·품질 점검',state:'PC 웹 · 수집 JSON 불러오기',description:'수집 결과를 재생하고 미감지·추출 간격을 점검합니다. 품질 보고서도 저장할 수 있습니다.'},
];
export default function SignLab(){return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
  <Stack.Screen options={{title:'승혁 개발 작업실'}}/>
  <Text style={styles.title}>승혁 개발 작업실</Text>
  <Text style={styles.description}>현재 만든 화면을 한곳에서 열고 점검하세요. 아래 상태는 구현 범위 안내이며 서버나 모델의 실시간 상태가 아닙니다.</Text>
  <View style={styles.notice}><Text style={styles.noticeText}>실제 생성 API·코드북·인식 모델 연결과 팀 통합은 남아 있습니다. 합성 자료로 확인한 동작을 실제 수어 결과로 판단하지 마세요.</Text></View>
  {Platform.OS!=='web'&&<Text style={styles.description}>동작 재생 화면은 WebView 서버 주소가 필요합니다. 손 좌표 수집·점검은 PC 웹에서 사용하세요.</Text>}
  <View style={styles.grid}>{screens.map(screen=><Link key={screen.route} href={screen.route as Href} asChild>
    <Pressable accessibilityRole="link" style={styles.card}>
      <Text style={styles.cardTitle}>{screen.title}</Text><Text style={styles.state}>{screen.state}</Text>
      <Text style={styles.description}>{screen.description}</Text><Text style={styles.open}>화면 열기 →</Text>
    </Pressable>
  </Link>)}</View>
  <View style={styles.flow}><Text style={styles.cardTitle}>먼저 확인할 순서</Text>
    <Text style={styles.description}>동작 JSON이 있으면 재생 → 원본·복원 비교 → 비교 보고서 저장 순서로 진행하세요.</Text>
    <Text style={styles.description}>손 좌표는 수집 → 수집 결과 바로 점검 → 좌표·품질 보고서 저장 순서로 진행하세요.</Text>
  </View>
</ScrollView>;}
const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#eef2f8'},content:{padding:24,gap:18,maxWidth:1100,width:'100%',alignSelf:'center'},
  title:{fontSize:28,fontWeight:'700',color:'#152239'},description:{fontSize:14,lineHeight:22,color:'#526078'},
  notice:{backgroundColor:'#fff4dc',padding:16,borderRadius:12},noticeText:{fontSize:14,lineHeight:22,color:'#754b16'},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:16},card:{flexGrow:1,flexBasis:300,backgroundColor:'#fff',padding:20,borderRadius:14,gap:10},
  cardTitle:{fontSize:19,fontWeight:'700',color:'#152239'},state:{fontSize:13,color:'#375780',fontWeight:'600'},open:{fontSize:15,color:'#1f80e3'},
  flow:{backgroundColor:'#fff',padding:20,borderRadius:14,gap:10},
});
