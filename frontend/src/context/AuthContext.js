import React, { createContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import api from '../services/api';

export const AuthContext = createContext();

const INACTIVITY_LIMIT = 15 * 60 * 1000; // 15 minutes

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    loadUser();
    
    // Setup inactivity listener based on AppState
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        startInactivityTimer();
      } else if (nextAppState === 'active') {
        clearInactivityTimer();
      }
    });

    return () => {
      subscription.remove();
      clearInactivityTimer();
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
    }
    return response.data;
  };

  const logout = async () => {
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
