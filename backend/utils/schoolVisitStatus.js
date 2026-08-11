const SchoolVisitRequest = require('../models/SchoolVisitRequest');

// Whole-day [start, end] range around a date, server-local time — matching the
// convention used by the attendance / substitution / leave layers.
function dayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * All APPROVED school-visit windows for `userId` — used to paint "On School
 * Visit" days on their attendance calendar (own portal + profile view).
 * Returns lean objects.
 */
async function getApprovedVisitWindows(userId) {
  if (!userId) return [];
  const reqs = await SchoolVisitRequest.find({ applicant: userId, status: 'approved' })
    .populate('school', 'name')
    .sort({ fromDate: -1 });
  return reqs.map((r) => ({
    requestId: r._id,
    fromDate: r.fromDate,
    toDate: r.toDate,
    reason: r.reason,
    schoolName: r.school ? r.school.name : '',
  }));
}

/**
 * The approved visit covering `date` for `userId`, if any. Used by
 * verifyFaceV2 to pause check-in / check-out while the person is off-site.
 */
async function getActiveVisit(userId, date = new Date()) {
  if (!userId) return null;
  const range = dayRange(date);
  return SchoolVisitRequest.findOne({
    applicant: userId,
    status: 'approved',
    fromDate: { $lte: range.end },
    toDate: { $gte: range.start },
  }).populate('school', 'name');
}

/**
 * User ids that are on an approved school visit on `date`. Used by the reminder
 * cron to skip nudging people who are legitimately off-site.
 * @returns {Promise<Set<string>>}
 */
async function getUsersOnVisitSet(date = new Date()) {
  const range = dayRange(date);
  const ids = await SchoolVisitRequest.distinct('applicant', {
    status: 'approved',
    fromDate: { $lte: range.end },
    toDate: { $gte: range.start },
  });
  return new Set(ids.map((id) => String(id)));
}

/**
 * Does `userId` already have a pending/approved visit overlapping the window?
 * Pass `excludeId` to ignore one request (not used today, kept for symmetry).
 */
async function findOverlappingVisit(userId, fromDate, toDate, excludeId = null) {
  const filter = {
    applicant: userId,
    status: { $in: ['pending', 'approved'] },
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return SchoolVisitRequest.findOne(filter);
}

module.exports = {
  dayRange,
  getApprovedVisitWindows,
  getActiveVisit,
  getUsersOnVisitSet,
  findOverlappingVisit,
};
