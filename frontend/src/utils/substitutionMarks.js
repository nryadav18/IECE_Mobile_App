import { toYMD } from './dates';

// Distinct colour for "On Substitution" days on the attendance calendar
// (purple — clearly different from Present/Absent/Leave/Holiday).
export const SUBSTITUTION_MARK_COLOR = '#8B5CF6';

/**
 * Build react-native-calendars `custom` marks for the days a user is COVERING
 * for someone else. `windows` is the `substitutionDuties` array returned by
 * GET /attendance/my-attendance — each item has fromDate/toDate.
 *
 * These are the weakest marks on the calendar: an assignment says only that
 * the person is expected somewhere, so as soon as they check in their real
 * attendance colour paints over it. See buildCalendarMarks in calendarColors.
 *
 * The person being REPLACED is not marked here — they are not expected at
 * work at all, so their days are painted as leave instead.
 */
export function buildSubstitutionMarks(windows = []) {
  const marks = {};
  for (const lv of windows) {
    if (!lv || !lv.fromDate || !lv.toDate) continue;
    const cursor = new Date(lv.fromDate);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(lv.toDate);
    end.setHours(0, 0, 0, 0);
    // Guard against inverted/garbage ranges.
    let guard = 0;
    while (cursor <= end && guard < 400) {
      marks[toYMD(cursor)] = {
        customStyles: {
          container: { backgroundColor: SUBSTITUTION_MARK_COLOR, borderRadius: 8 },
          text: { color: 'white', fontWeight: 'bold' },
        },
      };
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  }
  return marks;
}
