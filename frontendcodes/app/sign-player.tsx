import LabHomeLink from '@/components/sign-player/LabHomeLink';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, Stack } from 'expo-router';
import type { Href } from 'expo-router';
import SignPlayer from '@/components/sign-player/SignPlayer';
import { decodeNativeMotion } from '@/components/sign-player/native-bridge';
import { decodeMotion } from '@/components/sign-player/motion';
import type { MotionResponse } from '@/components/sign-player/motion';
import demo from '@/components/sign-player/demo-motion.json';

export default function SignPlayerScreen() {
  const [motion,setMotion]=useState(demo as MotionResponse);
  const [name,setName]=useState('화면 점검용 샘플');
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const readVersion=useRef(0);
  useEffect(()=>()=>{readVersion.current++;},[]);
  useEffect(()=>{
    if(Platform.OS!=='web')return;
    const bridge=(window as unknown as {ReactNativeWebView?:{postMessage:(data:string)=>void}}).ReactNativeWebView;
    if(!bridge)return;
    let lastId:unknown;
    const receive=(event:MessageEvent)=>{
      try {
        if(typeof event.data!=='string')return;
        const message=decodeNativeMotion(event.data);
        if(!message||message.id===lastId)return;
        const next=message.motion;lastId=message.id;
        readVersion.current++;setLoading(false);setError(null);setMotion(next);setName('앱에서 전달한 동작');
      }catch(e){setError(e instanceof Error?e.message:'앱 동작을 읽을 수 없습니다.');bridge.postMessage(JSON.stringify({type:'sign-player-error',version:1}));}
    };
    window.addEventListener('message',receive);document.addEventListener('message',receive as EventListener);
    bridge.postMessage(JSON.stringify({type:'sign-player-ready',version:1}));
    return()=>{window.removeEventListener('message',receive);document.removeEventListener('message',receive as EventListener);};
  },[]);
  const loadFile=async(file:File|undefined)=>{
    if(!file)return;
    const version=++readVersion.current;setLoading(true);setError(null);
    try {
      if(file.size>40000000)throw new Error('40MB 이하 JSON을 선택해주세요.');
      const parsed=JSON.parse(await file.text()) as unknown;
      const next=decodeMotion(parsed).response;
      if(version!==readVersion.current)return;
      setMotion(next);setName(file.name);
    }catch(e){if(version===readVersion.current)setError(e instanceof Error?e.message:'파일을 읽을 수 없습니다.');}
    finally{if(version===readVersion.current)setLoading(false);}
  };
  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Stack.Screen options={{title:'동작 재생 실습'}}/>
    <LabHomeLink/>
    <Text style={styles.title}>수어 동작 재생</Text>
    <Text style={styles.description}>샘플을 재생하거나 동작 JSON 파일을 불러오세요.</Text>
    <Link href={'/sign-compare' as Href} style={{color:'#1f80e3',fontSize:16}}>4개 동작 비교 화면 열기 →</Link>
    <Link href={'/sign-codebook' as Href} style={{color:'#1f80e3',fontSize:16}}>코드북 격자 화면 열기 →</Link>
    <Link href={'/sign-reconstruct' as Href} style={{color:'#1f80e3',fontSize:16}}>원본·복원 비교 화면 열기 →</Link>
    <Link href={'/sign-generate' as Href} style={{color:'#1f80e3',fontSize:16}}>문장 입력 실습 화면 열기 →</Link>
    <Link href={'/sign-camera' as Href} style={{color:'#1f80e3',fontSize:16}}>웹캠 입력 실습 화면 열기 →</Link>
    {Platform.OS==='web'? <>
      <View style={styles.card}>
        <label style={{fontFamily:'system-ui,sans-serif',fontSize:15,color:'#1f2937'}}>동작 JSON 열기{' '}
          <input type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void loadFile(file);}}/>
        </label>
        <Text style={styles.filename}>{loading?'파일을 읽고 있습니다…':name}</Text>
        <Text style={styles.description}>{motion.frames}프레임 · {motion.fps}fps · {motion.frames/motion.fps}초</Text>
        {motion.demo?<Text style={styles.notice}>화면 점검용 합성 동작입니다. 실제 수어 또는 모델 결과가 아닙니다.</Text>:<Text style={styles.description}>동작 출처: {motion.source==='model'?'AI 생성':'기준선'}</Text>}
        {error?<Text accessibilityRole="alert" style={styles.error}>불러오기 실패: {error} 기존 동작을 유지합니다.</Text>:null}
      </View>
      <SignPlayer motion={motion}/>
    </>:<SignPlayer motion={motion}/>}
  </ScrollView>;
}
const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#eef2f8'},content:{padding:24,gap:16,width:'100%',maxWidth:1000,alignSelf:'center'},
  title:{fontSize:28,fontWeight:'700',color:'#152239'},description:{fontSize:14,lineHeight:22,color:'#526078'},
  card:{backgroundColor:'#fff',padding:20,borderRadius:16,gap:10},filename:{fontSize:16,fontWeight:'600',color:'#25324b'},
  notice:{color:'#845020',fontSize:14,lineHeight:22},error:{color:'#b42318',fontSize:14,lineHeight:22},
});
