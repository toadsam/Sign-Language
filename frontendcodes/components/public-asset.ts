/** Expo dev serves public files at root even when the bundle retains the export base path. */
export function publicAssetPath(path:string,baseUrl=__DEV__?'':process.env.EXPO_BASE_URL??''){
  const prefix=baseUrl.replace(/^\/+|\/+$/g,'');
  const asset=path.replace(/^\/+/,'');
  return `${prefix?'/'+prefix:''}/${asset}`;
}
