import React, { useContext, useEffect } from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { AuthContext } from '../context/AuthContext';
import { View, ActivityIndicator } from 'react-native';
import { flushPendingNotification } from '../services/navigation';

// Screens
import LoginScreen from '../screens/LoginScreen';
import PublicExploreScreen from '../screens/PublicExploreScreen';
import DashboardScreen from '../screens/DashboardScreen';
import TrainerPortal from '../screens/TrainerPortal';
import ChairmanPortal from '../screens/ChairmanPortal';
import TeamLeaderPortal from '../screens/TeamLeaderPortal';
import HeadPortal from '../screens/HeadPortal';
import CreatorAdminPortal from '../screens/CreatorAdminPortal';
import ManageAssetsScreen from '../screens/ManageAssetsScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ActivityDetailsScreen from '../screens/ActivityDetailsScreen';
import UserProfileScreen from '../screens/UserProfileScreen';

import ManageScreen from '../screens/ManageScreen';
import ScreenLoader from '../components/ScreenLoader';

import FaceRegistrationScreen from '../screens/Trainer/FaceRegistrationScreen';
import AttendanceScreen from '../screens/Trainer/AttendanceScreen';
import PendingRegistrationsScreen from '../screens/Admin/PendingRegistrationsScreen';
import CreateAdminScreen from '../screens/Admin/CreateAdminScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import SubstitutionScreen from '../screens/Substitution/SubstitutionScreen';
import RaiseSubstitutionScreen from '../screens/Substitution/RaiseSubstitutionScreen';
import SubstitutionApprovalScreen from '../screens/Substitution/SubstitutionApprovalScreen';
import LeaveScreen from '../screens/Leave/LeaveScreen';
import LeaveApprovalScreen from '../screens/Leave/LeaveApprovalScreen';
import MeetingCornerScreen from '../screens/Meeting/MeetingCornerScreen';
import MeetingDetailScreen from '../screens/Meeting/MeetingDetailScreen';
import CreateMeetingScreen from '../screens/Meeting/CreateMeetingScreen';
import ApprovalsScreen from '../screens/Approvals/ApprovalsScreen';
import FaceRegistrationReviewScreen from '../screens/Approvals/FaceRegistrationReviewScreen';
import { HEAD_ROLES, LEADER_ROLES, ADMIN_ROLES, LEAVE_APPLICANT_ROLES, MEETING_VIEWER_ROLES, MEETING_CREATOR_ROLES } from '../utils/roles';

const Stack = createStackNavigator();

const AppNavigator = () => {
  const { user, loading } = useContext(AuthContext);

  // Once the authenticated stack is mounted, flush any notification tap that
  // arrived before navigation was ready (cold start / mid-authentication).
  useEffect(() => {
    if (user) {
      // Defer to the next tick so the role-specific screens have registered.
      const t = setTimeout(() => flushPendingNotification(), 0);
      return () => clearTimeout(t);
    }
  }, [user]);

  if (loading) {
    return <ScreenLoader message="Authenticating..." />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="Home" component={DashboardScreen} />
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="ActivityDetails" component={ActivityDetailsScreen} />
          <Stack.Screen name="UserProfile" component={UserProfileScreen} />
          {/* Notification inbox — every authenticated user has one. */}
          <Stack.Screen name="Notifications" component={NotificationsScreen} />

          {/* Approvals hub — anyone who can ever BE an approver: (trainee) team
              leaders, heads, Admin and CEO. The API scopes each queue to the
              people that person is actually responsible for. */}
          {[...LEADER_ROLES, ...HEAD_ROLES, ...ADMIN_ROLES].includes(user.role) && (
            <>
              <Stack.Screen name="Approvals" component={ApprovalsScreen} />
              <Stack.Screen name="FaceRegistrationReview" component={FaceRegistrationReviewScreen} />
            </>
          )}

          {/* Substitution feature — raisers (leaders/heads) + approvers (CEO/Admin). */}
          {[...LEADER_ROLES, ...HEAD_ROLES, ...ADMIN_ROLES].includes(user.role) && (
            <>
              <Stack.Screen name="Substitution" component={SubstitutionScreen} />
              <Stack.Screen name="RaiseSubstitution" component={RaiseSubstitutionScreen} />
            </>
          )}
          {/* Only CEO/Admin can open the approval screen. */}
          {ADMIN_ROLES.includes(user.role) && (
            <Stack.Screen name="SubstitutionApproval" component={SubstitutionApprovalScreen} />
          )}

          {/* Leave feature — applicants (all field staff) + the Admin approver.
              CEO is only notified, so has no Leave screen. */}
          {[...LEAVE_APPLICANT_ROLES, 'creator_admin'].includes(user.role) && (
            <Stack.Screen name="Leave" component={LeaveScreen} />
          )}
          {/* Only the Admin reviews leave requests. */}
          {user.role === 'creator_admin' && (
            <Stack.Screen name="LeaveApproval" component={LeaveApprovalScreen} />
          )}

          {/* Meeting Corner — everyone except chairman can view; leaders/heads/
              CEO/Admin can also post links. */}
          {MEETING_VIEWER_ROLES.includes(user.role) && (
            <>
              <Stack.Screen name="MeetingCorner" component={MeetingCornerScreen} />
              {/* Anyone who can see the corner can open a meeting's full detail;
                  the API still checks it was actually shared with them. */}
              <Stack.Screen name="MeetingDetail" component={MeetingDetailScreen} />
            </>
          )}
          {MEETING_CREATOR_ROLES.includes(user.role) && (
            <Stack.Screen name="CreateMeeting" component={CreateMeetingScreen} />
          )}

          {user.role === 'trainer' && (
            <>
              <Stack.Screen name="TrainerPortal" component={TrainerPortal} />
              <Stack.Screen name="FaceRegistration" component={FaceRegistrationScreen} />
              <Stack.Screen name="Attendance" component={AttendanceScreen} />
            </>
          )}
          {user.role === 'chairman' && <Stack.Screen name="ChairmanPortal" component={ChairmanPortal} />}
          {/* Trainee Team Leader has full parity with Team Leader — same portal. */}
          {(user.role === 'team_leader' || user.role === 'trainee_team_leader') && (
            <>
              <Stack.Screen name="TeamLeaderPortal" component={TeamLeaderPortal} />
              <Stack.Screen name="FaceRegistration" component={FaceRegistrationScreen} />
              <Stack.Screen name="Attendance" component={AttendanceScreen} />
            </>
          )}
          {HEAD_ROLES.includes(user.role) && (
            <>
              <Stack.Screen name="HeadPortal" component={HeadPortal} />
              <Stack.Screen name="FaceRegistration" component={FaceRegistrationScreen} />
              <Stack.Screen name="Attendance" component={AttendanceScreen} />
            </>
          )}
          {user.role === 'creator_admin' && (
            <>
              <Stack.Screen name="CreatorAdminPortal" component={CreatorAdminPortal} />
              <Stack.Screen name="ManageAssets" component={ManageAssetsScreen} />
              <Stack.Screen name="ManageScreen" component={ManageScreen} />
              <Stack.Screen name="PendingRegistrations" component={PendingRegistrationsScreen} />
              <Stack.Screen name="CreateAdmin" component={CreateAdminScreen} />
            </>
          )}
          {/* CEO reuses the admin portal (create/manage options are hidden for them). */}
          {user.role === 'ceo' && (
            <Stack.Screen name="CreatorAdminPortal" component={CreatorAdminPortal} />
          )}
        </>
      ) : (
        <>
          {/* Guests land in public, account-free content first. Member sign in
              is one tap away for IECE staff. */}
          <Stack.Screen name="PublicExplore" component={PublicExploreScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </>
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;
