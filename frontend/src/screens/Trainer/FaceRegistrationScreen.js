import React from 'react';
import { useAlert } from '../../context/AlertContext';
import api from '../../services/api';
import FaceCapture from '../../components/FaceCapture';
import { REGISTRATION_FIX } from '../../utils/location';

export default function FaceRegistrationScreen({ navigation, route }) {
  const { showAlert } = useAlert();
  const schoolId = route?.params?.schoolId;
  const schoolName = route?.params?.schoolName;

  const submitRegistration = async (video, location) => {
    if (!schoolId) {
      throw new Error('No school selected for registration. Please go back and pick a school.');
    }
    const formData = new FormData();
    formData.append('lat', String(location.lat));
    formData.append('lng', String(location.lng));
    // GPS uncertainty in metres — the server refuses to anchor a geofence to a
    // fix that is too vague to be trusted.
    if (location.accuracy != null) formData.append('accuracy', String(location.accuracy));
    formData.append('schoolId', String(schoolId));
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
      subtitle={schoolName ? `Register your face at ${schoolName}` : 'Register your face for attendance'}
      actionVerb="Register"
      accentColor="#E23744"
      // This capture anchors the geofence for this school permanently, so hold
      // out for a tighter fix than a daily check-in needs.
      locationOptions={REGISTRATION_FIX}
      onSubmit={submitRegistration}
      onSuccess={() => {
        showAlert(
          'Submitted for Approval',
          'Your facial registration has been sent to the admin. You will be notified once it is approved.',
          'success'
        );
        // The registration is in and now waits on an admin — there is nothing
        // further for the user to do. Reset the stack to Home so pressing back
        // can never return them to the camera or drop them onto the pending
        // banner again. (A plain navigate/goBack would leave both behind.)
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }}
      onError={(msg) => showAlert('Error', msg, 'error')}
      onCancel={() => navigation?.goBack()}
    />
  );
}
