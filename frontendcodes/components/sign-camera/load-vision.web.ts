import { publicAssetPath } from '../public-asset';
import type { FilesetResolver,HandLandmarker } from '@mediapipe/tasks-vision';
type VisionLibrary={FilesetResolver:typeof FilesetResolver;HandLandmarker:typeof HandLandmarker};
let pending:Promise<VisionLibrary>|null=null;
export function loadVision():Promise<VisionLibrary>{
  const scope=window as unknown as {Vision?:VisionLibrary};
  if(scope.Vision)return Promise.resolve(scope.Vision);
  if(pending)return pending;
  pending=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=publicAssetPath('hand-landmarker/vision_bundle.js');script.async=true;
    script.onload=()=>{if(scope.Vision)resolve(scope.Vision);else{pending=null;script.remove();reject(new Error('Vision library unavailable'));}};
    script.onerror=()=>{pending=null;script.remove();reject(new Error('Vision library could not load'));};
    document.head.appendChild(script);
  });return pending;
}
