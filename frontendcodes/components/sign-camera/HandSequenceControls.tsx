import type { useHandSequence } from './useHandSequence';
export default function HandSequenceControls({capture,enabled,photoMode,onStart,onReview}:{capture:ReturnType<typeof useHandSequence>;enabled:boolean;photoMode:boolean;onStart:()=>void;onReview?:()=>void}){
  const save=()=>{if(!capture.json)return;const url=URL.createObjectURL(new Blob([capture.json],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='hand-sequence-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <div style={{background:'#181b22',padding:14,borderRadius:10,marginTop:16}}><strong>손 동작 5초 좌표 수집</strong>
    <p>영상 대신 손 좌표와 추출 시각만 모읍니다. 고정 FPS로 늘리거나 빈 프레임을 만들지 않습니다.</p>
    <button disabled={!enabled||photoMode||capture.running} onClick={onStart}>5초 좌표 수집 시작</button>{' '}{capture.running&&<button onClick={capture.cancel}>좌표 수집 취소</button>}
    <p role="status">{capture.running?`${capture.elapsed.toFixed(1)} / 5초 · ${capture.count}프레임`:capture.notice}</p>
    {photoMode&&<p>사진은 한 프레임 저장을 사용하세요. 연속 수집은 카메라나 점검 영상에서 사용할 수 있습니다.</p>}
    {capture.json&&<button onClick={save}>수집 좌표 JSON 저장</button>}
    {capture.json&&onReview&&<>{' '}<button onClick={onReview}>수집 결과 바로 점검</button></>}
    <p style={{fontSize:13,color:'#adb7ca'}}>현재 좌표 수집의 최대 처리 속도는 초당 15회입니다. 손의 좌우 추정 오류·가림·미감지가 포함될 수 있습니다. 단어 인식 모델은 아직 연결하지 않았습니다.</p>
  </div>;
}
