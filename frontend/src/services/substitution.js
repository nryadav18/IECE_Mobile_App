import api from './api';

// Thin, typed wrappers over the substitution endpoints. Screens import these
// instead of sprinkling raw string paths around. The shared axios instance
// attaches the auth token automatically.

// Staff the caller may raise a request against (role-scoped, searchable).
export const getSubjectStaff = (search = '') =>
  api.get('/substitutions/staff', { params: { search, limit: 100 } }).then((r) => r.data);

// Candidate substitutes (CEO/Admin only) — any field staff except CEO/Admin.
export const getCandidateSubstitutes = (search = '') =>
  api.get('/substitutions/candidates', { params: { search, limit: 100 } }).then((r) => r.data);

export const raiseSubstitution = ({ subjectId, reason, fromDate, toDate }) =>
  api.post('/substitutions', { subjectId, reason, fromDate, toDate }).then((r) => r.data);

export const getSubstitutionRequests = ({ status, mine } = {}) => {
  const params = {};
  if (status) params.status = status;
  if (mine) params.mine = true;
  return api.get('/substitutions', { params }).then((r) => r.data);
};

export const getSubstitutionRequest = (id) =>
  api.get(`/substitutions/${id}`).then((r) => r.data);

export const approveSubstitution = (id, { substituteId, fromDate, toDate }) =>
  api.post(`/substitutions/${id}/approve`, { substituteId, fromDate, toDate }).then((r) => r.data);

export const rejectSubstitution = (id, note) =>
  api.post(`/substitutions/${id}/reject`, { note }).then((r) => r.data);

export const cancelSubstitution = (id) =>
  api.post(`/substitutions/${id}/cancel`).then((r) => r.data);

// Consistent error-message extraction across the feature.
export const substitutionError = (e) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong. Please try again.';
