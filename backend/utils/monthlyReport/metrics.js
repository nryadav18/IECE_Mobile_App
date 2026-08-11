const Attendance = require('../../models/Attendance');
const Activity = require('../../models/Activity');
const LeaveRequest = require('../../models/LeaveRequest');
const SubstitutionRequest = require('../../models/SubstitutionRequest');
const SchoolVisitRequest = require('../../models/SchoolVisitRequest');
const SchoolHoliday = require('../../models/SchoolHoliday');
const VisitReport = require('../../models/VisitReport');
const ApprovalLog = require('../../models/ApprovalLog');
const Meeting = require('../../models/Meeting');
const Media = require('../../models/Media');
const School = require('../../models/School');
const Team = require('../../models/Team');

const { LEADER_ROLES, HEAD_ROLES } = require('../roles');
const { isAnonymousStaff } = require('../anonymousLocation');
const {
  periodRange, periodDays, dayKeyOf, dayKeysBetween,
  istMinutesOfDay, formatDayKey,
} = require('./period');
const { ON_TIME_MINUTES, scoreMetrics } = require('./score');

// ---------------------------------------------------------------------------
// WHAT ONE PERSON DID IN ONE MONTH.
//
// Everything the report shows is derived here and nowhere else, so the PDF, the
// email summary and the admin leaderboard can never quote different numbers for
// the same person. The renderers are dumb: they lay out what this file returns.
//
// Two conventions run through the whole file, both deliberate:
//
//  1. DAY BUCKETS ARE IST STRING KEYS ('YYYY-MM-DD'). Attendance stores a UTC
//     instant and SchoolHoliday stores an IST day string; converting everything
//     to the string form once, up front, means a late-evening check-in can never
//     land on the wrong day and holiday matching is a plain Set lookup.
//
//  2. OUTPUT IS BUCKETED BY WHEN IT WAS RECORDED (createdAt), not by the date
//     written inside it. An activity dated 28 Aug but uploaded on 2 Sep belongs
//     to September's report. This guarantees every record appears in exactly one
//     month's report — bucketing by activityDate would double-count a record
//     back-dated into a month whose report has already gone out, and silently
//     drop others. The record's own date is still printed in the list.
// ---------------------------------------------------------------------------

const idStr = (v) => String(v && v._id ? v._id : v);

/**
 * Data shared by every person in a run, fetched once instead of per person.
 * A 60-person organisation would otherwise re-read the same holiday calendar
 * sixty times.
 */
async function buildContext(period) {
  const { start, end } = periodRange(period);
  const monthKeys = periodDays(period).map((d) => d.key);

  const [holidays, schools, teams] = await Promise.all([
    SchoolHoliday.find({ date: { $in: monthKeys }, status: 'approved' })
      .select('schoolId date reason')
      .lean(),
    School.find({}).select('name state isDeleted').lean(),
    Team.find({}).select('name').lean(),
  ]);

  // schoolId -> Set of holiday day keys, plus a flat list for the PDF's
  // "which school closed when" table.
  const holidaysBySchool = new Map();
  holidays.forEach((h) => {
    const key = idStr(h.schoolId);
    if (!holidaysBySchool.has(key)) holidaysBySchool.set(key, new Set());
    holidaysBySchool.get(key).add(h.date);
  });

  return {
    period,
    start,
    end,
    monthKeys,
    holidays,
    holidaysBySchool,
    schoolNames: new Map(schools.map((s) => [idStr(s._id), s.name])),
    teamNames: new Map(teams.map((t) => [idStr(t._id), t.name])),
  };
}

/** Records whose date window overlaps the month at all. */
function overlapFilter(start, end) {
  return { fromDate: { $lte: end }, toDate: { $gte: start } };
}

/**
 * Gather and score one person's month.
 *
 * @param {object} user - a lean User doc (needs _id, name, email, role, schoolIds, teamId, teamIds)
 * @param {object} ctx  - from buildContext()
 * @returns {Promise<object>} the metrics bundle consumed by pdf.js / email.js
 */
async function collectMetrics(user, ctx) {
  const { period, start, end } = ctx;
  const uid = user._id;
  const days = periodDays(period);

  // ---- The person's schools -----------------------------------------------
  // schoolIds is authoritative; schoolId is the legacy primary kept in sync by
  // the User pre-save hook. An anonymous-location head belongs to no school at
  // all and legitimately has an empty list.
  const schoolIds = (user.schoolIds && user.schoolIds.length
    ? user.schoolIds
    : (user.schoolId ? [user.schoolId] : [])).map(idStr);

  const schools = schoolIds.map((id) => ({
    id,
    name: ctx.schoolNames.get(id) || 'Unknown school',
  }));

  // ---- Holidays -------------------------------------------------------------
  // A day is a holiday for this person when ANY school they are assigned to is
  // closed on it. Someone posted to several campuses is off when one of them
  // shuts; the per-school detail is still listed underneath so a reader can see
  // exactly which closure excused which day.
  const holidayKeys = new Set();
  const holidayDetail = [];
  schools.forEach((s) => {
    const set = ctx.holidaysBySchool.get(s.id);
    if (!set) return;
    set.forEach((k) => holidayKeys.add(k));
  });
  ctx.holidays
    .filter((h) => schoolIds.includes(idStr(h.schoolId)))
    .forEach((h) => holidayDetail.push({
      date: h.date,
      schoolName: ctx.schoolNames.get(idStr(h.schoolId)) || 'Unknown school',
      reason: h.reason || '',
    }));
  holidayDetail.sort((a, b) => a.date.localeCompare(b.date));

  // ---- Everything that happened in the month --------------------------------
  const [
    attendanceRows, activityRows, leaveRows, substitutionRows,
    visitRows, reportsFiled, reportsReceived, approvalRows, meetingRows, mediaRows,
  ] = await Promise.all([
    Attendance.find({ trainerId: uid, date: { $gte: start, $lte: end } })
      .select('date status checkInTime checkOutTime totalTimeSpent schoolId checkOutSchoolId geofenceBypassed')
      .lean(),

    // Uploaded by them OR tagged them as an organiser — one query, split below.
    Activity.find({
      $or: [{ uploaderId: uid }, { organizers: uid }],
      createdAt: { $gte: start, $lte: end },
    }).select('name schoolId uploaderId organizers activityDate status isStarred createdAt').lean(),

    LeaveRequest.find({ applicant: uid, status: 'approved', ...overlapFilter(start, end) })
      .select('fromDate toDate reason isEmergency').lean(),

    // Both directions in one query: they were replaced, or they did the
    // replacing. The approver may have edited the window, so the effective
    // dates are resolved in JS below.
    SubstitutionRequest.find({
      $or: [{ subject: uid }, { substitute: uid }],
      status: 'approved',
      $and: [{
        $or: [
          overlapFilter(start, end),
          { approvedFromDate: { $lte: end }, approvedToDate: { $gte: start } },
        ],
      }],
    }).select('subject substitute fromDate toDate approvedFromDate approvedToDate reason').lean(),

    SchoolVisitRequest.find({ applicant: uid, status: 'approved', ...overlapFilter(start, end) })
      .select('school fromDate toDate purpose').lean(),

    VisitReport.find({ teamLeaderId: uid, createdAt: { $gte: start, $lte: end } })
      .select('schoolId trainerId dateOfInspection status personMet createdAt').lean(),

    VisitReport.find({ trainerId: uid, createdAt: { $gte: start, $lte: end } })
      .select('schoolId teamLeaderId dateOfInspection status createdAt').lean(),

    ApprovalLog.find({ actorId: uid, decidedAt: { $gte: start, $lte: end } })
      .select('entityType entityId action decidedAt subjectName').lean(),

    Meeting.find({ createdBy: uid, createdAt: { $gte: start, $lte: end } })
      .select('agenda platform recipients createdAt').lean(),

    Media.find({ uploaderId: uid, createdAt: { $gte: start, $lte: end } })
      .select('description status createdAt').lean(),
  ]);

  // ---- Day-by-day roll-up ---------------------------------------------------
  // One pass builds the per-day state used by both the counters and the PDF's
  // colour-coded calendar, so the two can never disagree about a single day.
  const attendanceByDay = new Map();
  attendanceRows.forEach((row) => {
    attendanceByDay.set(dayKeyOf(row.date), row);
  });

  const leaveKeys = new Set();
  leaveRows.forEach((l) => {
    dayKeysBetween(l.fromDate, l.toDate, period).forEach((k) => leaveKeys.add(k));
  });

  const coveredKeys = new Set();      // a substitute held their post
  const substituteKeys = new Set();   // they held someone else's post
  const substitutionDetail = [];
  substitutionRows.forEach((s) => {
    const from = s.approvedFromDate || s.fromDate;
    const to = s.approvedToDate || s.toDate;
    const keys = dayKeysBetween(from, to, period);
    if (keys.length === 0) return;
    const asSubject = idStr(s.subject) === idStr(uid);
    keys.forEach((k) => (asSubject ? coveredKeys : substituteKeys).add(k));
    substitutionDetail.push({
      role: asSubject ? 'covered' : 'substituted',
      from, to, days: keys.length, reason: s.reason || '',
    });
  });

  const visitKeys = new Set();
  const visitDetail = [];
  visitRows.forEach((v) => {
    const keys = dayKeysBetween(v.fromDate, v.toDate, period);
    keys.forEach((k) => visitKeys.add(k));
    visitDetail.push({
      schoolName: ctx.schoolNames.get(idStr(v.school)) || 'Unknown school',
      from: v.fromDate, to: v.toDate, days: keys.length, purpose: v.purpose || '',
    });
  });

  // A day that has not happened yet is not an absence.
  //
  // The cron never meets this case — it always reports a month that has fully
  // ended. The admin's on-demand re-run and the test script can be pointed at
  // the CURRENT month, though, and without this every remaining day of the
  // month would be counted and scored as an unexplained absence, making a
  // mid-month report worse than useless.
  const todayKey = dayKeyOf(new Date());

  // Priority matters: what a day is called when several things are true of it.
  // Actually turning up outranks any excuse — a person who worked on a day they
  // were entitled to skip should see the work, not the excuse.
  const calendar = days.map(({ key, day, weekday }) => {
    const att = attendanceByDay.get(key);
    const isSunday = weekday === 0;
    const isHoliday = holidayKeys.has(key);
    let state;

    if (att) {
      state = att.checkOutTime ? 'present' : 'partial';
    } else if (key > todayKey) {
      state = 'upcoming';
    } else if (isSunday) {
      state = 'sunday';
    } else if (isHoliday) {
      state = 'holiday';
    } else if (visitKeys.has(key)) {
      state = 'visit';
    } else if (leaveKeys.has(key)) {
      state = 'leave';
    } else if (coveredKeys.has(key)) {
      state = 'substituted';
    } else {
      state = 'absent';
    }

    return { key, day, weekday, state, isSunday, isHoliday, attendance: att || null };
  });

  const count = (state) => calendar.filter((c) => c.state === state).length;

  // Working days: the month less Sundays, less days a school closed, and less
  // any day still in the future. A day the person actually worked is a working
  // day even if it was a Sunday or a holiday, so volunteering never shrinks
  // their own denominator.
  const workingDays = calendar.filter(
    (c) => c.state === 'present' || c.state === 'partial'
      || (c.state !== 'upcoming' && !c.isSunday && !c.isHoliday),
  ).length;

  const presentDays = count('present');
  const partialDays = count('partial');
  const leaveDays = count('leave');
  const substitutedDays = count('substituted');
  const visitDays = count('visit');
  const absentDays = count('absent');
  const holidayDays = count('holiday');
  const sundayDays = count('sunday');
  const upcomingDays = count('upcoming');

  // Days worked outside the normal week — Sundays and school holidays they
  // turned up for anyway. Surfaced as a credit, never as a correction.
  const extraDaysWorked = calendar.filter(
    (c) => (c.isSunday || c.isHoliday) && (c.state === 'present' || c.state === 'partial'),
  ).length;

  // Days they covered someone else's post. Read from the substitution windows
  // rather than the calendar because they were normally PRESENT on those days —
  // it is extra duty layered on top of attendance, not a different kind of day.
  const substituteDutyDays = [...substituteKeys].length;

  // What attendance is judged against: working days less the ones they were
  // formally excused from. See score.js for why leave is removed rather than
  // counted as an absence.
  const expectedDays = Math.max(0, workingDays - leaveDays - substitutedDays);

  // ---- Punctuality ----------------------------------------------------------
  const checkInMins = [];
  const checkOutMins = [];
  let totalMinutes = 0;
  let onTimeDays = 0;
  attendanceRows.forEach((row) => {
    const ci = istMinutesOfDay(row.checkInTime);
    if (ci !== null) {
      checkInMins.push(ci);
      if (ci <= ON_TIME_MINUTES) onTimeDays += 1;
    }
    const co = istMinutesOfDay(row.checkOutTime);
    if (co !== null) checkOutMins.push(co);
    totalMinutes += row.totalTimeSpent || 0;
  });
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  // ---- Activities -----------------------------------------------------------
  const uploaded = activityRows.filter((a) => idStr(a.uploaderId) === idStr(uid));
  const asOrganizer = activityRows.filter(
    (a) => idStr(a.uploaderId) !== idStr(uid) && (a.organizers || []).some((o) => idStr(o) === idStr(uid)),
  );
  const byStatus = (s) => uploaded.filter((a) => a.status === s).length;

  const activityList = [...uploaded, ...asOrganizer]
    .sort((a, b) => new Date(a.activityDate) - new Date(b.activityDate))
    .map((a) => ({
      name: a.name,
      schoolName: ctx.schoolNames.get(idStr(a.schoolId)) || '—',
      date: a.activityDate,
      status: a.status,
      isStarred: !!a.isStarred,
      asOrganizer: idStr(a.uploaderId) !== idStr(uid),
    }));

  // ---- Approvals actioned ---------------------------------------------------
  // Turnaround comes free: a Mongo ObjectId embeds the second its document was
  // created, so `entityId.getTimestamp()` is the moment the request was raised
  // with no extra query into nine different collections.
  const decided = approvalRows.filter((r) => ['approved', 'rejected', 'granted', 'auto_approved'].includes(r.action));
  const turnarounds = [];
  decided.forEach((r) => {
    try {
      const raisedAt = r.entityId.getTimestamp();
      const hours = (new Date(r.decidedAt) - raisedAt) / 36e5;
      // Guard against clock skew and back-dated fixtures.
      if (Number.isFinite(hours) && hours >= 0 && hours < 24 * 365) turnarounds.push(hours);
    } catch { /* entityId from a source without a timestamp — skip it */ }
  });
  const approvalsByType = {};
  decided.forEach((r) => { approvalsByType[r.entityType] = (approvalsByType[r.entityType] || 0) + 1; });

  const metrics = {
    period,
    user: {
      id: idStr(uid),
      name: user.name,
      email: user.email,
      role: user.role,
      teamId: user.teamId ? idStr(user.teamId) : null,
      teamName: user.teamId ? (ctx.teamNames.get(idStr(user.teamId)) || null) : null,
      teamNames: (user.teamIds || []).map((t) => ctx.teamNames.get(idStr(t))).filter(Boolean),
      isAnonymous: isAnonymousStaff(user),
      schools,
    },
    attendance: {
      totalDays: days.length,
      workingDays,
      expectedDays,
      presentDays,
      partialDays,
      absentDays,
      leaveDays,
      substitutedDays,
      visitDays,
      holidayDays,
      sundayDays,
      // Non-zero only when a report is generated for a month still in progress
      // (an admin re-run or a test). Always 0 for the monthly cron.
      upcomingDays,
      isPartialMonth: upcomingDays > 0,
      extraDaysWorked,
      substituteDutyDays,
      checkedInDays: presentDays + partialDays,
      // Days worked as a substitute are NOT added here. Covering someone else's
      // post is an ordinary check-in with the geofence waived, so those days are
      // already inside presentDays — adding them again would let a person with
      // real absences show over 100% attendance. Substitute duty is reported on
      // its own line instead, where it reads as the extra work it is.
      rate: expectedDays > 0
        ? ((presentDays + partialDays * 0.5 + visitDays) / expectedDays) * 100
        : 100,
    },
    calendar,
    holidays: { count: holidayDays, detail: holidayDetail },
    punctuality: {
      avgCheckIn: avg(checkInMins),
      avgCheckOut: avg(checkOutMins),
      totalMinutes,
      avgMinutesPerDay: attendanceRows.length ? totalMinutes / attendanceRows.length : 0,
      onTimeDays,
      lateDays: checkInMins.length - onTimeDays,
      ratedDays: checkInMins.length,
    },
    activities: {
      uploaded: uploaded.length,
      approved: byStatus('approved'),
      pending: byStatus('pending'),
      rejected: byStatus('rejected'),
      starred: uploaded.filter((a) => a.isStarred).length,
      asOrganizer: asOrganizer.length,
      list: activityList,
    },
    leave: {
      days: leaveDays,
      requests: leaveRows.length,
      emergency: leaveRows.filter((l) => l.isEmergency).length,
      detail: leaveRows.map((l) => ({
        from: l.fromDate,
        to: l.toDate,
        days: dayKeysBetween(l.fromDate, l.toDate, period).length,
        reason: l.reason,
        isEmergency: !!l.isEmergency,
      })),
    },
    substitution: {
      coveredDays: substitutedDays,
      dutyDays: substituteDutyDays,
      detail: substitutionDetail,
    },
    schoolVisits: {
      completed: visitRows.length,
      days: visitDays,
      detail: visitDetail,
    },
    visitReports: {
      filed: reportsFiled.length,
      approved: reportsFiled.filter((r) => r.status === 'approved').length,
      pending: reportsFiled.filter((r) => r.status === 'pending').length,
      received: reportsReceived.length,
      detail: reportsFiled.map((r) => ({
        schoolName: ctx.schoolNames.get(idStr(r.schoolId)) || '—',
        date: r.dateOfInspection,
        status: r.status,
        personMet: r.personMet || '—',
      })),
    },
    approvals: {
      total: decided.length,
      byType: approvalsByType,
      avgTurnaroundHours: turnarounds.length
        ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
        : null,
    },
    meetings: {
      posted: meetingRows.length,
      detail: meetingRows.map((m) => ({
        agenda: m.agenda,
        platform: m.platform,
        recipients: (m.recipients || []).length,
        date: m.createdAt,
      })),
    },
    media: {
      uploaded: mediaRows.length,
      approved: mediaRows.filter((m) => m.status === 'approved').length,
    },
  };

  metrics.performance = scoreMetrics(metrics);
  return metrics;
}

/**
 * Everyone whose performance is measured.
 *
 * Field staff only — the chairman (school login) is never measured, and the
 * Admin and CEO are recipients of reports rather than subjects of them. This is
 * exactly the FIELD_STAFF set the rest of the app already means by "works under
 * IECE", so nobody with an attendance screen is left unreported.
 */
function reportableRoles() {
  const { FIELD_STAFF } = require('../roles');
  return FIELD_STAFF;
}

/** Convenience: is this person a manager who also receives their team's numbers? */
function isManagerRole(role) {
  return LEADER_ROLES.includes(role) || HEAD_ROLES.includes(role);
}

/** One-line summary used in log output and the test script. */
function summariseMetrics(m) {
  const a = m.attendance;
  return `${m.user.name} (${m.user.role}) — ${a.presentDays}/${a.workingDays} present, `
    + `${m.activities.uploaded} activities, ${m.schoolVisits.completed} visits, `
    + `score ${m.performance.score} (${m.performance.grade.grade})`;
}

module.exports = {
  buildContext,
  collectMetrics,
  reportableRoles,
  isManagerRole,
  summariseMetrics,
  formatDayKey,
};
