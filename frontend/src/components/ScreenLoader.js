import React, { useContext } from 'react';
import { View, StyleSheet, Text, Image } from 'react-native';
import { MotiView } from 'moti';
import { ThemeContext } from '../context/ThemeContext';

const ScreenLoader = ({ message = 'Loading...' }) => {
  const { theme } = useContext(ThemeContext);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <MotiView
        from={{ opacity: 0.2, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1.05 }}
        transition={{ type: 'timing', duration: 1000, loop: true }}
      >
        <Image 
          source={require('../../assets/IECE_Logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </MotiView>
      {message ? (
        <Text style={[styles.message, { color: theme.colors.textSecondary }]}>{message}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 120,
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  }
});

export default ScreenLoader;
