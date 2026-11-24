import { Link } from 'expo-router';
import type { Href } from 'expo-router';
// 2026-11-24 승혁: 작업실 화면끼리는 replace로 오간다. push로 쌓으면 떠난 재생 화면이 뒤에서 계속 돌며
// 애니메이션 루프와 WebGL을 붙잡는다(설계서 UT-12 "떠날 때 루프 · 카메라 정리"). 브라우저 뒤로 가기는 작업실 메뉴 앞으로 간다.
export default function LabHomeLink(){
  return <Link replace href={'/sign-lab' as Href} style={{color:'#1f80e3',fontSize:15}}>승혁 작업실 메뉴로 →</Link>;
}
