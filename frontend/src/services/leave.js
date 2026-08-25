import api from './api';

// Thin, typed wrappers over the leave endpoints. Screens import these instead
// of sprinkling raw string paths around. The shared axios instance attaches the
// auth token automatically.

export const applyLeave = ({ reason, fromDate, toDate, proofs }) =>
  api.post('/leaves', { reason, fromDate, toDate, proofs }).then((r) => r.data);

export const getLeaveRequests = ({ status, mine, emergency } = {}) => {
  const params = {};
  if (status) params.status = status;
  if (mine) params.mine = true;
  // Tri-state on purpose: undefined = everything, true = only emergency leaves
  // the Admin granted, false = only self-applied requests.
  if (emergency !== undefined) params.emergency = String(emergency);
  return api.get('/leaves', { params }).then((r) => r.data);
};

// ---- Emergency leave (Admin only) ----

// Staff the Admin may grant an emergency leave to. Shaped for StaffSearchList.
export const getLeaveStaff = (search = '') =>
  api.get('/leaves/staff', { params: { search, limit: 100 } }).then((r) => r.data);

// Grant an emergency leave. A 409 carrying `conflicts` means the person already
// has something booked; re-call with force: true to go ahead anyway.
export const createEmergencyLeave = ({ applicantId, reason, fromDate, toDate, force }) =>
  api.post('/leaves/emergency', { applicantId, reason, fromDate, toDate, force }).then((r) => r.data);

// Change a leave's window — pending or approved. Same 409/force contract.
export const updateLeaveDates = (id, { fromDate, toDate, force }) =>
  api.post(`/leaves/${id}/dates`, { fromDate, toDate, force }).then((r) => r.data);

// The clash list a 409 came back with, or [] for any other failure.
export const leaveConflicts = (e) => e?.response?.data?.conflicts || [];

// Did this failure mean "there are clashes, confirm to override"?
export const needsConfirmation = (e) => e?.response?.status === 409 && !!e?.response?.data?.requiresConfirmation;

export const getLeaveRequest = (id) =>
  api.get(`/leaves/${id}`).then((r) => r.data);

export const approveLeave = (id) =>
  api.post(`/leaves/${id}/approve`).then((r) => r.data);

export const rejectLeave = (id, note) =>
  api.post(`/leaves/${id}/reject`, { note }).then((r) => r.data);

export const cancelLeave = (id) =>
  api.post(`/leaves/${id}/cancel`).then((r) => r.data);

// Upload proof PHOTOS picked on-device, returns their URLs.
//
// `?scope=leave-proof` is not decoration: the server refuses anything that is
// not an image on this scope, and it checks the actual file bytes rather than
// the type we declare. Proofs are looked at by an approver on a phone, and a
// document there is an attachment that cannot be shown inline.
//
// `files` is an array of { uri, name, mimeType }.
export const uploadProofs = async (files = []) => {
  if (!files.length) return [];
  const formData = new FormData();
  files.forEach((f, i) => {
    formData.append('files', {
      uri: f.uri,
      type: f.mimeType || 'application/octet-stream',
      name: f.name || `proof_${i}`,
    });
  });
  const res = await api.post('/upload/multiple?scope=leave-proof', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.urls || [];
};

// Consistent error-message extraction across the feature.
export const leaveError = (e) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong. Please try again.';
