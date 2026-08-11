const { LEADER_ROLES, HEAD_ROLES } = require('../roles');

// ---------------------------------------------------------------------------
// THE PERFORMANCE SCORE
//
// One 0-100 number per person per month, with the working shown. The formula
// lives here and NOWHERE else: the PDF prints these exact weights and targets
// on the page, so what a person reads in their report is provably what was
// computed. Tune the numbers in this file and both the maths and the printed
// explanation move together.
//
// Scoring is ROLE-AWARE, because a trainer cannot raise a school visit and has
// nothing to approve — marking them at zero for features their login does not
// have would be scoring them on somebody else's job. Instead, a dimension that
// does not apply is DROPPED and its weight is redistributed across the ones
// that do (see `normaliseWeights`). Every report prints the weights actually
// used for that person, so two people with different roles can still be
// compared on a single 0-100 scale.
// ---------------------------------------------------------------------------

/** Nominal weights. These are renormalised per person over applicable dimensions. */
const WEIGHTS = {
  attendance: 45,
  activities: 25,
  fieldwork: 20,
  approvals: 10,
  discipline: 10,
};

const DIMENSION_LABELS = {
  attendance: 'Attendance & presence',
  activities: 'Activity contribution',
  fieldwork: 'School visits & reporting',
  approvals: 'Approval responsiveness',
  discipline: 'Check-out & punctuality',
};

/** What "a full month's activity output" looks like. Full marks at or above this. */
const ACTIVITY_TARGET = 8;

/** What "a full month's field work" looks like for a leader / head. */
const FIELDWORK_TARGET = 4;

/** A check-in at or before this IST time counts as on time. 09:30. */
const ON_TIME_MINUTES = 9 * 60 + 30;

/** Approval turnaround: full marks at or under 24h, zero at or over 7 days. */
const TURNAROUND_FULL_HOURS = 24;
const TURNAROUND_ZERO_HOURS = 24 * 7;

const GRADE_BANDS = [
  { min: 90, grade: 'A+', label: 'Outstanding', color: '#0D9488' },
  { min: 80, grade: 'A', label: 'Excellent', color: '#16A34A' },
  { min: 70, grade: 'B', label: 'Good', color: '#65A30D' },
  { min: 60, grade: 'C', label: 'Satisfactory', color: '#D97706' },
  { min: 0, grade: 'D', label: 'Needs Improvement', color: '#DC2626' },
];

const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * Which scoring dimensions apply to this person.
 *
 * Deliberately keyed off the SAME role groupings the rest of the app uses for
 * permissions (roles.js), so "what you are scored on" can never drift away from
 * "what your login can actually do". `hasApprovalDuty` is passed in rather than
 * derived from the role because whether someone had anything to decide is a
 * fact about the month, not about the role.
 */
function applicableDimensions(role, { hasApprovalDuty = false } = {}) {
  const isLeaderOrHead = LEADER_ROLES.includes(role) || HEAD_ROLES.includes(role);
  return {
    attendance: true,
    activities: true,
    // Only leaders and heads may raise a school visit, so only they are scored
    // on field work. A trainer's weight moves to the dimensions they control.
    fieldwork: isLeaderOrHead,
    // Scored only when there was something to approve — a leader with an empty
    // queue is neither rewarded nor punished for it.
    approvals: hasApprovalDuty,
    discipline: true,
  };
}

/** Scale the applicable weights so they sum to exactly 100. */
function normaliseWeights(applicable) {
  const active = Object.keys(WEIGHTS).filter((k) => applicable[k]);
  const total = active.reduce((sum, k) => sum + WEIGHTS[k], 0) || 1;
  const out = {};
  active.forEach((k) => { out[k] = (WEIGHTS[k] / total) * 100; });
  return out;
}

function gradeFor(score) {
  return GRADE_BANDS.find((b) => score >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1];
}

/**
 * Turn a metrics bundle (see metrics.js) into a scored result.
 *
 * @returns {{score:number, grade:object, dimensions:Array, weights:object}}
 *   `dimensions` is render-ready: label, weight, the 0-1 ratio achieved, the
 *   points earned, and a one-line explanation of where the ratio came from.
 */
function scoreMetrics(m) {
  const a = m.attendance;
  const hasApprovalDuty = m.approvals.total > 0;
  const applicable = applicableDimensions(m.user.role, { hasApprovalDuty });
  const weights = normaliseWeights(applicable);

  const dimensions = [];
  const add = (key, ratio, basis) => {
    if (!applicable[key]) return;
    const weight = weights[key];
    dimensions.push({
      key,
      label: DIMENSION_LABELS[key],
      weight,
      ratio: clamp01(ratio),
      points: weight * clamp01(ratio),
      basis,
    });
  };

  // --- Attendance -----------------------------------------------------------
  // Measured against days the person was actually EXPECTED to work: working
  // days less the ones they were formally excused from (approved leave, and
  // days a substitute held their post). A month spent entirely on approved
  // leave therefore scores neutral, not zero — the alternative would punish
  // people for leave the Admin granted them.
  //
  // A school visit counts as presence: it is on-duty time, and the app blocks
  // check-in during one, so there is no attendance row to count instead. A half
  // day (checked in, never checked out) counts half.
  //
  // Days spent covering someone else's post are deliberately NOT added — the
  // person checks in as normal on those days, so they are already inside
  // presentDays. Counting them twice would let real absences hide behind
  // substitute duty. That work is reported on its own line in the PDF.
  const expected = a.expectedDays;
  const credited = a.presentDays + a.partialDays * 0.5 + a.visitDays;
  add(
    'attendance',
    expected > 0 ? credited / expected : 1,
    expected > 0
      ? `${credited.toFixed(1)} credited of ${expected} expected working days`
      : 'No working days expected this month',
  );

  // --- Activities -----------------------------------------------------------
  // Approved work counts in full. Work still awaiting a decision counts half —
  // the person did the job; the delay is their approver's. Being tagged as an
  // organiser on someone else's activity is real participation and counts half.
  // Rejected work counts nothing, so the number cannot be padded.
  const act = m.activities;
  const activityCredit = act.approved + act.pending * 0.5 + act.asOrganizer * 0.5;
  add(
    'activities',
    activityCredit / ACTIVITY_TARGET,
    `${activityCredit.toFixed(1)} credited against a target of ${ACTIVITY_TARGET}`,
  );

  // --- Field work (leaders and heads) ---------------------------------------
  // Completed school visits plus visit reports filed. Both are counted because
  // a visit with no report is unfinished work.
  const fieldCredit = m.schoolVisits.completed + m.visitReports.filed;
  add(
    'fieldwork',
    fieldCredit / FIELDWORK_TARGET,
    `${m.schoolVisits.completed} visit(s) + ${m.visitReports.filed} report(s) against a target of ${FIELDWORK_TARGET}`,
  );

  // --- Approval responsiveness ----------------------------------------------
  // How fast they cleared what landed in their queue. Same-day-to-next-day is
  // full marks; a week or worse is zero.
  const hrs = m.approvals.avgTurnaroundHours;
  let turnRatio = 1;
  if (hrs !== null) {
    if (hrs <= TURNAROUND_FULL_HOURS) turnRatio = 1;
    else if (hrs >= TURNAROUND_ZERO_HOURS) turnRatio = 0;
    else turnRatio = 1 - (hrs - TURNAROUND_FULL_HOURS) / (TURNAROUND_ZERO_HOURS - TURNAROUND_FULL_HOURS);
  }
  add(
    'approvals',
    turnRatio,
    hrs === null
      ? `${m.approvals.total} decision(s) taken`
      : `${m.approvals.total} decision(s), averaging ${hrs.toFixed(1)}h to decide`,
  );

  // --- Discipline -----------------------------------------------------------
  // Two habits, weighted equally: closing the day properly (checking out, not
  // leaving a half-open record) and arriving on time.
  const p = m.punctuality;
  const checkoutRatio = a.checkedInDays > 0 ? a.presentDays / a.checkedInDays : 1;
  const onTimeRatio = p.ratedDays > 0 ? p.onTimeDays / p.ratedDays : 1;
  add(
    'discipline',
    checkoutRatio * 0.5 + onTimeRatio * 0.5,
    `${a.presentDays}/${a.checkedInDays || 0} days closed with a check-out, ${p.onTimeDays}/${p.ratedDays || 0} on time`,
  );

  const score = Math.round(dimensions.reduce((sum, d) => sum + d.points, 0));

  return { score, grade: gradeFor(score), dimensions, weights };
}

module.exports = {
  WEIGHTS,
  DIMENSION_LABELS,
  ACTIVITY_TARGET,
  FIELDWORK_TARGET,
  ON_TIME_MINUTES,
  TURNAROUND_FULL_HOURS,
  TURNAROUND_ZERO_HOURS,
  GRADE_BANDS,
  applicableDimensions,
  normaliseWeights,
  gradeFor,
  scoreMetrics,
};
