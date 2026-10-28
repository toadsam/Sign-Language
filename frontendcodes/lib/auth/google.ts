import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const GITHUB_PAGES_BASE_PATH = '/Sign-Language';

/** Read configuration without initializing an OAuth request. */
export function getGoogleClientConfiguration() {
  const isExpoGo = Constants.appOwnership === 'expo';
  const isWeb = Platform.OS === 'web';
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || undefined;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || undefined;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() || undefined;
  const activeClientId = isExpoGo || isWeb ? webClientId
    : Platform.OS === 'ios' ? iosClientId
    : Platform.OS === 'android' ? androidClientId : webClientId;
  return { isExpoGo, isWeb, webClientId, iosClientId, androidClientId, hasGoogleClientId: Boolean(activeClientId) };
}

/** Only mount the component using this hook when its platform client ID is configured. */
export function useGoogleIdTokenAuthRequest() {
  const { isExpoGo, isWeb, webClientId, iosClientId, androidClientId, hasGoogleClientId } = getGoogleClientConfiguration();
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    // Expo Go and web both use the Google web client id.
    clientId: isExpoGo || isWeb ? webClientId : undefined,
    iosClientId: isExpoGo ? undefined : iosClientId,
    androidClientId: isExpoGo ? undefined : androidClientId,
    webClientId,
    redirectUri: getRedirectUri(isWeb),
    selectAccount: true,
  });
  return { request, response, promptAsync, isExpoGo, hasGoogleClientId };
}

function getRedirectUri(isWeb: boolean) {
  if (isWeb && typeof window !== 'undefined') {
    if (window.location.hostname.endsWith('github.io')) {
      return `${window.location.origin}${GITHUB_PAGES_BASE_PATH}/login`;
    }
    return window.location.origin;
  }

  return AuthSession.makeRedirectUri({
    scheme: 'frontendcodes',
  });
}
