import api from './api';

// Create-Admin (dual-OTP) endpoints.

export const initiateAdminCreation = ({ name, email, password }) =>
  api.post('/admin/create-admin/initiate', { name, email, password }).then((r) => r.data);

export const verifyAndCreateAdmin = ({ requestId, requesterOtp, newAdminOtp }) =>
  api.post('/admin/create-admin/verify', { requestId, requesterOtp, newAdminOtp }).then((r) => r.data);

export const resendAdminOtps = (requestId) =>
  api.post('/admin/create-admin/resend', { requestId }).then((r) => r.data);

export const adminCreateError = (e) =>
  e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Something went wrong. Please try again.';
