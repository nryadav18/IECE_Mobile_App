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
const { FIELD_STAFF, HEAD_ROLES, LEADER_ROLES, ADMIN_ROLES } = require('../utils/roles');
const { istDateKey, isSunday, IST_OFFSET_MS } = require('../utils/holiday');
const { registerSnapshotBuilder } = require('../utils/realtime');
const { monitoringScopeFor, personInScope } = require('../utils/monitoringScope');

// ---------------------------------------------------------------------------
// The live Monitoring dashboard: one snapshot of a working day.
//
// It is built in two halves, and the split is the whole design:
//
//   buildBase()  runs every query ONCE and returns the raw organisation — every
//                staff member's day, every school, every pending request.
//   project()    turns that into the payload ONE AUDIENCE receives, filtered to
//                the people that viewer manages and with every rollup, chart,
//                queue and alert recomputed from the filtered set.
//
// That is what lets the Admin, a head and a team leader all watch the same
// second of the same day without the database being asked three times — and,
// more importantly, it is what guarantees a head's payload physically contains
// nobody outside their teams. Scoping is not a client-side filter over an
// org-wide download; the rows never leave the server.
//
// Because every audience runs through the SAME projection, a team's on-duty
// rate on a leader's screen is computed by the identical arithmetic as the
// organisation's rate on the Admin's. Nothing means something different one
// level down.
//
// Everything a screen renders comes from ONE payload — the drill-down lists,
// the filters and the per-team/per-school rollups are all derived on the client
// from the `people` array that ships with it, so the screen can re-render at
// one-second granularity without ever issuing a follow-up request.
//
// Read `utils/realtime.js` for how often this actually runs (short answer: the
// base at most once a second, projected once per distinct audience, and never
// while every dashboard is closed).
// ---------------------------------------------------------------------------

// A check-in later than this IST time counts as late. 09:30 matches the window
// the attendance reminder cron already treats as the working morning.
const LATE_AFTER_MIN = 9 * 60 + 30;

// After this IST time the school day is over, so "hasn't marked attendance yet"
// stops being a pending action and becomes a genuine absence. Before it, the
// two are reported separately — see the status precedence below.
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

const EMPTY_TALLY = () => ({
  present: 0, partial: 0, absent: 0, not_marked: 0,
  leave: 0, substitution: 0, school_visit: 0, holiday: 0,
});

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
  return clockOf(istMinutes(d));
}

/** 'HH:MM' from minutes-since-midnight. */
function clockOf(min) {
  if (min == null) return null;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
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

/**
 * Turn already-mapped, oldest-first queue rows into the compact shape the
 * screen renders.
 *
 * `subjectId` and `schoolId` are routing data used to decide whose queue a
 * record belongs in — they are stripped here so they never reach a client.
 */
function queue(rows) {
  const items = rows.slice(0, LIST_CAP).map(({ subjectId, schoolId, ...rest }) => rest);
  const oldest = rows.reduce((acc, r) => {
    const t = new Date(r.at || Date.now()).getTime();
    return acc == null || t < acc ? t : acc;
  }, null);
  return {
    count: rows.length,
    overdue: rows.filter((r) => hoursSince(r.at) > APPROVAL_SLA_HOURS).length,
    oldestAt: oldest ? new Date(oldest).toISOString() : null,
    items,
    truncated: Math.max(0, rows.length - items.length),
  };
}

/**
 * Where one person stands on this day, and why.
 *
 * PRECEDENCE, and none of it is arbitrary:
 *   1. a real attendance row — they physically worked, whatever else was true
 *   2. approved leave        — excused, not missing
 *   3. approved school visit — on duty, off-site
 *   4. being substituted     — someone else is covering their post
 *   5. a school closure      — see the ANY-school rule in buildBase
 *   6. the clock             — "not marked" until 18:00 IST, "absent" after it,
 *                              so a pending morning is never called a no-show
 *
 * THE ONE RULE THIS FUNCTION EXISTS TO GUARANTEE: a person whose school closure
 * was approved is NEVER reported as absent or not-marked. A closure outranks the
 * clock (5 before 6) and is outranked only by evidence of something better — an
 * actual check-in, or a different approved reason for being away.
 *
 * Pulled out of the row builder and exported so that precedence can be tested
 * on its own. It is the single place that decides whether somebody is called
 * ABSENT, which makes it worth being provably right rather than only
 * observably right.
 *
 * @param {object|null} attendance  today's attendance row, if any
 * @param {object|null} leave       approved leave covering today
 * @param {object|null} visit       approved school visit covering today
 * @param {object|null} replaced    substitution where this person is the subject
 * @param {object|null} covering    substitution where this person is the substitute
 * @param {object|null} closure     approved school holiday catching this person
 * @param {number} schoolCount      how many schools they are assigned to
 * @param {boolean} dayOver         has the school day ended
 * @param {function} nameOf         id -> staff name, for the "covering for" line
 */
function deriveStatus({
  attendance, leave, visit, replaced, covering, closure,
  schoolCount = 0, dayOver = false, nameOf = () => null,
}) {
  if (attendance) {
    // A real attendance row always wins — they physically worked.
    const map = {
      Present: 'present',
      'Partially Present': 'partial',
      Absent: 'absent',
      Leave: 'leave',
      'On Substitution': 'substitution',
    };
    return {
      status: map[attendance.status] || 'partial',
      detail: covering ? `Covering for ${nameOf(idStr(covering.subject)) || 'a colleague'}` : null,
    };
  }

  if (leave) {
    return {
      status: 'leave',
      detail: `${leave.isEmergency ? 'Emergency leave' : 'Leave'} — ${leave.reason || ''}`.trim(),
    };
  }

  if (visit) {
    return { status: 'school_visit', detail: `Inspecting ${visit.school?.name || 'a school'}` };
  }

  if (replaced) {
    return {
      status: 'substitution',
      detail: replaced.substitute ? `Replaced by ${replaced.substitute.name}` : 'Substitution approved',
    };
  }

  if (closure) {
    const why = closure.reason || 'School holiday';
    // Name the campus that shut when the person works at more than one,
    // otherwise "on holiday" reads as a puzzle to whoever is monitoring them.
    return {
      status: 'holiday',
      detail: schoolCount > 1 && closure.schoolName ? `${why} — ${closure.schoolName}` : why,
    };
  }

  return { status: dayOver ? 'absent' : 'not_marked', detail: null };
}

// ===========================================================================
// HALF ONE — the organisation, built once
// ===========================================================================

/**
 * Every fact about one IST day, unfiltered and unaggregated.
 *
 * Nothing here is audience-specific, which is exactly why it can be built once
 * and handed to every projection. Rollups, counts and alerts deliberately do
 * NOT live here: a head's numbers are not a slice of the Admin's numbers, they
 * are the same arithmetic run over a smaller set of people.
 */
async function buildBase(dateKey = istDateKey()) {
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
    SchoolHoliday.find({ date: dateKey, status: 'approved' })
      .select('schoolId reason appliedBy').populate('schoolId', 'name').lean(),

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
      .select('name role faceRegistrations updatedAt').lean(),

    // Owner ids travel with today's output so a scoped view can report what THIS
    // TEAM produced rather than what the organisation produced.
    Activity.find({ createdAt: { $gte: start, $lte: end } }).select('status uploaderId').lean(),
    VisitReport.find({ createdAt: { $gte: start, $lte: end } }).select('status trainerId teamLeaderId').lean(),
    Meeting.find({ createdAt: { $gte: start, $lte: end } }).select('createdBy').lean(),
    Media.countDocuments({ createdAt: { $gte: start, $lte: end } }),
    Notification.find({ createdAt: { $gte: start, $lte: end } }).select('recipient read').lean(),
  ]);

  // ---- Lookup tables -------------------------------------------------------
  const schoolById = new Map(schools.map((s) => [idStr(s._id), s]));
  const teamNameById = new Map(teams.map((t) => [idStr(t._id), t.name]));
  // Today's approved closures, indexed the two ways a person can be caught by
  // one: by a school they are assigned to, and by having raised it themselves.
  const closures = holidaysToday.map((h) => ({
    schoolId: idStr(h.schoolId),
    schoolName: h.schoolId?.name || null,
    reason: (h.reason || '').trim(),
    appliedBy: idStr(h.appliedBy),
  }));
  const holidaySchoolIds = new Set(closures.map((c) => c.schoolId));
  const closureBySchool = new Map(closures.map((c) => [c.schoolId, c]));
  // The applicant is covered even if that school is no longer among their
  // assignments — they asked for the day off and the Admin granted it, and a
  // later re-assignment must not retroactively turn the day into an absence.
  const closureByApplicant = new Map(
    closures.filter((c) => c.appliedBy).map((c) => [c.appliedBy, c])
  );

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

  // And which leaders lead which team. A trainer's teamLeaderId link is
  // optional, so a leader owns their team's unlinked trainers too — the same
  // rule getApprovalSubjectFilter uses, kept in step here.
  const leadersByTeam = new Map();
  staff.filter((u) => LEADER_ROLES.includes(u.role)).forEach((l) => {
    const key = idStr(l.teamId);
    if (!key) return;
    if (!leadersByTeam.has(key)) leadersByTeam.set(key, []);
    leadersByTeam.get(key).push(idStr(l._id));
  });

  const nameById = new Map(staff.map((u) => [idStr(u._id), u.name]));

  // ---- Per-person status ---------------------------------------------------
  //
  // The precedence itself lives in deriveStatus above; this loop only gathers
  // what that decision needs, one person at a time.
  const nameOf = (uid) => nameById.get(uid) || null;

  const people = staff.map((u) => {
    const id = idStr(u._id);
    const att = attByUser.get(id);
    const leave = leaveByUser.get(id);
    const visit = visitByUser.get(id);
    const subSubject = subBySubject.get(id);
    const subDeploy = subBySubstitute.get(id);
    const mySchools = schoolIdsOf(u);
    const teamId = idStr(u.teamId);

    // A day is a holiday for this person when ANY school they are assigned to is
    // closed on it — or when they are the one who applied for the closure.
    //
    // This used to demand that EVERY assigned school be shut, which meant a
    // person posted to several campuses could ask for a holiday, have the Admin
    // approve it, and still be counted ABSENT that evening because a different
    // campus of theirs stayed open. It also disagreed with the monthly
    // performance report, which has always used the ANY rule
    // (utils/monthlyReport/metrics.js) — so the dashboard and the PDF emailed to
    // the CEO could describe the same day differently. One rule now, in both.
    const closedSchoolId = mySchools.find((sid) => holidaySchoolIds.has(sid)) || null;
    const closure = closedSchoolId ? closureBySchool.get(closedSchoolId) : closureByApplicant.get(id);

    const { status, detail } = deriveStatus({
      attendance: att,
      leave,
      visit,
      replaced: subSubject,
      covering: subDeploy,
      closure,
      schoolCount: mySchools.length,
      dayOver,
      nameOf,
    });

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

    // Every leader this person answers to: the explicit link plus the leaders of
    // their team. Shaped like headIds so "tap a supervisor, see their people"
    // works identically at both levels of the hierarchy.
    const leaderIds = u.role === 'trainer'
      ? [...new Set([
        ...(u.teamLeaderId ? [idStr(u.teamLeaderId)] : []),
        ...(teamId ? leadersByTeam.get(teamId) || [] : []),
      ])].filter((l) => l && l !== id)
      : [];

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
      leaderIds,
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

  // ---- Pending records, mapped once and routed by subject ------------------
  //
  // Each row carries the id of the person (or school) it is ABOUT, so a
  // projection can keep the records raised by its own people and drop the rest
  // without re-querying. Oldest first, the order they should be worked in.
  const pendingFaces = [];
  faceCandidates.forEach((u) => {
    (u.faceRegistrations || []).filter((r) => r.status === 'pending').forEach((r) => {
      pendingFaces.push({
        id: `${idStr(u._id)}:${idStr(r.schoolId) || 'anonymous'}`,
        subjectId: idStr(u._id),
        title: u.name,
        role: u.role,
        subtitle: r.schoolId ? schoolById.get(idStr(r.schoolId))?.name || 'School' : 'Anonymous location',
        at: r.createdAt || u.updatedAt,
      });
    });
  });
  pendingFaces.sort((a, b) => new Date(a.at) - new Date(b.at));

  const pending = {
    leave: pendingLeaves.map((r) => ({
      id: idStr(r._id), subjectId: idStr(r.applicant?._id), title: r.applicant?.name || 'Unknown',
      role: r.applicant?.role, subtitle: r.reason, from: r.fromDate, to: r.toDate, at: r.createdAt,
    })),
    schoolVisit: pendingVisits.map((r) => ({
      id: idStr(r._id), subjectId: idStr(r.applicant?._id), title: r.applicant?.name || 'Unknown',
      role: r.applicant?.role, subtitle: `${r.school?.name || 'School'} — ${r.reason || ''}`.trim(),
      from: r.fromDate, to: r.toDate, at: r.createdAt,
    })),
    substitution: pendingSubs.map((r) => ({
      id: idStr(r._id), subjectId: idStr(r.subject?._id), title: r.subject?.name || 'Unknown',
      role: r.subject?.role, subtitle: r.reason, from: r.fromDate, to: r.toDate, at: r.createdAt,
    })),
    face: pendingFaces,
    holiday: pendingHolidays.map((r) => ({
      id: idStr(r._id), schoolId: idStr(r.schoolId?._id), title: r.schoolId?.name || 'School',
      subtitle: r.reason, from: r.date, at: r.createdAt,
    })),
    activity: pendingActivities.map((r) => ({
      id: idStr(r._id), subjectId: idStr(r.uploaderId?._id), title: r.name,
      subtitle: `${r.schoolId?.name || 'School'} · ${r.uploaderId?.name || 'Unknown'}`,
      from: r.activityDate, at: r.createdAt,
    })),
    report: pendingReports.map((r) => ({
      id: idStr(r._id), subjectId: idStr(r.trainerId?._id), title: r.schoolId?.name || 'School',
      subtitle: `Visit on ${r.trainerId?.name || 'staff'}`, from: r.dateOfInspection, at: r.createdAt,
    })),
  };

  return {
    dateKey,
    isToday,
    isSunday: isSunday(dateKey),
    dayOver,
    nowMin,
    generatedAt: new Date().toISOString(),
    people,
    schoolDocs: schools,
    holidaySchoolIds,
    closureBySchool,
    teams: teams.map((t) => ({ id: idStr(t._id), name: t.name })),
    pending,
    output: {
      activities: activitiesToday.map((a) => ({ status: a.status, ownerId: idStr(a.uploaderId) })),
      reports: reportsToday.map((r) => ({ status: r.status, ownerId: idStr(r.trainerId), authorId: idStr(r.teamLeaderId) })),
      meetings: meetingsToday.map((m) => ({ ownerId: idStr(m.createdBy) })),
      banners: mediaToday,
    },
    notifications: notifsToday.map((n) => ({ recipient: idStr(n.recipient), read: !!n.read })),
  };
}

// ===========================================================================
// HALF TWO — one audience's view of it
// ===========================================================================

/** The shared status arithmetic. Every rollup on every screen goes through it. */
function rollup(members) {
  const t = EMPTY_TALLY();
  members.forEach((p) => { t[p.status] = (t[p.status] || 0) + 1; });
  // "Working" = physically on duty today in any form. The rate is measured
  // against people who were EXPECTED in — excused and holiday staff are removed
  // from the denominator, otherwise a festival looks like mass absenteeism.
  const working = t.present + t.partial + t.substitution + t.school_visit;
  const expected = members.length - t.leave - t.holiday;
  return {
    ...t,
    headcount: members.length,
    working,
    expected,
    rate: expected > 0 ? Math.round((working / expected) * 100) : 0,
  };
}

/**
 * Project the organisation onto one audience.
 *
 * `scope` comes from utils/monitoringScope. Everything below is computed from
 * `people` AFTER filtering, never sliced out of an org-wide total — which is
 * both why the numbers are right at every level and why nothing outside the
 * scope is present in the payload to begin with.
 */
function project(base, scope) {
  const isOrg = scope.kind === 'org';
  const people = isOrg ? base.people : base.people.filter((p) => personInScope(scope, p));
  const inScope = new Set(people.map((p) => p.id));

  // Schools this audience has any business seeing: the ones their people are
  // assigned to, plus the ones their people's day actually touched.
  const scopeSchools = new Set();
  people.forEach((p) => {
    p.schoolIds.forEach((s) => scopeSchools.add(s));
    if (p.schoolId) scopeSchools.add(p.schoolId);
    if (p.checkOutSchoolId) scopeSchools.add(p.checkOutSchoolId);
  });

  // ---- Headline counts -----------------------------------------------------
  const head = rollup(people);
  const counts = {
    total: people.length,
    present: head.present, partial: head.partial, absent: head.absent, not_marked: head.not_marked,
    leave: head.leave, substitution: head.substitution, school_visit: head.school_visit, holiday: head.holiday,
    working: head.working,
    expected: head.expected,
    attendanceRate: head.rate,
  };

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
    avgCheckInClock: clockOf(avgCheckInMin),
    avgWorkMin,
    timeline: timeline.filter((t) => t.hour >= 5 && t.hour <= 22),
  };

  // ---- Per-school coverage -------------------------------------------------
  const schoolRows = base.schoolDocs
    .filter((s) => isOrg || scopeSchools.has(idStr(s._id)))
    .map((s) => {
      const sid = idStr(s._id);
      // A person counts toward a school if they are assigned to it OR their day
      // touched it (check-in or check-out) — split days belong to both schools,
      // matching Attendance.schoolFilter.
      const assigned = people.filter((p) => p.schoolIds.includes(sid));
      const here = people.filter(
        (p) => p.schoolId === sid || p.checkOutSchoolId === sid || p.schoolIds.includes(sid)
      );
      const tally = EMPTY_TALLY();
      here.forEach((p) => { tally[p.status] = (tally[p.status] || 0) + 1; });
      const onDuty = tally.present + tally.partial;
      return {
        id: sid,
        name: s.name,
        state: s.state || null,
        onHoliday: base.holidaySchoolIds.has(sid),
        holidayReason: base.closureBySchool.get(sid)?.reason || null,
        assigned: assigned.length,
        onDuty,
        ...tally,
        covered: onDuty > 0,
        staffIds: here.map((p) => p.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const schoolSummary = {
    total: schoolRows.length,
    onHoliday: schoolRows.filter((s) => s.onHoliday).length,
    covered: schoolRows.filter((s) => s.covered).length,
    // "Uncovered" excludes holidays — a closed school is not a gap.
    uncovered: schoolRows.filter((s) => !s.covered && !s.onHoliday && s.assigned > 0).length,
    unstaffed: schoolRows.filter((s) => s.assigned === 0).length,
    states: [...new Set(schoolRows.map((s) => s.state).filter(Boolean))].sort(),
  };

  // ---- Team / head / leader rollups ---------------------------------------
  //
  // Every tier the audience actually contains gets its own breakdown, and a
  // tier they do not contain ships empty rather than as a card full of zeroes:
  // the Admin gets heads AND leaders, a head gets the leaders inside their
  // teams, and a leader gets neither, because everyone under them is a trainer.
  const teamRows = base.teams
    .map((t) => {
      const members = people.filter((p) => p.teamId === t.id);
      return { id: t.id, name: t.name, ...rollup(members), memberIds: members.map((p) => p.id) };
    })
    .filter((t) => isOrg || t.headcount > 0)
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));

  const supervisorRows = (roles, linkField) => base.people
    .filter((u) => roles.includes(u.role))
    .map((u) => {
      const members = people.filter((p) => (p[linkField] || []).includes(u.id));
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        ...rollup(members),
        memberIds: members.map((p) => p.id),
      };
    })
    .filter((r) => r.headcount > 0)
    .sort((a, b) => b.headcount - a.headcount);

  // A head is never one of their own rows, so the head breakdown is the Admin's
  // alone; the leader breakdown is useful to the Admin and to a head alike.
  const headRows = isOrg ? supervisorRows(HEAD_ROLES, 'headIds') : [];
  const leaderRows = scope.kind === 'leader' ? [] : supervisorRows(LEADER_ROLES, 'leaderIds');

  const roleCounts = {};
  people.forEach((p) => { roleCounts[p.role] = (roleCounts[p.role] || 0) + 1; });

  // ---- Approval queues -----------------------------------------------------
  //
  // Scoped by WHO A RECORD IS ABOUT, not by who may decide it. A head cannot
  // approve their trainer's leave — the Admin does — but they are the one who
  // has to cover the gap, so a request raised by their own people belongs on
  // their board. Requests raised by anybody else never reach them at all.
  const mine = (rows) => (isOrg ? rows : rows.filter((r) => inScope.has(r.subjectId)));
  const approvals = {
    leave: queue(mine(base.pending.leave)),
    schoolVisit: queue(mine(base.pending.schoolVisit)),
    substitution: queue(mine(base.pending.substitution)),
    face: queue(mine(base.pending.face)),
    // A holiday is raised for a SCHOOL, not a person: it belongs to whoever has
    // staff standing in that school.
    holiday: queue(isOrg ? base.pending.holiday : base.pending.holiday.filter((r) => scopeSchools.has(r.schoolId))),
    activity: queue(mine(base.pending.activity)),
    report: queue(mine(base.pending.report)),
  };
  // Summed before the totals are attached, so the totals can never fold
  // themselves back into the sum.
  const queues = Object.values(approvals);
  approvals.totalPending = queues.reduce((a, q) => a + q.count, 0);
  approvals.totalOverdue = queues.reduce((a, q) => a + q.overdue, 0);

  // ---- Output produced today ----------------------------------------------
  const owned = (rows) => (isOrg ? rows : rows.filter((r) => inScope.has(r.ownerId)));
  const tallyStatus = (rows) => ({
    total: rows.length,
    approved: rows.filter((r) => r.status === 'approved').length,
    pending: rows.filter((r) => r.status === 'pending').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  });

  const output = {
    activities: tallyStatus(owned(base.output.activities)),
    // A visit report belongs to both ends of it: the person inspected and the
    // supervisor who filed it.
    reports: tallyStatus(isOrg
      ? base.output.reports
      : base.output.reports.filter((r) => inScope.has(r.ownerId) || inScope.has(r.authorId))),
    meetings: owned(base.output.meetings).length,
    // Banners are organisation-wide announcements posted by the Admin; there is
    // no such thing as "this team's banners", so a scoped view says nothing
    // rather than always saying zero. The client hides a null tile.
    banners: isOrg ? base.output.banners : null,
  };

  const notifs = isOrg
    ? base.notifications
    : base.notifications.filter((n) => inScope.has(n.recipient));
  const notifsRead = notifs.filter((n) => n.read).length;

  const engagement = {
    notificationsSent: notifs.length,
    notificationsRead: notifsRead,
    readRate: notifs.length > 0 ? Math.round((notifsRead / notifs.length) * 100) : 0,
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
    title: base.dayOver ? 'Absent today' : 'Attendance not marked yet',
    subtitle: base.dayOver ? 'No attendance and no approved absence' : `Day still running (cut-off ${DAY_END_MIN / 60}:00)`,
    count: base.dayOver ? counts.absent : counts.not_marked,
    drill: { type: 'people', status: base.dayOver ? 'absent' : 'not_marked' },
  });
  push({
    key: 'forgot_checkout', severity: 'medium', icon: 'moon-outline',
    title: 'Still checked in late', subtitle: `No check-out after ${FORGOT_CHECKOUT_MIN / 60}:00`,
    count: base.isToday && base.nowMin >= FORGOT_CHECKOUT_MIN ? punctuality.stillIn : 0,
    drill: { type: 'people', flag: 'stillIn' },
  });
  push({
    key: 'late', severity: 'medium', icon: 'time-outline',
    title: 'Late check-ins', subtitle: `After ${clockOf(LATE_AFTER_MIN)}`,
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
    dateKey: base.dateKey,
    isToday: base.isToday,
    isSunday: base.isSunday,
    dayOver: base.dayOver,
    generatedAt: base.generatedAt,
    // What this viewer is looking at. The screen reads it to title itself
    // honestly — "Whole organisation" is a claim only the Admin's payload makes.
    scope: {
      kind: scope.kind,
      label: scope.label,
      orgWide: isOrg,
      // Whether this audience contains the tier below them at all, so the
      // screen can drop a section instead of rendering an empty card.
      hasHeads: headRows.length > 0,
      hasLeaders: leaderRows.length > 0,
    },
    thresholds: { lateAfterMin: LATE_AFTER_MIN, dayEndMin: DAY_END_MIN, slaHours: APPROVAL_SLA_HOURS },
    counts,
    people,
    punctuality,
    schools: schoolRows,
    schoolSummary,
    teams: teamRows,
    heads: headRows,
    leaders: leaderRows,
    roleCounts,
    approvals,
    output,
    engagement,
    alerts,
  };
}

/** Build and project in one go — the HTTP path and any one-off caller. */
async function buildSnapshot(dateKey, scope) {
  return project(await buildBase(dateKey), scope);
}

// The socket ticker builds the organisation once per tick and projects it for
// each distinct audience watching; a historical day is a frozen snapshot and is
// only ever fetched over HTTP.
registerSnapshotBuilder(buildBase, project);

/**
 * GET /api/monitoring/live?date=YYYY-MM-DD
 *
 * The initial paint and the fallback for clients whose socket cannot connect.
 * Also the only way to read a past day.
 */
exports.getLive = async (req, res) => {
  try {
    const scope = monitoringScopeFor(req.user);
    if (!scope) {
      return res.status(403).json({ success: false, error: 'You do not oversee anyone to monitor' });
    }
    const raw = (req.query.date || '').trim();
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : istDateKey();
    // No future days — there is nothing to report on a day that has not begun.
    if (dateKey > istDateKey()) {
      return res.status(400).json({ success: false, error: 'Cannot monitor a future date' });
    }
    const data = await buildSnapshot(dateKey, scope);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('monitoring getLive error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deriveStatus = deriveStatus;
exports.buildBase = buildBase;
exports.project = project;
exports.buildSnapshot = buildSnapshot;
exports.ADMIN_ROLES = ADMIN_ROLES;
