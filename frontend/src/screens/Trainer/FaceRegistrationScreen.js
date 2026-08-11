import React from 'react';
import { useAlert } from '../../context/AlertContext';
import api from '../../services/api';
import FaceCapture from '../../components/FaceCapture';
import { REGISTRATION_FIX, BEST_EFFORT_FIX } from '../../utils/location';

export default function FaceRegistrationScreen({ navigation, route }) {
  const { showAlert } = useAlert();
  const schoolId = route?.params?.schoolId;
  const schoolName = route?.params?.schoolName;
  // An anonymous-location head registers once, against no school. There is no
  // geofence to anchor, so neither a school nor a GPS fix is a precondition.
  const anonymous = !!route?.params?.anonymous;

  const submitRegistration = async (video, location) => {
    if (!anonymous && !schoolId) {
      throw new Error('No school selected for registration. Please go back and pick a school.');
    }
    const formData = new FormData();
    if (location) {
      formData.append('lat', String(location.lat));
      formData.append('lng', String(location.lng));
      // GPS uncertainty in metres — the server refuses to anchor a geofence to a
      // fix that is too vague to be trusted.
      if (location.accuracy != null) formData.append('accuracy', String(location.accuracy));
    }
    if (schoolId) formData.append('schoolId', String(schoolId));
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
      subtitle={
        anonymous
          ? 'Register your face — you can then check in from anywhere'
          : (schoolName ? `Register your face at ${schoolName}` : 'Register your face for attendance')
      }
      actionVerb="Register"
      accentColor="#E23744"
      // A school registration anchors that school's geofence permanently, so it
      // holds out for a tighter fix than a daily check-in needs. An anonymous
      // registration anchors nothing, so it takes whatever the phone offers —
      // or nothing at all.
      locationOptions={anonymous ? BEST_EFFORT_FIX : REGISTRATION_FIX}
      locationRequired={!anonymous}
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
