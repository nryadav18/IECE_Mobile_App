const User = require('../models/User');
const School = require('../models/School');
const Team = require('../models/Team');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const SubstitutionRequest = require('../models/SubstitutionRequest');
const SchoolVisitRequest = require('../models/SchoolVisitRequest');
const SchoolHoliday = require('../models/SchoolHoliday');
const Activity = require('../models/Activity');
const VisitReport = require('../models/VisitReport');
const Meeting = require('../models/Meeting');
const Media = require('../models/Media');
const Notification = require('../models/Notification');
const { FIELD_STAFF, HEAD_ROLES, ADMIN_ROLES } = require('../utils/roles');
const { istDateKey, isSunday, IST_OFFSET_MS } = require('../utils/holiday');
const { registerSnapshotBuilder } = require('../utils/realtime');

// ---------------------------------------------------------------------------
// The live Monitoring dashboard: one snapshot of the entire organisation's day.
//
// Everything the Admin/CEO screen renders comes from ONE payload built here.
// That is deliberate — the screen must be able to re-render at one-second
// granularity without lag, so it never issues follow-up requests: the drill-down
// lists, the filters and the per-team/per-school rollups are all derived on the
// client from the `people` array that ships with the snapshot.
//
// Read `utils/realtime.js` for how often this actually runs (short answer: at
// most once a second, and never while the screen is closed).
// ---------------------------------------------------------------------------

// A check-in later than this IST time counts as late. 09:30 matches the window
// the attendance reminder cron already treats as the working morning.
const LATE_AFTER_MIN = 9 * 60 + 30;

// After this IST time the school day is over, so "hasn't marked attendance yet"
// stops being a pending action and becomes a genuine absence. Before it, the
// two are reported separately — see deriveStatus().
const DAY_END_MIN = 18 * 60;

// Someone still showing as checked-in this late almost always forgot to check
// out. Surfaced as an alert rather than silently inflating "still at work".
const FORGOT_CHECKOUT_MIN = 20 * 60;

// An approval waiting longer than this is flagged. Two working days.
const APPROVAL_SLA_HOURS = 48;

// Drill-down lists are rendered from `people`, but approval queues are records,
// not people — those ship as their own compact lists, capped so one neglected
// queue can never bloat a payload that is pushed every second.
const LIST_CAP = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

const idStr = (v) => (v == null ? null : String(v._id ? v._id : v));

/** UTC instants bounding the IST day named by `dateKey` ('YYYY-MM-DD'). */
function istDayRange(dateKey) {
  const start = new Date(new Date(`${dateKey}T00:00:00Z`).getTime() - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS - 1) };
}

/** Minutes elapsed since IST midnight for an instant. */
function istMinutes(d) {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** 'HH:MM' in IST. */
function istClock(d) {
  if (!d) return null;
  const m = istMinutes(d);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Whole-day inclusive overlap between [from,to] and the IST day `dateKey`. */
function coversDay(from, to, dateKey) {
  if (!from || !to) return false;
  const { start, end } = istDayRange(dateKey);
  return new Date(from) <= end && new Date(to) >= start;
}

/** The schools a staff member is assigned to, tolerating the legacy single field. */
function schoolIdsOf(u) {
  const many = (u.schoolIds || []).map(idStr).filter(Boolean);
  if (many.length) return many;
  const one = idStr(u.schoolId);
  return one ? [one] : [];
}

const hoursSince = (d) => (d ? (Date.now() - new Date(d).getTime()) / 3600000 : 0);

/** Compact { id, name, at, ... } rows for an approval queue. */
function queue(records, mapper) {
  const items = records.slice(0, LIST_CAP).map(mapper);
  const oldest = records.reduce((acc, r) => {
    const t = new Date(r.createdAt || r.updatedAt || Date.now()).getTime();
    return acc == null || t < acc ? t : acc;
  }, null);
  return {
    count: records.length,
    overdue: records.filter((r) => hoursSince(r.createdAt) > APPROVAL_SLA_HOURS).length,
    oldestAt: oldest ? new Date(oldest).toISOString() : null,
    items,
    truncated: Math.max(0, records.length - items.length),
  };
}

/**
 * Build the whole snapshot for one IST day.
 *
 * Exported (via registerSnapshotBuilder) so the socket ticker can call it
 * without going through HTTP.
 */
async function buildSnapshot(dateKey = istDateKey()) {
  const { start, end } = istDayRange(dateKey);
  const today = istDateKey();
  const isToday = dateKey === today;
  const nowMin = isToday ? istMinutes(new Date()) : 24 * 60;
  const dayOver = !isToday || nowMin >= DAY_END_MIN;

  const [
    staff,
    schools,
    teams,
    attendance,
    leaves,
    visits,
    substitutions,
    holidaysToday,
    // Approval queues
    pendingLeaves,
    pendingVisits,
    pendingSubs,
    pendingHolidays,
    pendingActivities,
    pendingReports,
    faceCandidates,
    // Output for the day
    activitiesToday,
    reportsToday,
    meetingsToday,
    mediaToday,
    notifsToday,
    notifsReadToday,
  ] = await Promise.all([
    User.find({ role: { $in: FIELD_STAFF } })
      .select('name email role schoolId schoolIds teamId teamIds teamLeaderId anonymousLocation registrationPhotoUrl facialRegistrationStatus faceRegistrations expoPushToken')
      .lean(),
    School.find({ isDeleted: { $ne: true } }).select('name state associationYear').lean(),
    Team.find().select('name').lean(),
    Attendance.find({ date: { $gte: start, $lte: end } })
      .select('trainerId schoolId checkOutSchoolId status checkInTime checkOutTime totalTimeSpent geofenceBypassed verifiedViaFace substitutionRequestId')
      .lean(),
    LeaveRequest.find({ status: 'approved', fromDate: { $lte: end }, toDate: { $gte: start } })
      .select('applicant reason fromDate toDate isEmergency').lean(),
    SchoolVisitRequest.find({ status: 'approved', fromDate: { $lte: end }, toDate: { $gte: start } })
      .select('applicant school reason fromDate toDate').populate('school', 'name').lean(),
    // Effective dates can be either the requested or the Admin-adjusted pair, so
    // the window test happens in JS against the same precedence the model uses.
    SubstitutionRequest.find({ status: 'approved' })
      .select('subject substitute reason fromDate toDate approvedFromDate approvedToDate')
      .populate('substitute', 'name role').lean(),
    SchoolHoliday.find({ date: dateKey, status: 'approved' }).select('schoolId reason').lean(),

    LeaveRequest.find({ status: 'pending' }).select('applicant reason fromDate toDate createdAt')
      .populate('applicant', 'name role').sort({ createdAt: 1 }).lean(),
    SchoolVisitRequest.find({ status: 'pending' }).select('applicant school reason fromDate toDate createdAt')
      .populate('applicant', 'name role').populate('school', 'name').sort({ createdAt: 1 }).lean(),
    SubstitutionRequest.find({ status: 'pending' }).select('subject reason fromDate toDate createdAt')
      .populate('subject', 'name role').sort({ createdAt: 1 }).lean(),
    SchoolHoliday.find({ status: 'pending' }).select('schoolId reason date createdAt')
      .populate('schoolId', 'name').sort({ createdAt: 1 }).lean(),
    Activity.find({ status: 'pending' }).select('name schoolId uploaderId activityDate createdAt')
      .populate('schoolId', 'name').populate('uploaderId', 'name role').sort({ createdAt: 1 }).lean(),
    VisitReport.find({ status: 'pending' }).select('schoolId trainerId teamLeaderId dateOfInspection createdAt')
      .populate('schoolId', 'name').populate('trainerId', 'name').sort({ createdAt: 1 }).lean(),
    User.find({ 'faceRegistrations.status': 'pending' })
      .select('name role faceRegistrations').lean(),

    Activity.find({ createdAt: { $gte: start, $lte: end } }).select('status').lean(),
    VisitReport.find({ createdAt: { $gte: start, $lte: end } }).select('status').lean(),
    Meeting.countDocuments({ createdAt: { $gte: start, $lte: end } }),
    Media.countDocuments({ createdAt: { $gte: start, $lte: end } }),
    Notification.countDocuments({ createdAt: { $gte: start, $lte: end } }),
    Notification.countDocuments({ createdAt: { $gte: start, $lte: end }, read: true }),
  ]);

  // ---- Lookup tables -------------------------------------------------------
  const schoolById = new Map(schools.map((s) => [idStr(s._id), s]));
  const teamNameById = new Map(teams.map((t) => [idStr(t._id), t.name]));
  const holidaySchoolIds = new Set(holidaysToday.map((h) => idStr(h.schoolId)));
  const holidayReasonBySchool = new Map(holidaysToday.map((h) => [idStr(h.schoolId), h.reason]));

  const attByUser = new Map();
  attendance.forEach((a) => attByUser.set(idStr(a.trainerId), a));

  const leaveByUser = new Map();
  leaves.forEach((l) => leaveByUser.set(idStr(l.applicant), l));

  const visitByUser = new Map();
  visits.forEach((v) => visitByUser.set(idStr(v.applicant), v));

  // Both sides of a substitution matter: the subject is excused, the substitute
  // is on deployment. Kept apart so the drill-down can say which one it is.
  const subBySubject = new Map();
  const subBySubstitute = new Map();
  substitutions.forEach((s) => {
    const from = s.approvedFromDate || s.fromDate;
    const to = s.approvedToDate || s.toDate;
    if (!coversDay(from, to, dateKey)) return;
    subBySubject.set(idStr(s.subject), s);
    if (s.substitute) subBySubstitute.set(idStr(s.substitute), s);
  });

  // Which heads oversee which team, so a person can be filtered by head.
  const headsByTeam = new Map();
  staff.filter((u) => HEAD_ROLES.includes(u.role)).forEach((h) => {
    (h.teamIds || []).forEach((t) => {
      const key = idStr(t);
      if (!headsByTeam.has(key)) headsByTeam.set(key, []);
      headsByTeam.get(key).push(idStr(h._id));
    });
  });

  const nameById = new Map(staff.map((u) => [idStr(u._id), u.name]));

  // ---- Per-person status ---------------------------------------------------
  //
  // Precedence matters and is not arbitrary. An approved absence outranks a
  // missing attendance row (they were excused, not missing); an actual check-in
  // outranks a school holiday (they came in anyway and that is real work); and
  // "not marked" only becomes "absent" once the school day is over, so the
  // Admin can tell a pending morning apart from a real no-show.
  const people = staff.map((u) => {
    const id = idStr(u._id);
    const att = attByUser.get(id);
    const leave = leaveByUser.get(id);
    const visit = visitByUser.get(id);
    const subSubject = subBySubject.get(id);
    const subDeploy = subBySubstitute.get(id);
    const mySchools = schoolIdsOf(u);
    const teamId = idStr(u.teamId);

    const allSchoolsOnHoliday =
      mySchools.length > 0 && mySchools.every((s) => holidaySchoolIds.has(s));

    let status;
    let detail = null;

    if (att) {
      // A real attendance row always wins — they physically worked.
      if (att.status === 'Present') status = 'present';
      else if (att.status === 'Partially Present') status = 'partial';
      else if (att.status === 'Absent') status = 'absent';
      else if (att.status === 'Leave') status = 'leave';
      else if (att.status === 'On Substitution') status = 'substitution';
      else status = 'partial';
      if (subDeploy) detail = `Covering for ${nameById.get(idStr(subDeploy.subject)) || 'a colleague'}`;
    } else if (leave) {
      status = 'leave';
      detail = `${leave.isEmergency ? 'Emergency leave' : 'Leave'} — ${leave.reason || ''}`.trim();
    } else if (visit) {
      status = 'school_visit';
      detail = `Inspecting ${visit.school?.name || 'a school'}`;
    } else if (subSubject) {
      status = 'substitution';
      detail = subSubject.substitute
        ? `Replaced by ${subSubject.substitute.name}`
        : 'Substitution approved';
    } else if (allSchoolsOnHoliday) {
      status = 'holiday';
      detail = holidayReasonBySchool.get(mySchools[0]) || 'School holiday';
    } else if (dayOver) {
      status = 'absent';
    } else {
      status = 'not_marked';
    }

    const checkInMin = att?.checkInTime ? istMinutes(att.checkInTime) : null;
    const stillIn = !!(att?.checkInTime && !att.checkOutTime);

    // Minutes worked. A CLOSED day carries its stored total. An OPEN day today
    // is sent as null on purpose: the client derives it from checkInAt.
    //
    // That is not a shortcut — computing it here would make every snapshot
    // differ from the last one for no reason (thirty-odd people each crossing a
    // minute boundary at their own moment), which would defeat the change
    // detection in utils/realtime and push a 75KB payload every second to say
    // nothing. Derived on the client it also ticks continuously instead of only
    // when the server happens to send.
    const workedMin = att
      ? att.checkOutTime ? att.totalTimeSpent || 0 : isToday ? null : 0
      : 0;

    const schoolId = idStr(att?.schoolId) || mySchools[0] || null;

    // Face readiness — someone who cannot check in at all is an operational
    // problem, not an attendance one, so it travels with the person.
    const faceApproved = (u.faceRegistrations || []).some((r) => r.status === 'approved')
      || u.facialRegistrationStatus === 'approved';
    const facePending = (u.faceRegistrations || []).some((r) => r.status === 'pending');

    return {
      id,
      name: u.name,
      email: u.email,
      role: u.role,
      photo: u.registrationPhotoUrl || null,
      anonymous: !!u.anonymousLocation,
      teamId,
      teamName: teamId ? teamNameById.get(teamId) || null : null,
      leaderId: idStr(u.teamLeaderId),
      leaderName: u.teamLeaderId ? nameById.get(idStr(u.teamLeaderId)) || null : null,
      headIds: teamId ? headsByTeam.get(teamId) || [] : [],
      schoolIds: mySchools,
      schoolId,
      schoolName: schoolId ? schoolById.get(schoolId)?.name || null : null,
      state: schoolId ? schoolById.get(schoolId)?.state || null : null,
      checkOutSchoolId: idStr(att?.checkOutSchoolId),
      status,
      detail,
      checkInAt: att?.checkInTime ? new Date(att.checkInTime).toISOString() : null,
      checkOutAt: att?.checkOutTime ? new Date(att.checkOutTime).toISOString() : null,
      checkInClock: istClock(att?.checkInTime),
      checkOutClock: istClock(att?.checkOutTime),
      late: checkInMin != null && checkInMin > LATE_AFTER_MIN,
      checkInMin,
      workedMin,
      stillIn,
      splitDay: !!(att?.checkOutSchoolId && idStr(att.schoolId) !== idStr(att.checkOutSchoolId)),
      geofenceBypassed: !!att?.geofenceBypassed,
      unverifiedFace: !!att && att.verifiedViaFace === false,
      substituting: !!subDeploy,
      faceApproved,
      facePending,
      pushReady: !!u.expoPushToken,
    };
  });

  // ---- Headline counts -----------------------------------------------------
  const counts = {
    total: people.length,
    present: 0, partial: 0, absent: 0, not_marked: 0,
    leave: 0, substitution: 0, school_visit: 0, holiday: 0,
  };
  people.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });

  // "Working" = physically on duty today in any form. The rate is measured
  // against people who were EXPECTED in — excused and holiday staff are removed
  // from the denominator, otherwise a festival looks like mass absenteeism.
  const working = counts.present + counts.partial + counts.substitution + counts.school_visit;
  const expected = counts.total - counts.leave - counts.holiday;
  counts.working = working;
  counts.expected = expected;
  counts.attendanceRate = expected > 0 ? Math.round((working / expected) * 100) : 0;

  // ---- Punctuality / workday shape ----------------------------------------
  const checkedIn = people.filter((p) => p.checkInMin != null);
  const lateOnes = checkedIn.filter((p) => p.late);
  const avgCheckInMin = checkedIn.length
    ? Math.round(checkedIn.reduce((a, p) => a + p.checkInMin, 0) / checkedIn.length)
    : null;
  // Only completed days have a length to average — an open day's total is not
  // known yet and is derived client-side.
  const closedDays = people.filter((p) => p.checkOutAt);
  const avgWorkMin = closedDays.length
    ? Math.round(closedDays.reduce((a, p) => a + (p.workedMin || 0), 0) / closedDays.length)
    : 0;

  // Check-ins bucketed by IST hour — the client draws this as a bar strip.
  const timeline = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  checkedIn.forEach((p) => { timeline[Math.floor(p.checkInMin / 60)].count += 1; });

  const punctuality = {
    onTime: checkedIn.length - lateOnes.length,
    late: lateOnes.length,
    checkedIn: checkedIn.length,
    stillIn: people.filter((p) => p.stillIn).length,
    completed: closedDays.length,
    avgCheckInClock: avgCheckInMin == null ? null
      : `${String(Math.floor(avgCheckInMin / 60)).padStart(2, '0')}:${String(avgCheckInMin % 60).padStart(2, '0')}`,
    avgWorkMin,
    timeline: timeline.filter((t) => t.hour >= 5 && t.hour <= 22),
  };

  // ---- Per-school coverage -------------------------------------------------
  const schoolRows = schools.map((s) => {
    const sid = idStr(s._id);
    // A person counts toward a school if they are assigned to it OR their day
    // touched it (check-in or check-out) — split days belong to both schools,
    // matching Attendance.schoolFilter.
    const assigned = people.filter((p) => p.schoolIds.includes(sid));
    const here = people.filter(
      (p) => p.schoolId === sid || p.checkOutSchoolId === sid || p.schoolIds.includes(sid)
    );
    const tally = { present: 0, partial: 0, absent: 0, not_marked: 0, leave: 0, substitution: 0, school_visit: 0, holiday: 0 };
    here.forEach((p) => { tally[p.status] = (tally[p.status] || 0) + 1; });
    const onDuty = tally.present + tally.partial;
    return {
      id: sid,
      name: s.name,
      state: s.state || null,
      onHoliday: holidaySchoolIds.has(sid),
      holidayReason: holidayReasonBySchool.get(sid) || null,
      assigned: assigned.length,
      onDuty,
      ...tally,
      covered: onDuty > 0,
      staffIds: here.map((p) => p.id),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const schoolSummary = {
    total: schoolRows.length,
    onHoliday: schoolRows.filter((s) => s.onHoliday).length,
    covered: schoolRows.filter((s) => s.covered).length,
    // "Uncovered" excludes holidays — a closed school is not a gap.
    uncovered: schoolRows.filter((s) => !s.covered && !s.onHoliday && s.assigned > 0).length,
    unstaffed: schoolRows.filter((s) => s.assigned === 0).length,
    states: [...new Set(schools.map((s) => s.state).filter(Boolean))].sort(),
  };

  // ---- Team & head rollups -------------------------------------------------
  const rollup = (members) => {
    const t = { present: 0, partial: 0, absent: 0, not_marked: 0, leave: 0, substitution: 0, school_visit: 0, holiday: 0 };
    members.forEach((p) => { t[p.status] = (t[p.status] || 0) + 1; });
    const w = t.present + t.partial + t.substitution + t.school_visit;
    const exp = members.length - t.leave - t.holiday;
    return { ...t, headcount: members.length, working: w, rate: exp > 0 ? Math.round((w / exp) * 100) : 0 };
  };

  const teamRows = teams.map((t) => {
    const tid = idStr(t._id);
    const members = people.filter((p) => p.teamId === tid);
    return { id: tid, name: t.name, ...rollup(members), memberIds: members.map((p) => p.id) };
  }).sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));

  const headRows = staff.filter((u) => HEAD_ROLES.includes(u.role)).map((h) => {
    const hid = idStr(h._id);
    const members = people.filter((p) => p.headIds.includes(hid));
    return {
      id: hid,
      name: h.name,
      role: h.role,
      teamIds: (h.teamIds || []).map(idStr),
      ...rollup(members),
      memberIds: members.map((p) => p.id),
    };
  }).sort((a, b) => b.headcount - a.headcount);

  const roleCounts = {};
  people.forEach((p) => { roleCounts[p.role] = (roleCounts[p.role] || 0) + 1; });

  // ---- Approval queues -----------------------------------------------------
  const pendingFaces = [];
  faceCandidates.forEach((u) => {
    (u.faceRegistrations || []).filter((r) => r.status === 'pending').forEach((r) => {
      pendingFaces.push({
        _id: `${idStr(u._id)}:${idStr(r.schoolId) || 'anonymous'}`,
        createdAt: r.createdAt || u.updatedAt,
        userId: idStr(u._id),
        name: u.name,
        role: u.role,
        schoolId: idStr(r.schoolId),
      });
    });
  });
  pendingFaces.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const approvals = {
    leave: queue(pendingLeaves, (r) => ({
      id: idStr(r._id), title: r.applicant?.name || 'Unknown', role: r.applicant?.role,
      subtitle: r.reason, from: r.fromDate, to: r.toDate, at: r.createdAt,
    })),
    schoolVisit: queue(pendingVisits, (r) => ({
      id: idStr(r._id), title: r.applicant?.name || 'Unknown', role: r.applicant?.role,
      subtitle: `${r.school?.name || 'School'} — ${r.reason || ''}`.trim(), from: r.fromDate, to: r.toDate, at: r.createdAt,
    })),
    substitution: queue(pendingSubs, (r) => ({
      id: idStr(r._id), title: r.subject?.name || 'Unknown', role: r.subject?.role,
      subtitle: r.reason, from: r.fromDate, to: r.toDate, at: r.createdAt,
    })),
    face: queue(pendingFaces, (r) => ({
      id: r._id, title: r.name, role: r.role,
      subtitle: r.schoolId ? schoolById.get(r.schoolId)?.name || 'School' : 'Anonymous location',
      at: r.createdAt,
    })),
    holiday: queue(pendingHolidays, (r) => ({
      id: idStr(r._id), title: r.schoolId?.name || 'School',
      subtitle: r.reason, from: r.date, at: r.createdAt,
    })),
    activity: queue(pendingActivities, (r) => ({
      id: idStr(r._id), title: r.name,
      subtitle: `${r.schoolId?.name || 'School'} · ${r.uploaderId?.name || 'Unknown'}`,
      from: r.activityDate, at: r.createdAt,
    })),
    report: queue(pendingReports, (r) => ({
      id: idStr(r._id), title: r.schoolId?.name || 'School',
      subtitle: `Visit on ${r.trainerId?.name || 'staff'}`, from: r.dateOfInspection, at: r.createdAt,
    })),
  };
  // Summed before the totals are attached, so the totals can never fold
  // themselves back into the sum.
  const queues = Object.values(approvals);
  approvals.totalPending = queues.reduce((a, q) => a + q.count, 0);
  approvals.totalOverdue = queues.reduce((a, q) => a + q.overdue, 0);

  // ---- Output produced today ----------------------------------------------
  const output = {
    activities: {
      total: activitiesToday.length,
      approved: activitiesToday.filter((a) => a.status === 'approved').length,
      pending: activitiesToday.filter((a) => a.status === 'pending').length,
      rejected: activitiesToday.filter((a) => a.status === 'rejected').length,
    },
    reports: {
      total: reportsToday.length,
      approved: reportsToday.filter((r) => r.status === 'approved').length,
      pending: reportsToday.filter((r) => r.status === 'pending').length,
      rejected: reportsToday.filter((r) => r.status === 'rejected').length,
    },
    meetings: meetingsToday,
    banners: mediaToday,
  };

  const engagement = {
    notificationsSent: notifsToday,
    notificationsRead: notifsReadToday,
    readRate: notifsToday > 0 ? Math.round((notifsReadToday / notifsToday) * 100) : 0,
    pushReady: people.filter((p) => p.pushReady).length,
    faceReady: people.filter((p) => p.faceApproved).length,
    faceMissing: people.filter((p) => !p.faceApproved && !p.facePending).length,
  };

  // ---- Attention strip -----------------------------------------------------
  //
  // Each alert carries a `drill` key the client already knows how to open, so
  // tapping an alert lands on the exact list that caused it.
  const alerts = [];
  const push = (a) => { if (a.count > 0) alerts.push(a); };

  push({
    key: 'overdue', severity: 'high', icon: 'alarm-outline',
    title: 'Approvals overdue', subtitle: `Waiting more than ${APPROVAL_SLA_HOURS}h`,
    count: approvals.totalOverdue, drill: { type: 'approvals', overdueOnly: true },
  });
  push({
    key: 'uncovered', severity: 'high', icon: 'business-outline',
    title: 'Schools with nobody present', subtitle: 'Staff assigned, none on duty',
    count: schoolSummary.uncovered, drill: { type: 'schools', filter: 'uncovered' },
  });
  push({
    key: 'absent', severity: 'high', icon: 'close-circle-outline',
    title: dayOver ? 'Absent today' : 'Attendance not marked yet',
    subtitle: dayOver ? 'No attendance and no approved absence' : `Day still running (cut-off ${DAY_END_MIN / 60}:00)`,
    count: dayOver ? counts.absent : counts.not_marked,
    drill: { type: 'people', status: dayOver ? 'absent' : 'not_marked' },
  });
  push({
    key: 'forgot_checkout', severity: 'medium', icon: 'moon-outline',
    title: 'Still checked in late', subtitle: `No check-out after ${FORGOT_CHECKOUT_MIN / 60}:00`,
    count: isToday && nowMin >= FORGOT_CHECKOUT_MIN ? people.filter((p) => p.stillIn).length : 0,
    drill: { type: 'people', flag: 'stillIn' },
  });
  push({
    key: 'late', severity: 'medium', icon: 'time-outline',
    title: 'Late check-ins', subtitle: `After ${Math.floor(LATE_AFTER_MIN / 60)}:${String(LATE_AFTER_MIN % 60).padStart(2, '0')}`,
    count: punctuality.late, drill: { type: 'people', flag: 'late' },
  });
  push({
    key: 'bypass', severity: 'medium', icon: 'navigate-circle-outline',
    title: 'Geofence bypassed', subtitle: 'Substitutes and anonymous heads',
    count: people.filter((p) => p.geofenceBypassed).length, drill: { type: 'people', flag: 'geofenceBypassed' },
  });
  push({
    key: 'unverified', severity: 'high', icon: 'scan-outline',
    title: 'Check-in without face match', subtitle: 'Recorded but unverified',
    count: people.filter((p) => p.unverifiedFace).length, drill: { type: 'people', flag: 'unverifiedFace' },
  });
  push({
    key: 'face_missing', severity: 'low', icon: 'person-circle-outline',
    title: 'No facial registration', subtitle: 'These staff cannot check in at all',
    count: engagement.faceMissing, drill: { type: 'people', flag: 'noFace' },
  });
  const severityRank = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count);

  return {
    dateKey,
    isToday,
    isSunday: isSunday(dateKey),
    dayOver,
    generatedAt: new Date().toISOString(),
    thresholds: { lateAfterMin: LATE_AFTER_MIN, dayEndMin: DAY_END_MIN, slaHours: APPROVAL_SLA_HOURS },
    counts,
    people,
    punctuality,
    schools: schoolRows,
    schoolSummary,
    teams: teamRows,
    heads: headRows,
    roleCounts,
    approvals,
    output,
    engagement,
    alerts,
  };
}

// The socket ticker pushes today's snapshot; a historical day is a frozen
// snapshot and is only ever fetched over HTTP.
registerSnapshotBuilder(() => buildSnapshot());

/**
 * GET /api/monitoring/live?date=YYYY-MM-DD
 *
 * The initial paint and the fallback for clients whose socket cannot connect.
 * Also the only way to read a past day.
 */
exports.getLive = async (req, res) => {
  try {
    const raw = (req.query.date || '').trim();
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : istDateKey();
    // No future days — there is nothing to report on a day that has not begun.
    if (dateKey > istDateKey()) {
      return res.status(400).json({ success: false, error: 'Cannot monitor a future date' });
    }
    const data = await buildSnapshot(dateKey);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('monitoring getLive error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.buildSnapshot = buildSnapshot;
exports.ADMIN_ROLES = ADMIN_ROLES;
