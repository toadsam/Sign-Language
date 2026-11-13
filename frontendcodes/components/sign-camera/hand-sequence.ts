import { prepareHandInput } from './hand-features';
import type { HandFrame } from './hand-features';
export class HandSequence {
  readonly frames:{offsetMs:number;input:ReturnType<typeof prepareHandInput>}[]=[];
  constructor(readonly startedMs:number,readonly durationMs=5000){}
  add(frame:HandFrame){
    const offsetMs=frame.timestampMs-this.startedMs;
    if(offsetMs<0||offsetMs>this.durationMs||this.frames.length>=150)return;
    if(this.frames.length&&offsetMs<=this.frames[this.frames.length-1].offsetMs)return;
    this.frames.push({offsetMs,input:prepareHandInput(frame)});
  }
  result(){
    const first=this.frames[0]?.offsetMs??0,last=this.frames[this.frames.length-1]?.offsetMs??0;
    return {schema:'signlingo-hand-sequence-v1',shape:[this.frames.length,2,21,2],durationMs:this.durationMs,
      timestampsMs:this.frames.map(f=>f.offsetMs),features:this.frames.flatMap(f=>f.input.features),
      masks:this.frames.map(f=>f.input.mask),selectedScores:this.frames.map(f=>f.input.selectedScores),
      rawFrames:this.frames.map(f=>f.input.raw),handOrder:['Left','Right'],axisOrder:['x','y'],
      normalization:'wrist-origin,max-wrist-to-MCP-pixel-distance',
      observedSamplingHz:last>first?(this.frames.length-1)*1000/(last-first):0,
      note:'추출된 프레임의 실제 시각을 보존하며 고정 FPS로 재표본화하지 않습니다. 확정 모델 입력 계약이나 단어 인식 결과가 아닙니다.'};
  }
}
