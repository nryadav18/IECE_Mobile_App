import api from './api';

// Thin, typed wrappers over the school-visit endpoints. Screens import these
// instead of sprinkling raw string paths around. The shared axios instance
// attaches the auth token automatically.

// Schools selectable as a visit destination (any active school in the org).
export const getVisitSchools = () =>
  api.get('/school-visits/schools').then((r) => r.data);

export const raiseVisit = ({ schoolId, reason, fromDate, toDate }) =>
  api.post('/school-visits', { schoolId, reason, fromDate, toDate }).then((r) => r.data);

export const getVisits = ({ status, mine } = {}) => {
  const params = {};
  if (status) params.status = status;
  if (mine) params.mine = true;
  return api.get('/school-visits', { params }).then((r) => r.data);
};

export const getVisit = (id) =>
  api.get(`/school-visits/${id}`).then((r) => r.data);

// Approve, optionally adjusting the window in the same action. Pass nothing to
// approve exactly what was requested.
export const approveVisit = (id, { fromDate, toDate } = {}) =>
  api.post(`/school-visits/${id}/approve`, { fromDate, toDate }).then((r) => r.data);

// Admin-only: move the date window before OR after approval. After approval
// this re-drives the check-in pause, the calendar marks and the Visit Report
// prompt on its own — there is nothing else to update.
export const updateVisitDates = (id, { fromDate, toDate }) =>
  api.post(`/school-visits/${id}/dates`, { fromDate, toDate }).then((r) => r.data);

export const rejectVisit = (id, note) =>
  api.post(`/school-visits/${id}/reject`, { note }).then((r) => r.data);

export const cancelVisit = (id) =>
  api.post(`/school-visits/${id}/cancel`).then((r) => r.data);

// Consistent error-message extraction across the feature.
export const schoolVisitError = (e) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong. Please try again.';
