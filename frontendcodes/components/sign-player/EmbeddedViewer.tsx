import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MotionResponse } from './motion';
import { encodeNativeMotion } from './native-bridge';
import { viewerUrl } from './viewer-url';
import type { ViewerRoute } from './viewer-url';
export default function EmbeddedViewer({route,motion}:{route:ViewerRoute;motion?:MotionResponse}) {
  const preset=process.env.EXPO_PUBLIC_SIGN_VIEWER_URL ?? '';
  const [base,setBase]=useState(preset), [uri,setUri]=useState(()=>{try{return viewerUrl(preset,route);}catch{return '';}});
  const [error,setError]=useState(''), [loading,setLoading]=useState(false);
  const web=useRef<WebView>(null), ready=useRef(false), sequence=useRef(0);
  const latestMotion=useRef(motion);latestMotion.current=motion;
  const sendMotion=()=>{if(ready.current&&latestMotion.current)web.current?.postMessage(encodeNativeMotion(++sequence.current,latestMotion.current));};
  useEffect(()=>{sendMotion();},[motion]);
  const open=()=>{try{const next=viewerUrl(base,route);ready.current=false;setError('');setLoading(true);if(next===uri)web.current?.reload();else setUri(next);}catch(e){setError(e instanceof Error?e.message:'주소를 확인해주세요.');}};
  return <View style={styles.root}>
    <Text style={styles.description}>휴대폰에서 접속할 수 있는 웹 재생 서버 주소를 입력하세요. PC에서 쓰던 localhost는 휴대폰에서 PC를 가리키지 않습니다.</Text>
    <TextInput accessibilityLabel="웹 재생 서버 주소" value={base} onChangeText={setBase} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://웹서버주소/Sign-Language" style={styles.input}/>
    <Pressable accessibilityRole="button" onPress={open} style={styles.button}><Text style={styles.buttonText}>재생 화면 열기 / 다시 연결</Text></Pressable>
    {loading && <ActivityIndicator accessibilityLabel="재생 화면 로딩"/>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {uri ? <WebView key={uri} ref={web} source={{uri}} style={styles.web} javaScriptEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction nestedScrollEnabled
      onLoadStart={()=>{ready.current=false;setLoading(true);setError('');}}
      onLoadEnd={()=>setLoading(false)}
      onError={()=>{ready.current=false;setLoading(false);setError('웹 재생 화면에 연결할 수 없습니다. 서버 주소와 네트워크를 확인하고 다시 연결해주세요.');}}
      onHttpError={event=>{if(event.nativeEvent.url===uri){setLoading(false);setError(`재생 화면 연결 실패 (${event.nativeEvent.statusCode})`);}}}
      onMessage={event=>{try{const data=JSON.parse(event.nativeEvent.data);if(data.type==='sign-player-ready'&&data.version===1){ready.current=true;sendMotion();}else if(data.type==='sign-player-error'){setError('앱에서 전달한 동작을 웹 재생기가 읽지 못했습니다. 좌표 응답 형식을 확인해주세요.');}}catch{/* Ignore unrelated web messages. */}}}
      onShouldStartLoadWithRequest={request=>request.url==='about:blank'||request.url.startsWith('blob:')||(()=>{try{return new URL(request.url).origin===new URL(uri).origin;}catch{return false;}})()}/>
      : <Text style={styles.description}>서버 주소를 입력하면 이곳에 재생 화면이 열립니다.</Text>}
  </View>;
}
const styles=StyleSheet.create({
 root:{gap:12},description:{fontSize:14,color:'#526078',lineHeight:22},input:{borderWidth:1,borderColor:'#8794aa',borderRadius:8,padding:12,backgroundColor:'#fff',color:'#152239'},
 button:{padding:12,backgroundColor:'#232935',borderRadius:8},buttonText:{color:'#edf0fa',textAlign:'center'},error:{color:'#b42318'},web:{height:620,backgroundColor:'#111318'},
});
