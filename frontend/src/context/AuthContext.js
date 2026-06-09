import React, { createContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import api, { setLogoutCallback } from '../services/api';
import { registerForPushNotifications } from '../services/notifications';
import { handleNotificationResponse } from '../services/navigation';

export const AuthContext = createContext();

const INACTIVITY_LIMIT = 15 * 60 * 1000; // 15 minutes

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);
  const notificationListener = useRef(null);
  const responseListener = useRef(null);

  useEffect(() => {
    setLogoutCallback(() => {
      logout();
    });

    loadUser();
    
    // Setup inactivity listener based on AppState
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        startInactivityTimer();
      } else if (nextAppState === 'active') {
        clearInactivityTimer();
      }
    });

    // Listen for incoming notifications while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Foreground notification received:', notification);
    });

    // Route the user to the relevant screen when they tap a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    return () => {
      subscription.remove();
      clearInactivityTimer();
      // SDK 53+: call .remove() on the subscription. removeNotificationSubscription is deprecated.
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  const startInactivityTimer = () => {
    timerRef.current = setTimeout(() => {
      logout();
    }, INACTIVITY_LIMIT);
  };

  const clearInactivityTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const loadUser = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        const response = await api.get('/auth/me');
        setUser(response.data.data);
        // Register push token for already-logged-in user on app launch
        await registerForPushNotifications();
      }
    } catch (error) {
      await AsyncStorage.removeItem('token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    if (response.data.success) {
      await AsyncStorage.setItem('token', response.data.token);
      setUser(response.data.user);
      // Register push token immediately after login
      await registerForPushNotifications();
    }
    return response.data;
  };

  const logout = async () => {
    try {
      await api.put('/auth/push-token', { expoPushToken: null });
    } catch (err) {
      console.log('Failed to clear push token on backend:', err.message);
    }
    await AsyncStorage.removeItem('token');
    setUser(null);
  };

  // Provide a method to manually reset inactivity timer on any user interaction if desired
  const resetTimer = () => {
    clearInactivityTimer();
    // Only restart if the user is active, but AppState active clears it already.
    // If we want touch-based inactivity, we would wrap the root view in a PanResponder.
    // The AppState method covers the "idle in background" requirement effectively.
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, resetTimer }}>
      {children}
    </AuthContext.Provider>
  );
};
