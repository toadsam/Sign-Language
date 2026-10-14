import type { CanvasRecorder } from './useCanvasRecorder';
const style = { background:'#232935',color:'#edf0fa',border:'1px solid #495266',borderRadius:8,padding:'8px 12px',font:'inherit' };
export default function RecordingControls({recorder,onStart,onStop,disabled=false}:{recorder:CanvasRecorder;onStart:()=>void;onStop:()=>void;disabled?:boolean}) {
  const saveMetadata = () => {
    if (!recorder.result) return;
    const url = URL.createObjectURL(new Blob([recorder.result.metadata], {type:'application/json'}));
    const a = document.createElement('a'); a.href=url; a.download=recorder.result.filename.replace(/\.[^.]+$/, '.json'); a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div style={{marginTop:16,color:'#edf0fa',background:'#111318',padding:14,borderRadius:12}}>
    <button style={style} disabled={disabled || recorder.busy} onClick={onStart}>전체 동작 녹화</button>{' '}
    {recorder.busy && <button style={style} onClick={onStop}>녹화 마치기</button>}
    <p style={{fontSize:13,color:'#adb7ca'}}>처음부터 1배속으로 한 번 녹화합니다. 영상에는 동작만 담깁니다. 녹화 중에는 이 탭을 열어두세요.</p>
    {recorder.busy && <p role="status">녹화 중… 동작이 끝나면 영상 다운로드 버튼이 나타납니다.</p>}
    {recorder.error && <p role="alert">{recorder.error}</p>}
    {!recorder.busy && recorder.result && <><a style={style} href={recorder.result.url} download={recorder.result.filename}>영상 다운로드</a>{' '}<button style={style} onClick={saveMetadata}>녹화 정보 저장</button><p style={{fontSize:13,color:'#adb7ca'}}>파일 이름은 무작위입니다. 녹화 정보에는 조건 이름이 있으므로 평가 참가자에게 전달하지 마세요.</p></>}
  </div>;
}
