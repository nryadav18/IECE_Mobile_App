const SubstitutionRequest = require('../models/SubstitutionRequest');

// Whole-day [start, end] range around a date, in server-local time — matching
// the convention used by the attendance check-in logic.
function dayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// An approved request always has approvedFromDate/approvedToDate set (the
// approver's window, defaulted to the requested dates), so overlap can be
// queried directly on those fields.
function activeWindowMatch(range) {
  return {
    status: 'approved',
    approvedFromDate: { $lte: range.end },
    approvedToDate: { $gte: range.start },
  };
}

/**
 * The approved substitution in which `userId` is the SUBSTITUTE and the window
 * covers `date`. Its presence means the geofence should be bypassed for this
 * user's attendance (they are temporarily deployed elsewhere).
 * @returns {Promise<SubstitutionRequest|null>}
 */
async function getActiveSubstituteAssignment(userId, date = new Date()) {
  if (!userId) return null;
  const range = dayRange(date);
  return SubstitutionRequest.findOne({ substitute: userId, ...activeWindowMatch(range) });
}

/**
 * The approved substitution in which `userId` is the SUBJECT (the person being
 * replaced) and the window covers `date`. Its presence means the user is on
 * substitution leave — attendance is paused for them that day.
 * @returns {Promise<SubstitutionRequest|null>}
 */
async function getActiveSubjectLeave(userId, date = new Date()) {
  if (!userId) return null;
  const range = dayRange(date);
  return SubstitutionRequest.findOne({ subject: userId, ...activeWindowMatch(range) });
}

/**
 * User ids that are on substitution leave (as SUBJECT) on `date`. Used by the
 * reminder cron to skip them.
 * @returns {Promise<Set<string>>}
 */
async function getSubjectsOnLeaveSet(date = new Date()) {
  const range = dayRange(date);
  const ids = await SubstitutionRequest.distinct('subject', activeWindowMatch(range));
  return new Set(ids.map((id) => String(id)));
}

/**
 * All approved substitution windows where `userId` is the SUBJECT — used to
 * paint "On Substitution" leave days on their attendance calendar. Returns lean
 * objects with the substitute's name for display.
 */
async function getSubjectLeaveWindows(userId) {
  if (!userId) return [];
  const reqs = await SubstitutionRequest.find({ subject: userId, status: 'approved' })
    .populate('substitute', 'name role')
    .sort({ approvedFromDate: -1 });
  return reqs.map((r) => ({
    requestId: r._id,
    fromDate: r.approvedFromDate || r.fromDate,
    toDate: r.approvedToDate || r.toDate,
    reason: r.reason,
    substitute: r.substitute ? { name: r.substitute.name, role: r.substitute.role } : null,
  }));
}

module.exports = {
  getActiveSubstituteAssignment,
  getActiveSubjectLeave,
  getSubjectsOnLeaveSet,
  getSubjectLeaveWindows,
};
