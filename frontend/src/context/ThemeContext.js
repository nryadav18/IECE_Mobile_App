import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ThemeContext = createContext();

const lightTheme = {
  isDark: false,
  colors: {
    primary: '#E23744', // Premium Zomato-like Red
    accent: '#E23744',
    background: '#F9F9F9',
    surface: '#FFFFFF',
    textPrimary: '#1C1C1C',
    textSecondary: '#696969',
    error: '#E23744',
    success: '#27AE60',
    border: '#E8E8E8', // Grey border
    cardBackground: '#FFFFFF',
    placeholder: '#A0A0A0',
    activeTab: '#E23744',
    inactiveTab: '#888888',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  typography: {
    header: { fontSize: 24, fontWeight: 'bold' },
    title: { fontSize: 20, fontWeight: '600' },
    body: { fontSize: 16 },
    caption: { fontSize: 12, color: '#696969' },
  }
};

const darkTheme = {
  isDark: true,
  colors: {
    primary: '#FF4B5C', // Vibrant Red for dark mode contrast
    accent: '#FF4B5C',
    background: '#0F0F0F', // Pure dark background, no blue
    surface: '#1A1A1A',
    textPrimary: '#FFFFFF',
    textSecondary: '#A0A0A0',
    error: '#FF4B5C',
    success: '#2ECC71',
    border: '#f4f2f273', // White border
    cardBackground: '#1C1C1C',
    placeholder: '#555555',
    activeTab: '#FF4B5C',
    inactiveTab: '#777777',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  typography: {
    header: { fontSize: 24, fontWeight: 'bold' },
    title: { fontSize: 20, fontWeight: '600' },
    body: { fontSize: 16 },
    caption: { fontSize: 12, color: '#A0A0A0' },
  }
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem('themeMode');
      if (savedTheme === 'dark') {
        setIsDarkMode(true);
      }
    } catch (e) {
      console.log('Error loading theme:', e);
    }
  };

  const toggleTheme = async () => {
    try {
      const nextMode = !isDarkMode;
      setIsDarkMode(nextMode);
      await AsyncStorage.setItem('themeMode', nextMode ? 'dark' : 'light');
    } catch (e) {
      console.log('Error saving theme:', e);
    }
  };

  const theme = isDarkMode ? darkTheme : lightTheme;

  const themeValue = {
    theme,
    ...theme,
    isDarkMode,
    toggleTheme
  };

  return (
    <ThemeContext.Provider value={themeValue}>
      {children}
    </ThemeContext.Provider>
  );
};
