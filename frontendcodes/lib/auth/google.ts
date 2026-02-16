import Constants from 'expo-constants';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export function useGoogleIdTokenAuthRequest() {
  // Use Expo AuthSession proxy URI explicitly in Expo Go.
  const redirectUri = 'https://auth.expo.io/@taewojake/frontendcodes';
  const isExpoGo = Constants.appOwnership === 'expo';
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    // In Expo Go, route everything through the web client + proxy redirect URI.
    clientId: isExpoGo ? webClientId : undefined,
    iosClientId: isExpoGo ? undefined : iosClientId,
    androidClientId: isExpoGo ? undefined : androidClientId,
    webClientId,
    redirectUri,
    selectAccount: true,
  });

  return { request, response, promptAsync };
}
