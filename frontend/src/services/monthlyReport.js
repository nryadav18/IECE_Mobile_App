import api from './api';

// Thin wrappers over the monthly performance report endpoints. Admin only —
// every route below is authorised as creator_admin on the server.

/**
 * Who a report can be requested about: the monitored staff (optionally filtered
 * by a search term) plus every team, with member counts.
 *
 * Returns exactly the set the request endpoint accepts, so the picker can never
 * offer a subject that then fails on send.
 */
export const getReportSubjects = (search = '') =>
  api.get('/admin/monthly-report/subjects', { params: { search } }).then((r) => r.data);

/**
 * Generate a report and email it to the SIGNED-IN ADMIN.
 *
 * The recipient is never sent from here — the server takes it from the auth
 * token, so a report cannot be addressed to anyone else.
 *
 * @param {object} o
 * @param {string} o.period       'YYYY-MM'
 * @param {'user'|'team'} o.subjectType
 * @param {string} o.subjectId
 * @param {boolean} [o.includeTeam]  for a leader/head: also cover their people
 */
export const requestReport = ({ period, subjectType, subjectId, includeTeam = true }) =>
  api
    .post('/admin/monthly-report/request', { period, subjectType, subjectId, includeTeam })
    .then((r) => r.data);

/** The delivery log for a month — what was sent, to whom, and what failed. */
export const getReportRuns = (period) =>
  api.get('/admin/monthly-report/runs', { params: { period } }).then((r) => r.data);

/** Pull a readable message out of an axios error from these endpoints. */
export const reportError = (err, fallback = 'Could not generate that report.') =>
  err?.response?.data?.message || err?.message || fallback;
