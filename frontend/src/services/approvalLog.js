import api from './api';

// The Approval Log — every decision taken anywhere in the app, in one place.
// Admin and CEO only; the API rejects everyone else.

/**
 * A page of decisions, newest first.
 * filters: { entityType, action, actorId, subjectId, from, to, search, page, limit }
 */
export const getApprovalLog = (params = {}) =>
  api.get('/approval-log', { params }).then((r) => r.data);

/** Everyone who has ever decided something, with their tallies. Drives the filter chips. */
export const getApprovers = () =>
  api.get('/approval-log/approvers').then((r) => r.data);

/** Headline counts for the last 30 days. */
export const getApprovalSummary = () =>
  api.get('/approval-log/summary').then((r) => r.data);

/** The full decision history of one item, for its detail screen. */
export const getEntityTrail = (entityType, entityId) =>
  api.get(`/approval-log/${entityType}/${entityId}`).then((r) => r.data);

// The nine things that can be decided, with the labels and icons the log uses.
// Kept in the same order the backend enum declares them.
export const ENTITY_TYPES = [
  { key: 'leave', label: 'Leave', icon: 'calendar-outline' },
  { key: 'substitution', label: 'Substitution', icon: 'swap-horizontal-outline' },
  { key: 'school_visit', label: 'School Visit', icon: 'walk-outline' },
  { key: 'face_registration', label: 'Face Scan', icon: 'scan-outline' },
  { key: 'activity', label: 'Activity', icon: 'images-outline' },
  { key: 'holiday', label: 'Holiday', icon: 'sunny-outline' },
  { key: 'visit_report', label: 'Visit Report', icon: 'document-text-outline' },
  { key: 'media', label: 'Gallery', icon: 'image-outline' },
  { key: 'admin_account', label: 'Admin Login', icon: 'person-add-outline' },
];

export const entityMeta = (key) =>
  ENTITY_TYPES.find((t) => t.key === key) || { key, label: key, icon: 'ellipse-outline' };

export const approvalLogError = (e) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Could not load the approval log.';
