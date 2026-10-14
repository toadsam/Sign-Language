export type ViewerRoute = 'sign-player' | 'sign-compare' | 'sign-codebook' | 'sign-reconstruct' | 'sign-generate';
export function viewerUrl(base: string, route: ViewerRoute): string {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new Error('웹 재생 서버 주소를 입력해주세요.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('HTTP 또는 HTTPS 서버 주소를 입력해주세요.');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/' + route;
  return url.toString();
}
