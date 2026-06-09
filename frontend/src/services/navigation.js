import { createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';

/**
 * App-wide navigation ref. Lets us navigate from outside React components
 * (e.g. from notification handlers in AuthContext). Attach it to the
 * <NavigationContainer ref={navigationRef}> in App.js.
 */
export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

/**
 * Routes the user to the relevant screen based on a tapped push notification.
 * Only the default tap action is handled. The push `data` payload is set by the
 * backend (see utils/pushNotification.js) and carries `type` and `relatedId`.
 */
export function handleNotificationResponse(response) {
  if (!response) return;
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

  const data = response.notification?.request?.content?.data || {};
  const { type, relatedId } = data;

  if (!relatedId) return;

  if (type === 'activity_approval' || type === 'activity_status_update') {
    navigate('ActivityDetails', { activityId: relatedId });
  }
  // Report notifications have no dedicated detail screen yet, so tapping them
  // simply brings the app to the foreground.
}
