const LeaveRequest = require('../models/LeaveRequest');

// Whole-day [start, end] range around a date, server-local time — matching the
// convention used by the attendance / substitution layers.
function dayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * All APPROVED leave windows for `userId` — used to paint "On Leave" days on
 * their attendance calendar (own portal + profile view). Returns lean objects.
 */
async function getApprovedLeaveWindows(userId) {
  if (!userId) return [];
  const reqs = await LeaveRequest.find({ applicant: userId, status: 'approved' })
    .sort({ fromDate: -1 });
  return reqs.map((r) => ({
    requestId: r._id,
    fromDate: r.fromDate,
    toDate: r.toDate,
    reason: r.reason,
  }));
}

/**
 * User ids that are on approved leave on `date`. Used by the reminder cron to
 * skip nudging people who are legitimately away.
 * @returns {Promise<Set<string>>}
 */
async function getUsersOnLeaveSet(date = new Date()) {
  const range = dayRange(date);
  const ids = await LeaveRequest.distinct('applicant', {
    status: 'approved',
    fromDate: { $lte: range.end },
    toDate: { $gte: range.start },
  });
  return new Set(ids.map((id) => String(id)));
}

module.exports = { getApprovedLeaveWindows, getUsersOnLeaveSet };
