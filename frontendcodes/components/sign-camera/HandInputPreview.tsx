import type { HandFrame } from './hand-features';
import { prepareHandInput } from './hand-features';
export default function HandInputPreview({frame,source,mirrored}:{frame:HandFrame|null;source:string;mirrored:boolean}){
  const prepared=frame?prepareHandInput(frame):null;
  const save=()=>{
    if(!prepared)return;
    const content=JSON.stringify({...prepared,source,previewMirrored:mirrored,note:'화면용 입력 준비 형식입니다. 단어 인식 결과나 확정 ONNX 입력 계약이 아닙니다. 좌우는 모델 추정값이며 같은 쪽이 여러 개면 신뢰도가 높은 손만 선택합니다.'},null,2);
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='hand-input-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <details style={{background:'#181b22',padding:14,borderRadius:10,marginTop:16}}><summary>모델 입력용 손 좌표 점검</summary>
    <p>왼손 → 오른손 순서의 2D 좌표 84개를 준비합니다. 손목을 원점으로 옮기고 손바닥 크기로 나눕니다. 감지되지 않은 손은 0 좌표와 마스크 0으로 표시합니다.</p>
    {prepared?<><p>손 존재 마스크: [{prepared.mask.join(', ')}] · 입력 크기 [1, 2, 21, 2]</p><p>추출된 손 {frame!.hands.length}개 · 모델이 추정한 좌우 기준으로 선택</p><button onClick={save}>현재 손 좌표 JSON 저장</button></>:<p>손 21관절 표시를 켜면 좌표가 준비됩니다.</p>}
    <p style={{fontSize:13,color:'#adb7ca'}}>현재 한 프레임을 저장합니다. 영상과 음성은 저장하지 않습니다. 화면 좌우 반전은 저장 좌표에 적용하지 않습니다. 수어 단어 분류와 모델의 시간 구간 입력은 아직 연결하지 않았습니다.</p>
  </details>;
}
