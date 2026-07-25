import { toYMD } from './dates';

// Distinct colour for approved "On Leave" days on the attendance calendar
// (pink — clearly different from Present/Absent/Partial/Holiday and from the
// purple "On Substitution" mark).
export const LEAVE_MARK_COLOR = '#EC4899';

/**
 * Build react-native-calendars `custom` marks for the days a user is on approved
 * leave. `leaves` is the `leaveDays` array returned by GET /attendance/my-attendance
 * or GET /profile/:id — each item has fromDate/toDate.
 */
export function buildLeaveMarks(leaves = []) {
  const marks = {};
  for (const lv of leaves) {
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
          container: { backgroundColor: LEAVE_MARK_COLOR, borderRadius: 8 },
          text: { color: 'white', fontWeight: 'bold' },
        },
      };
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  }
  return marks;
}
