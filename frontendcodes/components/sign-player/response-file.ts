import { decodePlayback } from './playback';
import type { PlaybackResponse } from './playback';
import { generationEndpoint } from './generate-api';

/** Parses a local response without sending a request or executing file content. */
export async function readResponseFile(file: Pick<File,'size'|'arrayBuffer'>, baseUrl = ''): Promise<PlaybackResponse> {
  if (file.size > 40000000) throw new Error('응답 JSON은 40MB 이하 파일을 선택해주세요.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size || bytes.byteLength > 40000000) throw new Error('파일을 끝까지 읽지 못했습니다. 다시 다운로드해주세요.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('UTF-8 형식의 응답 JSON 파일이 필요합니다.'); }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('올바른 응답 JSON이 아닙니다. 파일이 완성됐는지 확인해주세요.'); }
  const result = decodePlayback(value);
  if (result.source !== 'video') return result;
  let base: string | undefined;
  if (baseUrl.trim()) base = generationEndpoint(baseUrl);
  const resolve = (url: string): string => {
    if (!url) return '';
    try { return new URL(url).toString(); }
    catch {
      if (!base) throw new Error('상대 영상 주소가 있습니다. 아래에 실제 API 전체 주소를 입력한 뒤 파일을 다시 선택해주세요.');
      return new URL(url, base).toString();
    }
  };
  return { ...result, items: result.items.map(item => ({ ...item, url: resolve(item.url) })),
    ...(result.videoUrl ? { videoUrl: resolve(result.videoUrl) } : {}) };
}
