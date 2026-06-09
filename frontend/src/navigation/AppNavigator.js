import React, { useContext } from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { AuthContext } from '../context/AuthContext';
import { View, ActivityIndicator } from 'react-native';

// Screens
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import TrainerPortal from '../screens/TrainerPortal';
import ChairmanPortal from '../screens/ChairmanPortal';
import TeamLeaderPortal from '../screens/TeamLeaderPortal';
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

const Stack = createStackNavigator();

const AppNavigator = () => {
  const { user, loading } = useContext(AuthContext);

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

          {user.role === 'trainer' && (
            <>
              <Stack.Screen name="TrainerPortal" component={TrainerPortal} />
              <Stack.Screen name="FaceRegistration" component={FaceRegistrationScreen} />
              <Stack.Screen name="Attendance" component={AttendanceScreen} />
            </>
          )}
          {user.role === 'chairman' && <Stack.Screen name="ChairmanPortal" component={ChairmanPortal} />}
          {user.role === 'team_leader' && (
            <>
              <Stack.Screen name="TeamLeaderPortal" component={TeamLeaderPortal} />
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
            </>
          )}
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </>
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;
