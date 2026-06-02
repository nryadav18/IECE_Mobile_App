import React from 'react';
import { View, StyleSheet, Modal, Image } from 'react-native';
import { MotiView } from 'moti';

const GlobalLoader = ({ visible = false }) => {
  if (!visible) return null;

  return (
    <Modal transparent={true} visible={visible} animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.loaderContainer}>
          <MotiView
            from={{ opacity: 0.2, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1.05 }}
            transition={{ type: 'timing', duration: 1000, loop: true }}
          >
            <Image 
              source={require('../../assets/IECE_Logo.png')}
              style={{ width: 90, height: 90 }}
              resizeMode="contain"
            />
          </MotiView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)', // Dim background
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  loaderContainer: {
    width: 140,
    height: 140,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  }
});

export default GlobalLoader;
