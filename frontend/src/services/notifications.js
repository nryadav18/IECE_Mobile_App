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
export const registerForPushNotifications = async () => {
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
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

    if (!projectId) {
      console.log('No EAS projectId found; cannot get an Expo push token.');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenData.data;

    // Save to backend
    await api.put('/auth/push-token', { expoPushToken });

    return expoPushToken;
  } catch (err) {
    console.log('Failed to get/save push token:', err.message);
    return null;
  }
};
