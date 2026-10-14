import { Link } from 'expo-router';
import type { Href } from 'expo-router';
export default function LabHomeLink(){
  return <Link href={'/sign-lab' as Href} style={{color:'#1f80e3',fontSize:15}}>승혁 작업실 메뉴로 →</Link>;
}
