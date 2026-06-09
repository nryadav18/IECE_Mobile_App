import React, { useState, useEffect, useRef, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAlert } from '../../context/AlertContext';
import { CameraView, Camera } from 'expo-camera';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';

export default function FaceRegistrationScreen({ navigation }) {
  const { showAlert } = useAlert();
  const [hasPermission, setHasPermission] = useState(null);
  const [location, setLocation] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const cameraRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
      const { status: micStatus } = await Camera.requestMicrophonePermissionsAsync();
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      
      setHasPermission(cameraStatus === 'granted' && micStatus === 'granted' && locationStatus === 'granted');

      if (locationStatus === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    })();
  }, []);

  const handleRecord = async () => {
    if (!cameraRef.current) return;
    
    try {
      setIsRecording(true);
      // Record a 3 second video to capture a blink
      const videoRecordPromise = cameraRef.current.recordAsync({ maxDuration: 3 });
      const video = await videoRecordPromise;
      setIsRecording(false);
      submitRegistration(video);
    } catch (err) {
      setIsRecording(false);
      showAlert('Error', 'Failed to record video.', 'error');
    }
  };

  const submitRegistration = async (video) => {
    if (!video || !location) {
      showAlert('Error', 'Missing video or location.', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('lat', String(location.lat));
      formData.append('lng', String(location.lng));
      
      formData.append('video', {
        uri: video.uri,
        name: 'registration.mp4',
        type: 'video/mp4'
      });

      const response = await api.post('/attendance/register-face-v2', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.success) {
        showAlert('Pending', 'Your facial registration is pending admin approval.', 'info');
        navigation?.goBack();
      } else {
        showAlert('Error', response.data.message || 'Registration failed.', 'error');
      }
    } catch (error) {
      console.error(error);
      const msg = error.response?.data?.message || 'Registration failed.';
      showAlert('Error', msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  if (hasPermission === null) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  if (hasPermission === false) return <View style={styles.center}><Text>No access to camera, mic or location</Text></View>;

  return (
    <View style={styles.container}>
      <CameraView 
        style={styles.camera} 
        facing="front"
        mode="video"
        ref={cameraRef}
      >
        <View style={styles.overlay}>
          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>
              Hold steady and blink a few times!
            </Text>
            {isProcessing && <ActivityIndicator size="small" color="#fff" style={{marginTop: 10}}/>}
          </View>
          
          <View style={styles.controls}>
            <TouchableOpacity 
              style={[styles.recordBtn, isRecording && styles.recordingBtn]}
              onPress={handleRecord}
              disabled={isRecording || isProcessing}
            >
              <Ionicons name={isRecording ? "stop" : "videocam"} size={32} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.btnLabel}>{isRecording ? 'Recording (3s)...' : 'Tap to Record'}</Text>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  camera: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  instructionBox: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  instructionText: { color: 'white', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  controls: { alignItems: 'center' },
  recordBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#E23744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)',
  },
  recordingBtn: { backgroundColor: '#FF8888' },
  btnLabel: { color: '#fff', marginTop: 10, fontWeight: 'bold' }
});
