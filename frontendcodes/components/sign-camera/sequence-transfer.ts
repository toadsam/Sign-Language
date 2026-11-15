import { decodeHandSequence } from './sequence-reader';
import type { HandSequenceData } from './sequence-reader';

// One-time transfer inside the current browser tab. No storage or network upload.
let pending:{data:HandSequenceData;name:string;json:string}|null=null;
export function prepareSequenceReview(json:string,name:string){
  if(json.length>5000000)throw new Error('5MB 이하 좌표 결과만 바로 점검할 수 있습니다.');
  const data=decodeHandSequence(JSON.parse(json));
  pending={data,name,json};
}
export function takeSequenceReview(){
  const result=pending;pending=null;return result;
}
