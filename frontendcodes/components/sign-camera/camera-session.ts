export class CameraSession {
  private generation=0;
  private stream:MediaStream|null=null;
  constructor(private acquire:()=>Promise<MediaStream>) {}
  get current(){return this.stream;}
  stop(){this.generation++;const previous=this.stream;this.stream=null;previous?.getTracks().forEach(track=>track.stop());}
  async start():Promise<MediaStream|null>{
    this.stop();const version=this.generation;
    try{
      const stream=await this.acquire();
      if(version!==this.generation){stream.getTracks().forEach(track=>track.stop());return null;}
      this.stream=stream;return stream;
    }catch(error){if(version!==this.generation)return null;throw error;}
  }
}
export function cameraError(error:unknown):string {
  const name=error&&typeof error==='object'&&'name' in error?String(error.name):'';
  if(name==='NotAllowedError')return '카메라 접근이 허용되지 않았습니다. 브라우저의 카메라 권한을 확인한 뒤 다시 켜주세요.';
  if(name==='NotFoundError')return '사용할 수 있는 카메라를 찾지 못했습니다.';
  if(name==='NotReadableError')return '카메라를 시작할 수 없습니다. 다른 앱에서 사용 중인지 확인해주세요.';
  if(name==='SecurityError')return '카메라 입력은 HTTPS 또는 localhost에서 열어주세요.';
  return '카메라 연결에 실패했습니다. 연결 상태를 확인하고 다시 시도해주세요.';
}
