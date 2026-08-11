import api from './api';

// Facial registrations + activities waiting on THIS user's decision. The server
// scopes both queues to the people this person is actually responsible for, so
// nothing here is ever un-actionable.

export const getPendingFaceApprovals = () =>
  api.get('/approvals/face').then((r) => r.data);

export const getPendingActivityApprovals = () =>
  api.get('/approvals/activities').then((r) => r.data);

/**
 * How a school-less registration is addressed in a URL.
 *
 * An anonymous-location head belongs to no school, so their single registration
 * has no id to put in the path. The server understands this literal in place of
 * one (see utils/anonymousLocation on the backend) — never send `undefined`,
 * which would arrive as the string "undefined" and match nothing.
 */
export const ANONYMOUS_SCHOOL = 'anonymous';

/** The path segment identifying one registration: its school, or 'anonymous'. */
export const faceRegistrationKey = (reg) => {
  const schoolId = reg?.schoolId?._id || reg?.schoolId;
  return schoolId ? String(schoolId) : ANONYMOUS_SCHOOL;
};

/** Approve a person's face registration for one school (or their anonymous one). */
export const approveFaceRegistration = (userId, schoolId) =>
  api.put(`/approvals/face/${userId}/${schoolId || ANONYMOUS_SCHOOL}`, { status: 'approved' }).then((r) => r.data);

/** Reject it. A reason is required and is delivered to the person. */
export const rejectFaceRegistration = (userId, schoolId, reason) =>
  api.put(`/approvals/face/${userId}/${schoolId || ANONYMOUS_SCHOOL}`, { status: 'rejected', reason }).then((r) => r.data);

export const approveActivity = (id) =>
  api.put(`/activities/${id}/status`, { status: 'approved' }).then((r) => r.data);

/** Reject an activity. A remark is required and is delivered to the uploader. */
export const rejectActivity = (id, rejectionRemark) =>
  api.put(`/activities/${id}/status`, { status: 'rejected', rejectionRemark }).then((r) => r.data);

export const approvalError = (e) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Something went wrong. Please try again.';
