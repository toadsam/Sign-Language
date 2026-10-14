import { decodeMotion } from './motion';
import type { DecodedMotion } from './motion';
export type AiViewer = {fps:number;clips:Record<string,unknown>[]};
/** Extract JSON only. Never execute the supplied HTML or its scripts. */
export function readAiViewer(text:string):AiViewer{
  const match=/\bconst\s+DATA\s*=\s*/.exec(text);
  if(!match)throw new Error('팀 viewer.html의 DATA 선언을 찾을 수 없습니다.');
  const start=match.index+match[0].length;
  if(text[start]!=='{')throw new Error('내보낸 JSON 데이터가 필요합니다.');
  let depth=0,quoted=false,escaped=false,end=-1;
  for(let i=start;i<text.length;i++){
    const c=text[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}
  }
  if(end<0||!text.slice(end).trimStart().startsWith(';'))throw new Error('JSON 데이터 선언이 완성되지 않았습니다.');
  const value=JSON.parse(text.slice(start,end));
  const parts={body:[0,13],lhand:[13,34],rhand:[34,55],face:[55,125]};
  if(!value.parts||Object.entries(parts).some(([name,range])=>JSON.stringify(value.parts[name])!==JSON.stringify(range)))throw new Error('125관절 부위 순서가 다릅니다.');
  if(!Number.isFinite(value.fps)||value.fps<=0||value.fps>240)throw new Error('FPS가 올바르지 않습니다.');
  if(!Array.isArray(value.clips)||!value.clips.length||value.clips.length>1000||value.clips.some((c:unknown)=>!c||typeof c!=='object'||Array.isArray(c)))throw new Error('1~1000개의 클립 객체가 필요합니다.');
  return {fps:value.fps,clips:value.clips};
}
export function decodeAiViewerPair(viewer:AiViewer,index:number,demo:boolean):[DecodedMotion,DecodedMotion]{
  if(!Number.isInteger(index)||index<0||index>=viewer.clips.length)throw new Error('클립 번호가 범위를 벗어났습니다.');
  const clip=viewer.clips[index],frames=clip.frames;
  if(!Number.isInteger(frames)||Number(frames)<1||Number(frames)>18000)throw new Error('프레임 수가 올바르지 않습니다.');
  return ['orig','recon'].map(key=>{
    const coordinates=clip[key];
    if(!Array.isArray(coordinates)||coordinates.length!==Number(frames)*375||coordinates.some(n=>!Number.isFinite(n)||Math.abs(n)>100))throw new Error(`${key}: 좌표 길이 또는 숫자가 올바르지 않습니다.`);
    const buffer=new ArrayBuffer(coordinates.length*4),view=new DataView(buffer);
    coordinates.forEach((n,i)=>view.setFloat32(i*4,n,true));
    const bytes=new Uint8Array(buffer);let raw='';
    for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return decodeMotion({fps:viewer.fps,joints:125,frames,units:'shoulder',data:btoa(raw),tokens:key==='recon'?clip.tokens??[]:[],segments:[],unknown:[],source:key==='recon'?'model':'baseline',demo});
  }) as [DecodedMotion,DecodedMotion];
}
