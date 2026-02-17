import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

export function useGoogleIdTokenAuthRequest() {
  const isExpoGo = Constants.appOwnership === 'expo';
  const isWeb = Platform.OS === 'web';
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const clientId = isExpoGo || isWeb ? webClientId : undefined;
  const hasGoogleClientId = Boolean(webClientId);
  const redirectUri = AuthSession.makeRedirectUri({
    // Expo Go must use proxy auth redirect.
    useProxy: isExpoGo,
    // Web login should return to local dev server, not auth.expo.io popup.
    preferLocalhost: isWeb,
    scheme: 'frontendcodes',
  });
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    // Expo Go and web both use the Google web client id.
    clientId,
    iosClientId: isExpoGo ? undefined : iosClientId,
    androidClientId: isExpoGo ? undefined : androidClientId,
    webClientId,
    redirectUri,
    selectAccount: true,
  });

  return { request, response, promptAsync, isExpoGo, hasGoogleClientId };
}
