/** Expo injects the route prefix when bundling; development normally uses an empty prefix. */
export function publicAssetPath(path:string,baseUrl=process.env.EXPO_BASE_URL??''){
  const prefix=baseUrl.replace(/^\/+|\/+$/g,'');
  const asset=path.replace(/^\/+/,'');
  return `${prefix?'/'+prefix:''}/${asset}`;
}
