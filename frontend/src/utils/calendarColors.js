// SINGLE SOURCE OF TRUTH for attendance-calendar colours.
//
// Every calendar in the app (Trainer portal, Team-Leader portal, and the profile
// view any authority opens) imports from here, so a given status ALWAYS shows the
// same colour regardless of who is logged in. Change a colour here and it changes
// everywhere at once. The bottom-of-calendar legend (CalendarLegend) is built from
// the same map, so the guide can never drift from what's painted.

import { toYMD } from './dates';
import { SUBSTITUTION_MARK_COLOR, buildSubstitutionMarks } from './substitutionMarks';
import { LEAVE_MARK_COLOR, buildLeaveMarks } from './leaveMarks';
import { HOLIDAY_APPROVED_COLOR, buildHolidayMarks, dayKey } from './holiday';

export const CALENDAR_COLORS = {
  present: '#10B981',              // green  — present in school
  partial: '#F59E0B',              // amber  — partially present
  absent: '#EF4444',              // red    — absent
  leave: LEAVE_MARK_COLOR,        // pink   — on approved leave
  substitution: SUBSTITUTION_MARK_COLOR, // purple — covering / being covered
  holiday: HOLIDAY_APPROVED_COLOR, // sky    — approved holiday
  unknown: '#9CA3AF',             // grey   — record with no/unknown status
};

// Attendance record status -> colour. Kept here so both the portals and the
// profile map statuses identically.
const STATUS_COLOR = {
  Present: CALENDAR_COLORS.present,
  'Partially Present': CALENDAR_COLORS.partial,
  Absent: CALENDAR_COLORS.absent,
  Leave: CALENDAR_COLORS.leave,
};

export function statusColor(status) {
  return STATUS_COLOR[status] || CALENDAR_COLORS.unknown;
}

/**
 * Build react-native-calendars `custom` marks from attendance records, using the
 * canonical status colours. Keyed by LOCAL date (toYMD) so marks line up with the
 * calendar's local day cells and with the holiday/substitution/leave marks —
 * otherwise a check-in near a UTC/IST day boundary would paint the wrong cell and
 * today would stay blank/grey.
 */
export function buildAttendanceMarks(records = []) {
  const marks = {};
  for (const rec of records) {
    if (!rec || !rec.date) continue;
    const key = toYMD(rec.date);
    marks[key] = {
      customStyles: {
        container: { backgroundColor: statusColor(rec.status), borderRadius: 8 },
        text: { color: 'white', fontWeight: 'bold' },
      },
    };
  }
  return marks;
}

/**
 * THE canonical way to build a `markedDates` object. Every calendar in the app
 * goes through this so the layering rules can never drift between screens.
 *
 * Precedence, weakest first (later layers paint over earlier ones):
 *
 *  1. substitutionDuties  — days this person is assigned to COVER for someone
 *     else. It is only an assignment, so it is the weakest mark: the moment
 *     they actually check in, their real Partial/Present colour paints over it.
 *  2. attendance          — what actually happened (green / amber / red).
 *  3. holidays            — a school holiday outranks a stray record.
 *  4. today               — only drawn if nothing else claimed today's cell.
 *  5. leave + substitutionLeaves — days this person is NOT expected at work,
 *     either on approved personal leave or because someone else was approved to
 *     replace them. Strongest: an authorized absence is the final word.
 *
 * @param {object}   [opts]
 * @param {Array}    [opts.attendance]           attendance records
 * @param {Array}    [opts.holidays]             holiday records (omit to skip)
 * @param {Array}    [opts.leaveDays]            approved personal leave windows
 * @param {Array}    [opts.substitutionLeaves]   windows where they were REPLACED
 * @param {Array}    [opts.substitutionDuties]   windows where they are COVERING
 * @param {object}   [opts.todayMark]            style for today's cell (omit to skip)
 */
export function buildCalendarMarks({
  attendance = [],
  holidays = [],
  leaveDays = [],
  substitutionLeaves = [],
  substitutionDuties = [],
  todayMark,
} = {}) {
  const marks = {
    ...buildSubstitutionMarks(substitutionDuties),
    ...buildAttendanceMarks(attendance),
    ...buildHolidayMarks(holidays),
  };

  // Today's outline is a fallback, not a status — never let it cover a real one.
  const today = dayKey();
  if (todayMark && !marks[today]) {
    marks[today] = todayMark;
  }

  // Being replaced is an authorized absence, so it reads the same as leave.
  return { ...marks, ...buildLeaveMarks([...leaveDays, ...substitutionLeaves]) };
}

// Canonical legend (colour key shown under every calendar). `items` on
// CalendarLegend defaults to this; screens can pass a subset if a mark type
// never appears there (e.g. holidays aren't drawn on the profile view).
export const CALENDAR_LEGEND = [
  { key: 'present', label: 'Present', color: CALENDAR_COLORS.present },
  { key: 'partial', label: 'Partial', color: CALENDAR_COLORS.partial },
  { key: 'absent', label: 'Absent', color: CALENDAR_COLORS.absent },
  { key: 'leave', label: 'On Leave', color: CALENDAR_COLORS.leave },
  { key: 'substitution', label: 'On Substitution', color: CALENDAR_COLORS.substitution },
  { key: 'holiday', label: 'Holiday', color: CALENDAR_COLORS.holiday },
];
