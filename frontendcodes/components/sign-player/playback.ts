import { decodeMotion } from './motion';
import type { MotionResponse } from './motion';
import type { TranslatePlaybackItem } from '../../lib/api/translate';
export type VideoResponse = { source: 'video'; items: TranslatePlaybackItem[]; videoUrl?: string; unknown: string[]; demo?: boolean };
export type PlaybackResponse = MotionResponse | VideoResponse;
function videoUrl(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||value!==value.trim())throw new Error('영상 주소가 필요합니다.');
  let url:URL;
  try{url=new URL(value,'https://local.invalid/');}catch{throw new Error('영상 주소가 올바르지 않습니다.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('HTTP 또는 HTTPS 영상 주소가 필요합니다.');
  return value;
}
export function nextVideoIndex(items:TranslatePlaybackItem[],index:number,loop=false):number {
  for(let i=index+1;i<items.length;i++)if(items[i].hasVideo)return i;
  if(loop)for(let i=0;i<=index&&i<items.length;i++)if(items[i].hasVideo)return i;
  return -1;
}
export function decodePlayback(value: unknown): PlaybackResponse {
  if(!value||typeof value!=='object')throw new Error('재생 응답 객체가 필요합니다.');
  const r=value as Record<string,unknown>;
  if(r.source!=='video')return decodeMotion(value).response;
  if(!Array.isArray(r.unknown)||r.unknown.some(word=>typeof word!=='string'))throw new Error('미지원 단어 목록이 올바르지 않습니다.');
  let items:TranslatePlaybackItem[];
  let legacyUrl:string|undefined;
  if(r.items!==undefined){
    if(!Array.isArray(r.items)||r.items.length>1000)throw new Error('영상 목록은 1,000개 이하의 배열이어야 합니다.');
    items=r.items.map((entry:unknown)=>{
      if(!entry||typeof entry!=='object')throw new Error('영상 목록 항목이 올바르지 않습니다.');
      const item=entry as Record<string,unknown>;
      if(typeof item.word!=='string'||!item.word.trim()||!Number.isSafeInteger(item.id)||(item.id as number)<0||typeof item.file!=='string'||typeof item.url!=='string'||typeof item.hasVideo!=='boolean')throw new Error('영상 목록의 word·id·file·url·hasVideo 형식을 확인해주세요.');
      if(item.hasVideo||item.url)videoUrl(item.url);
      return {word:item.word,id:item.id as number,file:item.file,url:item.url,hasVideo:item.hasVideo};
    });
  }else{
    legacyUrl=videoUrl(r.videoUrl);
    items=[{word:'응답 영상',id:0,file:'',url:legacyUrl,hasVideo:true}];
  }
  return {source:'video',items,...(legacyUrl?{videoUrl:legacyUrl}:{}),unknown:r.unknown as string[],demo:r.demo===true};
}
