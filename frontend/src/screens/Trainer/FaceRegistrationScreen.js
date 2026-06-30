import React from 'react';
import { useAlert } from '../../context/AlertContext';
import api from '../../services/api';
import FaceCapture from '../../components/FaceCapture';

export default function FaceRegistrationScreen({ navigation, route }) {
  const { showAlert } = useAlert();

  const submitRegistration = async (video, location) => {
    const formData = new FormData();
    formData.append('lat', String(location.lat));
    formData.append('lng', String(location.lng));
    formData.append('video', {
      uri: video.uri,
      name: 'registration.mp4',
      type: 'video/mp4',
    });

    const response = await api.post('/attendance/register-face-v2', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    if (!response.data.success) {
      throw new Error(response.data.message || 'Registration failed.');
    }
    return response.data;
  };

  return (
    <FaceCapture
      title="Face Registration"
      subtitle="Register your face for attendance"
      actionVerb="Register"
      accentColor="#E23744"
      onSubmit={submitRegistration}
      onSuccess={() => {
        showAlert('Pending', 'Your facial registration is pending admin approval.', 'warning');
        // Tell the portal to flip straight to the "Pending Approval" state so the
        // user never sees a stale "Register Face" button while the portal refetches.
        const returnTo = route?.params?.returnTo;
        if (returnTo) {
          navigation.navigate(returnTo, { faceJustRegistered: true, initialTab: 'Attendance' });
        } else {
          navigation?.goBack();
        }
      }}
      onError={(msg) => showAlert('Error', msg, 'error')}
      onCancel={() => navigation?.goBack()}
    />
  );
}
