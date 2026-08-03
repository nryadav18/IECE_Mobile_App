import React from 'react';
import { useAlert } from '../../context/AlertContext';
import api from '../../services/api';
import FaceCapture from '../../components/FaceCapture';

export default function AttendanceScreen({ navigation, route }) {
  const intent = route.params?.intent || 'login';
  const schoolId = route.params?.schoolId;
  const schoolName = route.params?.schoolName;
  const isLogout = intent === 'logout';
  const { showAlert } = useAlert();

  const submitAttendance = async (video, location) => {
    if (!schoolId) {
      throw new Error('No school selected. Please go back and choose a school.');
    }
    const formData = new FormData();
    formData.append('lat', String(location.lat));
    formData.append('lng', String(location.lng));
    // GPS uncertainty in metres — recorded with the attendance row and used to
    // reject fixes too vague to place the person anywhere in particular.
    if (location.accuracy != null) formData.append('accuracy', String(location.accuracy));
    formData.append('intent', intent);
    formData.append('schoolId', String(schoolId));
    formData.append('video', {
      uri: video.uri,
      name: 'attendance.mp4',
      type: 'video/mp4',
    });

    const response = await api.post('/attendance/verify-face-v2', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    if (!response.data.success) {
      throw new Error(response.data.message || 'Verification failed.');
    }
    return response.data;
  };

  return (
    <FaceCapture
      title={isLogout ? 'Face Check Out' : 'Face Check In'}
      subtitle={
        schoolName
          ? `${isLogout ? 'Check out' : 'Check in'} at ${schoolName}`
          : (isLogout ? 'Verify your face to check out' : 'Verify your face to check in')
      }
      actionVerb={isLogout ? 'Check Out' : 'Check In'}
      accentColor={isLogout ? '#F44336' : '#4CAF50'}
      onSubmit={submitAttendance}
      onSuccess={(result) => {
        showAlert('Success', result?.message || 'Attendance marked successfully.', 'success');
        navigation?.goBack();
      }}
      onError={(msg) => showAlert('Error', msg, 'error')}
      onCancel={() => navigation?.goBack()}
    />
  );
}
