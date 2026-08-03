import api from './api';

// Thin, typed wrappers over the meeting endpoints.

// Ordered recipient candidates (with isMyTeam flags) for the current creator.
export const getMeetingRecipients = () =>
  api.get('/meetings/recipients').then((r) => r.data);

export const createMeeting = ({ link, agenda, recipientIds }) =>
  api.post('/meetings', { link, agenda, recipientIds }).then((r) => r.data);

export const getMeetings = () =>
  api.get('/meetings').then((r) => r.data);

// One meeting in full — used by the detail screen, including when it is opened
// straight from a notification and only the id is known.
export const getMeeting = (id) =>
  api.get(`/meetings/${id}`).then((r) => r.data);

// Edit an existing meeting. Same payload shape as createMeeting; everyone on
// the meeting (plus Admin + CEO) is re-notified by the server.
export const updateMeeting = (id, { link, agenda, recipientIds }) =>
  api.put(`/meetings/${id}`, { link, agenda, recipientIds }).then((r) => r.data);

export const deleteMeeting = (id) =>
  api.delete(`/meetings/${id}`).then((r) => r.data);

// Consistent error-message extraction across the feature.
export const meetingError = (e) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong. Please try again.';
