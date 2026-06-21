import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import api from './api';

/**
 * Configure how notifications appear when the app is in the foreground.
 * Note: `shouldShowAlert` was deprecated in SDK 53 in favour of
 * `shouldShowBanner` / `shouldShowList`.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Registers for push notifications, obtains the Expo push token,
 * and saves it to the backend. Safe to call multiple times.
 *
 * Remote (push) notifications were removed from Expo Go on Android with
 * SDK 53, so a development/production build is required — this function
 * skips gracefully when running inside Expo Go or on a simulator.
 */
export const registerForPushNotifications = async ({ welcome = false } = {}) => {
  // Push tokens require a physical device.
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device.');
    return null;
  }

  // Remote push is unavailable in Expo Go (SDK 53+). A dev build is required.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    console.log('Push notifications are not supported in Expo Go. Use a development build.');
    return null;
  }

  // Android channel — must exist before requesting a token.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'IECE Notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F46E5',
    });
  }

  // Request / check permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted.');
    return null;
  }

  try {
    // We deliver via Firebase Admin (FCM) directly, so we need the native FCM
    // device token — not an Expo push token. On Android this is the FCM
    // registration token (requires google-services.json + Firebase, which the
    // build provides). On iOS it is the APNs token.
    const devicePushToken = await getDeviceTokenWithRetry();
    if (!devicePushToken) {
      console.log('Could not obtain a device push token after retries.');
      return null;
    }

    // Save to backend. `welcome: true` (only on a fresh login) tells the
    // server to fire a personalized welcome push to this token.
    // The field stays named expoPushToken for backwards compatibility; it now
    // carries the native FCM device token.
    await api.put('/auth/push-token', { expoPushToken: devicePushToken, welcome });

    return devicePushToken;
  } catch (err) {
    console.log('Failed to get/save push token:', err.message);
    return null;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch the native FCM/APNs device token with retries. Obtaining the token can
 * be transiently interrupted (e.g. a Fast Refresh / app reload mid-request, or
 * brief network loss). Retrying with backoff recovers without losing the token.
 */
const getDeviceTokenWithRetry = async (attempts = 3) => {
  for (let i = 0; i < attempts; i++) {
    try {
      const tokenData = await Notifications.getDevicePushTokenAsync();
      return tokenData.data;
    } catch (err) {
      const isLast = i === attempts - 1;
      console.log(
        `Device push token attempt ${i + 1}/${attempts} failed: ${err.message}` +
          (isLast ? '' : ' — retrying...')
      );
      if (isLast) return null;
      await sleep(1500 * (i + 1)); // 1.5s, 3s backoff
    }
  }
  return null;
};
