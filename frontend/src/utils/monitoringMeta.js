import { CALENDAR_COLORS } from './calendarColors';

// ---------------------------------------------------------------------------
// The vocabulary of the Monitoring dashboard.
//
// Colours come from CALENDAR_COLORS rather than being re-picked here, so a
// status means the same colour on the dashboard as it does on every attendance
// calendar in the app. If green means "present" on a trainer's calendar, it
// means "present" on the Admin's dashboard too — that consistency is the whole
// point of routing through the canonical map.
// ---------------------------------------------------------------------------

export const STATUS_META = {
  present: {
    key: 'present', label: 'Present', short: 'Present',
    color: CALENDAR_COLORS.present, icon: 'checkmark-circle',
    hint: 'Checked in and checked out — a full day recorded.',
  },
  partial: {
    key: 'partial', label: 'Partially Present', short: 'Partial',
    color: CALENDAR_COLORS.partial, icon: 'time',
    hint: 'Checked in but not checked out yet.',
  },
  absent: {
    key: 'absent', label: 'Absent', short: 'Absent',
    color: CALENDAR_COLORS.absent, icon: 'close-circle',
    hint: 'The school day has ended with no attendance and no approved absence.',
  },
  not_marked: {
    key: 'not_marked', label: 'Not Marked Yet', short: 'Not Marked',
    color: CALENDAR_COLORS.unknown, icon: 'help-circle',
    hint: 'No attendance taken so far — the day is still running.',
  },
  leave: {
    key: 'leave', label: 'On Leave', short: 'Leave',
    color: CALENDAR_COLORS.leave, icon: 'airplane',
    hint: 'Approved personal or emergency leave.',
  },
  substitution: {
    key: 'substitution', label: 'On Substitution', short: 'Substitution',
    color: CALENDAR_COLORS.substitution, icon: 'swap-horizontal',
    hint: 'Being covered by a substitute, or out covering for someone else.',
  },
  school_visit: {
    key: 'school_visit', label: 'On School Visit', short: 'School Visit',
    color: CALENDAR_COLORS.schoolVisit, icon: 'clipboard',
    hint: 'Approved inspection duty — on duty, off-site.',
  },
  holiday: {
    key: 'holiday', label: 'School Holiday', short: 'Holiday',
    color: CALENDAR_COLORS.holiday, icon: 'sunny',
    hint: 'A school this person is assigned to is closed today, or they applied for this closure.',
  },
};

// The order the tiles and the segmented bar are laid out in: what happened,
// then why someone is not here.
export const STATUS_ORDER = [
  'present', 'partial', 'not_marked', 'absent',
  'leave', 'substitution', 'school_visit', 'holiday',
];

export const statusMeta = (key) => STATUS_META[key] || STATUS_META.not_marked;

// Flags a person row can be filtered by from an alert or a chip. Each maps to a
// predicate over the `people` rows the snapshot ships.
export const FLAG_META = {
  late: { label: 'Late Check-ins', icon: 'time-outline', test: (p) => p.late },
  stillIn: { label: 'Still Checked In', icon: 'walk-outline', test: (p) => p.stillIn },
  geofenceBypassed: { label: 'Geofence Bypassed', icon: 'navigate-circle-outline', test: (p) => p.geofenceBypassed },
  unverifiedFace: { label: 'Unverified Check-in', icon: 'scan-outline', test: (p) => p.unverifiedFace },
  noFace: { label: 'No Facial Registration', icon: 'person-circle-outline', test: (p) => !p.faceApproved && !p.facePending },
  splitDay: { label: 'Split Across Schools', icon: 'git-branch-outline', test: (p) => p.splitDay },
  substituting: { label: 'Covering For Someone', icon: 'people-outline', test: (p) => p.substituting },
  anonymous: { label: 'Anonymous Location', icon: 'eye-off-outline', test: (p) => p.anonymous },
};

/**
 * Minutes worked so far by one person.
 *
 * A finished day carries its own total. An open day arrives as null and is
 * measured here from the check-in time, so the figure keeps climbing on its own
 * instead of standing still until the next push — and so the server can send
 * the same snapshot twice without it looking different.
 */
export function workedMinutesOf(p) {
  if (!p) return 0;
  if (p.workedMin != null) return p.workedMin;
  if (!p.checkInAt) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(p.checkInAt).getTime()) / 60000));
}

/** '3h 12m' — used for worked time and approval age alike. */
export function humanMinutes(min) {
  if (min == null) return '—';
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** How long something has been waiting, from an ISO timestamp. */
export function ageSince(iso) {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// The approval queues, in the order the Admin should work through them, with
// where each one lives so a tapped card can navigate straight there.
export const APPROVAL_META = [
  { key: 'leave', label: 'Leave', icon: 'airplane-outline', color: CALENDAR_COLORS.leave, route: { screen: 'LeaveApproval' } },
  { key: 'schoolVisit', label: 'School Visits', icon: 'clipboard-outline', color: CALENDAR_COLORS.schoolVisit, route: { screen: 'SchoolVisitApproval' } },
  { key: 'substitution', label: 'Substitutions', icon: 'swap-horizontal-outline', color: CALENDAR_COLORS.substitution, route: { screen: 'SubstitutionApproval' } },
  { key: 'face', label: 'Face Registrations', icon: 'scan-outline', color: '#6366F1', route: { screen: 'FaceRegistrationReview' } },
  { key: 'activity', label: 'Activities', icon: 'ribbon-outline', color: '#0EA5E9', route: { screen: 'Approvals' } },
  { key: 'report', label: 'Visit Reports', icon: 'document-text-outline', color: '#14B8A6', route: null },
  { key: 'holiday', label: 'School Holidays', icon: 'sunny-outline', color: CALENDAR_COLORS.holiday, route: null },
];

export const SEVERITY_COLOR = {
  high: CALENDAR_COLORS.absent,
  medium: CALENDAR_COLORS.partial,
  low: '#6B7280',
};
