// Render the real login component with isolated platform/configuration dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');

function load(relative, mocks, env, browser) {
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, console, process: { env }, window: browser,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
  }, { filename });
  return module.exports;
}

async function check({ name, os = 'web', expoGo = false, env = {}, expected, github = false }) {
  const buttons = [];
  const calls = [];
  const navigation = [];
  let guestCalls = 0;
  let promptCalls = 0;
  const box = (props) => React.createElement('div', null, props.children);
  const rn = {
    Platform: { OS: os }, View: box, Text: box, ImageBackground: box,
    StyleSheet: { create: (x) => x, absoluteFillObject: {} },
    Pressable: (props) => {
      buttons.push(props);
      return React.createElement('button', { disabled: props.disabled }, props.children);
    },
  };
  const browser = { location: { hostname: github ? 'example.github.io' : 'localhost',
    origin: github ? 'https://example.github.io' : 'http://localhost:8096' } };
  const auth = load('lib/auth/google.ts', {
    'react-native': rn,
    'expo-constants': { appOwnership: expoGo ? 'expo' : null },
    'expo-web-browser': { maybeCompleteAuthSession() {} },
    'expo-auth-session': { makeRedirectUri: () => 'frontendcodes://' },
    'expo-auth-session/providers/google': {
      useIdTokenAuthRequest(config) {
        // Mirror the installed provider's synchronous failure on missing IDs.
        const effective = config[os === 'ios' ? 'iosClientId' : os === 'android' ? 'androidClientId' : 'webClientId'] ?? config.clientId;
        assert.ok(effective, 'Google provider must never initialize without a client ID');
        calls.push(config);
        return [{}, null, async () => { promptCalls++; return { type: 'cancel' }; }];
      },
    },
  }, env, browser);
  // 2026-11-18 승혁: 재훈의 '색칠 마을' 로그인 화면(PaintButton · usePaintNav · useAppSize 등)에 맞춰 부품을 흉내 낸다.
  // 새 화면에는 "Google 로그인이 아직 설정되지 않았어요." 안내가 없고, 설정이 없으면 구글 버튼이 비활성화된다.
  const paintButton = (props) => {
    buttons.push(props);
    return React.createElement('button', { disabled: props.disabled }, props.label);
  };
  const login = load('app/login.tsx', {
    'react-native': rn,
    'react-native-safe-area-context': { SafeAreaView: box },
    '@expo/vector-icons': { Ionicons: () => null, MaterialCommunityIcons: () => null },
    'expo-router': { useRouter: () => ({ replace: (route) => navigation.push(route), push: (route) => navigation.push(route) }) },
    '@/hooks/use-app-size': { useAppSize: () => ({ width: 390, height: 844 }) },
    '@/components/paint/login-art': { LoginArt: () => null },
    '@/components/paint/logo': { LOGO_NAME: '수어링고', VillageLogo: () => null },
    '@/components/paint/paint-ui': { BodyText: box, Mark: box, PaintButton: paintButton, PaperScreen: box, StoryText: box },
    '@/components/paint/transition': { usePaintNav: () => ({ go: async (route) => { navigation.push(route); } }) },
    '@/constants/paint': { Size: { title: 1, display: 1, small: 1, caption: 1 } },
    '@/context/auth-context': { useAuth: () => ({ continueAsGuest: async () => { guestCalls++; } }) },
    '@/lib/api/base-url': { getBaseUrl: () => 'http://127.0.0.1:9' },
    '@/lib/auth/google': auth,
  }, env, browser);
  assert.equal(auth.getGoogleClientConfiguration().hasGoogleClientId, expected);
  const html = renderToStaticMarkup(React.createElement(login.default));
  assert.match(html, /로그인 없이 둘러보기/);
  assert.match(html, /구글로 계속하기/);
  assert.equal(calls.length, expected ? 1 : 0);
  assert.equal(Boolean(buttons[0].disabled), !expected, '설정이 없으면 구글 버튼만 비활성화');
  assert.equal(Boolean(buttons[1].disabled), false, '로그인 없이 둘러보기는 늘 쓸 수 있다');
  if (expected) {
    const config = calls[0];
    assert.equal(config.redirectUri, os === 'web'
      ? github ? 'https://example.github.io/Sign-Language/login' : 'http://localhost:8096'
      : 'frontendcodes://');
    await buttons[0].onPress();
    assert.equal(promptCalls, 1);
  }
  await buttons[1].onPress({ x: 0, y: 0 });
  assert.equal(guestCalls, 1);
  assert.deepEqual(navigation, ['/home']);
  console.log(`PASS ${name}`);
}

(async () => {
  for (const scenario of [
    { name: 'web: absent configuration', expected: false },
    { name: 'web: empty configuration', env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '' }, expected: false },
    { name: 'web: whitespace configuration', env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '   ' }, expected: false },
    { name: 'web: native-only ID is insufficient', env: { EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-test' }, expected: false },
    { name: 'web: configured OAuth path', env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-test' }, expected: true },
    { name: 'web: GitHub Pages redirect', github: true, env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-test' }, expected: true },
    { name: 'iOS: native ID', os: 'ios', env: { EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-test' }, expected: true },
    { name: 'Android: native ID', os: 'android', env: { EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'android-test' }, expected: true },
    { name: 'iOS: web-only ID is insufficient', os: 'ios', env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-test' }, expected: false },
    { name: 'Expo Go: web ID', os: 'ios', expoGo: true, env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-test' }, expected: true },
    { name: 'Expo Go: native-only ID is insufficient', os: 'ios', expoGo: true, env: { EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-test' }, expected: false },
  ]) await check(scenario);
  console.log('11 login render/guest/configuration scenarios passed. Real OAuth and native UI are not exercised.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
