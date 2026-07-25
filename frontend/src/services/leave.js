import api from './api';

// Thin, typed wrappers over the leave endpoints. Screens import these instead
// of sprinkling raw string paths around. The shared axios instance attaches the
// auth token automatically.

export const applyLeave = ({ reason, fromDate, toDate, proofs }) =>
  api.post('/leaves', { reason, fromDate, toDate, proofs }).then((r) => r.data);

export const getLeaveRequests = ({ status, mine } = {}) => {
  const params = {};
  if (status) params.status = status;
  if (mine) params.mine = true;
  return api.get('/leaves', { params }).then((r) => r.data);
};

export const getLeaveRequest = (id) =>
  api.get(`/leaves/${id}`).then((r) => r.data);

export const approveLeave = (id) =>
  api.post(`/leaves/${id}/approve`).then((r) => r.data);

export const rejectLeave = (id, note) =>
  api.post(`/leaves/${id}/reject`, { note }).then((r) => r.data);

export const cancelLeave = (id) =>
  api.post(`/leaves/${id}/cancel`).then((r) => r.data);

// Upload proof files (photos / PDFs) picked on-device, returns their URLs.
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
  const res = await api.post('/upload/multiple', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.urls || [];
};

// Consistent error-message extraction across the feature.
export const leaveError = (e) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong. Please try again.';
