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
import CreatorLoginScreen from '../screens/CreatorLoginScreen';
import CreatorAdminPortal from '../screens/CreatorAdminPortal';
import ManageAssetsScreen from '../screens/ManageAssetsScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import EventDetailsScreen from '../screens/EventDetailsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ScreenLoader from '../components/ScreenLoader';

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
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="EventDetails" component={EventDetailsScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          {user.role === 'trainer' && <Stack.Screen name="TrainerPortal" component={TrainerPortal} />}
          {user.role === 'chairman' && <Stack.Screen name="ChairmanPortal" component={ChairmanPortal} />}
          {user.role === 'team_leader' && <Stack.Screen name="TeamLeaderPortal" component={TeamLeaderPortal} />}
          {user.role === 'creator_admin' && (
            <>
              <Stack.Screen name="CreatorAdminPortal" component={CreatorAdminPortal} />
              <Stack.Screen name="ManageAssets" component={ManageAssetsScreen} />
            </>
          )}
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="CreatorLogin" component={CreatorLoginScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </>
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;
