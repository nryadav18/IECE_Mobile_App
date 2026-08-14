import React from 'react';
import { LogBox, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from './src/context/AuthContext';
import { BadgeProvider } from './src/context/BadgeContext';
import { ThemeProvider } from './src/context/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AlertProvider } from './src/context/AlertContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import UpdateGate from './src/components/UpdateGate';
import { navigationRef, handleNotificationResponse } from './src/services/navigation';
import WebLayout from './src/components/WebLayout';

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated and will be removed in a future release. Please use 'react-native-safe-area-context' instead.",
  "InteractionManager has been deprecated and will be removed in a future release. Please refactor long tasks into smaller ones, and use 'requestIdleCallback' instead."
]);

export default function App() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
        <ThemeProvider>
          <WebLayout>
            <AlertProvider>
              <AuthProvider>
                <BadgeProvider>
                  <NavigationContainer
                    ref={navigationRef}
                    onReady={() => {
                      // Handle a notification that cold-started the app from a tap.
                      if (Platform.OS !== 'web') {
                        Notifications.getLastNotificationResponseAsync().then(handleNotificationResponse).catch(() => {});
                      }
                    }}
                  >
                    <AppNavigator />
                  </NavigationContainer>
                  {/* Sits above the navigator so the update prompt reaches the
                      login screen too — a build too old to sign in is exactly
                      the one that needs updating. */}
                  <UpdateGate />
                </BadgeProvider>
              </AuthProvider>
            </AlertProvider>
          </WebLayout>
        </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
