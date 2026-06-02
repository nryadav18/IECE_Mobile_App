import React, { useContext, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons'; // Assuming Expo vector icons is available

const { width } = Dimensions.get('window');

const CustomAlert = ({ visible, title, message, buttons, type = 'info', onDismiss }) => {
  const { theme } = useContext(ThemeContext);
  const scaleValue = useRef(new Animated.Value(0)).current;
  const opacityValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleValue, {
          toValue: 1,
          useNativeDriver: true,
          tension: 40,
          friction: 5,
        }),
        Animated.timing(opacityValue, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scaleValue, {
          toValue: 0.8,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(opacityValue, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible && opacityValue._value === 0) return null;

  const getIconConfig = () => {
    switch (type) {
      case 'success':
        return { name: 'checkmark-circle', color: theme.colors.success };
      case 'error':
        return { name: 'close-circle', color: theme.colors.error };
      case 'warning':
        return { name: 'warning', color: '#F39C12' }; // Custom warning orange
      case 'info':
      default:
        return { name: 'information-circle', color: theme.colors.primary };
    }
  };

  const iconConfig = getIconConfig();

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    alertContainer: {
      width: width * 0.85,
      maxWidth: 400,
      backgroundColor: theme.colors.surface,
      borderRadius: 20,
      padding: 24,
      alignItems: 'center',
    },
    iconContainer: {
      marginBottom: 16,
      backgroundColor: iconConfig.color + '1A', // 10% opacity for background
      padding: 16,
      borderRadius: 40,
    },
    title: {
      ...theme.typography.title,
      color: theme.colors.textPrimary,
      marginBottom: 8,
      textAlign: 'center',
    },
    message: {
      ...theme.typography.body,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 22,
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      width: '100%',
      gap: 12,
    },
    button: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    primaryButton: {
      backgroundColor: theme.colors.primary,
    },
    secondaryButton: {
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    primaryButtonText: {
      color: '#FFF',
      fontWeight: 'bold',
      fontSize: 16,
    },
    secondaryButtonText: {
      color: theme.colors.textPrimary,
      fontWeight: '600',
      fontSize: 16,
    },
  });

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.alertContainer,
            {
              opacity: opacityValue,
              transform: [{ scale: scaleValue }],
            },
          ]}
        >
          <View style={styles.iconContainer}>
            <Ionicons name={iconConfig.name} size={40} color={iconConfig.color} />
          </View>
          
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.buttonContainer}>
            {buttons && buttons.length > 0 ? (
              buttons.map((btn, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.button,
                    btn.style === 'cancel' || btn.type === 'secondary'
                      ? styles.secondaryButton
                      : styles.primaryButton,
                  ]}
                  onPress={() => {
                    if (btn.onPress) btn.onPress();
                    onDismiss();
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={
                      btn.style === 'cancel' || btn.type === 'secondary'
                        ? styles.secondaryButtonText
                        : styles.primaryButtonText
                    }
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={onDismiss}
                activeOpacity={0.7}
              >
                <Text style={styles.primaryButtonText}>OK</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default CustomAlert;
