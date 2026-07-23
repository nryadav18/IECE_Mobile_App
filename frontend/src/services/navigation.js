import { createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';

/**
 * App-wide navigation ref. Lets us navigate from outside React components
 * (e.g. from notification handlers in AuthContext). Attach it to the
 * <NavigationContainer ref={navigationRef}> in App.js.
 */
export const navigationRef = createNavigationContainerRef();

// A notification tap can arrive before navigation is ready or before the user's
// role-specific stack has mounted (cold start / still authenticating). When that
// happens we stash the payload and flush it once the app is ready (see
// flushPendingNotification, called from AppNavigator after the user loads).
let pendingData = null;

export function navigate(name, params) {
  if (!navigationRef.isReady()) return false;
  try {
    navigationRef.navigate(name, params);
    return true;
  } catch (e) {
    // Target route not registered yet (e.g. authed stack not mounted).
    return false;
  }
}

/**
 * Maps a push `data` payload to a concrete screen + params. The payload is set
 * by the backend (see utils/pushNotification.js & controllers) and carries
 * `type` and optionally `relatedId`. Notifications are role-targeted, so each
 * type has a single sensible destination.
 */
function resolveTarget(data = {}) {
  const { type, relatedId } = data;

  switch (type) {
    // A substitution request was raised → approvers/heads review it in the
    // substitution hub. The hub validates the tab per role (heads have no
    // Approvals tab and fall back to their first tab).
    case 'substitution_request':
      return { screen: 'Substitution', params: { initialTab: 'approvals' } };

    // A substitution was approved/rejected → informational for a mixed audience
    // (including trainers who have no substitution screen). Land on the inbox.
    case 'substitution_approved':
    case 'substitution_rejected':
      return { screen: 'Notifications' };

    // An activity needs review (admin) or its status changed (uploader).
    case 'activity_approval':
    case 'activity_status_update':
      return relatedId
        ? { screen: 'ActivityDetails', params: { activityId: relatedId } }
        : { screen: 'Home' };

    // A team leader filed a visit report → chairman reviews it in their portal.
    case 'report_approval':
      return { screen: 'ChairmanPortal' };

    // A report was approved/rejected → team leader sees it under "My Reports".
    case 'report_status_update':
      return { screen: 'TeamLeaderPortal', params: { initialTab: 'MyReports' } };

    // An approved report is now visible to the admin → open their Reports tab.
    case 'admin_report':
      return { screen: 'CreatorAdminPortal', params: { initialTab: 'Reports' } };

    // A trainer/TL submitted a face registration → admin approves it.
    case 'face_registration_pending':
      return { screen: 'PendingRegistrations' };

    // "Please check in" / "Please check out" reminders → open the user's
    // Attendance tab so they can act right away. The recipient's role rides
    // along in the payload.
    case 'checkin_reminder':
    case 'checkout_reminder':
      return {
        screen: data.role === 'team_leader' ? 'TeamLeaderPortal' : 'TrainerPortal',
        params: { initialTab: 'Attendance' },
      };

    // A holiday request needs review → admins only. Open the admin portal on its
    // "School Holidays" tab (the approval / pending list).
    case 'holiday_approval':
      return { screen: 'CreatorAdminPortal', params: { initialTab: 'Holidays' } };

    // A holiday request was approved/rejected → open the applicant's portal on
    // its "Apply School Holiday" tab so they see the decision. Applicants are
    // trainers or team leaders.
    case 'holiday_status_update':
      return data.role === 'team_leader'
        ? { screen: 'TeamLeaderPortal', params: { initialTab: 'SchoolHoliday' } }
        : { screen: 'TrainerPortal', params: { initialTab: 'SchoolHoliday' } };

    // Status / informational notifications land on the dashboard.
    case 'face_approved':
    case 'face_removed':
    case 'welcome':
    case 'test':
    case 'general':
      return { screen: 'Home' };

    default:
      // Unknown type: bring the app to the dashboard rather than nowhere.
      return { screen: 'Home' };
  }
}

/**
 * Routes the user to the relevant screen based on a tapped push notification.
 * Only the default tap action is handled.
 */
export function handleNotificationResponse(response) {
  if (!response) return;
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

  const data = response.notification?.request?.content?.data || {};

  // `force_logout` is handled by AuthContext (it signs the device out); it must
  // never drive navigation.
  if (data.type === 'force_logout') return;

  routeFromData(data);
}

function routeFromData(data) {
  const target = resolveTarget(data);
  if (!target) return;

  const ok = navigate(target.screen, target.params);
  if (!ok) {
    // Not ready yet — remember it and flush once the app/stack is ready.
    pendingData = data;
  }
}

/**
 * Re-attempt a deferred notification route. Call this once navigation is ready
 * and the authenticated stack has mounted (i.e. after the user is loaded).
 */
export function flushPendingNotification() {
  if (!pendingData) return;
  if (!navigationRef.isReady()) return;

  const target = resolveTarget(pendingData);
  const ok = navigate(target.screen, target.params);
  if (ok) pendingData = null;
}
