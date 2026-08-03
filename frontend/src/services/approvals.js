import api from './api';

// Facial registrations + activities waiting on THIS user's decision. The server
// scopes both queues to the people this person is actually responsible for, so
// nothing here is ever un-actionable.

export const getPendingFaceApprovals = () =>
  api.get('/approvals/face').then((r) => r.data);

export const getPendingActivityApprovals = () =>
  api.get('/approvals/activities').then((r) => r.data);

/** Approve a person's face registration for one school. */
export const approveFaceRegistration = (userId, schoolId) =>
  api.put(`/approvals/face/${userId}/${schoolId}`, { status: 'approved' }).then((r) => r.data);

/** Reject it. A reason is required and is delivered to the person. */
export const rejectFaceRegistration = (userId, schoolId, reason) =>
  api.put(`/approvals/face/${userId}/${schoolId}`, { status: 'rejected', reason }).then((r) => r.data);

export const approveActivity = (id) =>
  api.put(`/activities/${id}/status`, { status: 'approved' }).then((r) => r.data);

/** Reject an activity. A remark is required and is delivered to the uploader. */
export const rejectActivity = (id, rejectionRemark) =>
  api.put(`/activities/${id}/status`, { status: 'rejected', rejectionRemark }).then((r) => r.data);

export const approvalError = (e) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong. Please try again.';
