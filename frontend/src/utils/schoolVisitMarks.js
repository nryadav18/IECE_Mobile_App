import { toYMD } from './dates';

// Distinct colour for approved "On School Visit" days on the attendance
// calendar (teal — clearly different from Present/Absent/Partial/Holiday, from
// the pink "On Leave" mark and from the purple "On Substitution" mark).
//
// Unlike leave and substitution, a school visit is ON-DUTY time: the person is
// working, just inspecting another school instead of being at their own. It is
// coloured separately so an authority can tell "away, still working" apart from
// "away, excused" at a glance.
export const SCHOOL_VISIT_MARK_COLOR = '#0D9488';

/**
 * The approved visit window covering `date` (default: today), or null. Drives
 * the "your attendance is paused" state of the Check In / Check Out buttons —
 * the server enforces the same rule, this just keeps the UI honest.
 */
export function findActiveVisit(visits = [], date = new Date()) {
  const day = new Date(date);
  day.setHours(12, 0, 0, 0); // midday, so DST/timezone drift can't slip a day
  return (
    visits.find((v) => {
      if (!v || !v.fromDate || !v.toDate) return false;
      const start = new Date(v.fromDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(v.toDate);
      end.setHours(23, 59, 59, 999);
      return day >= start && day <= end;
    }) || null
  );
}

/**
 * Build react-native-calendars `custom` marks for the days a user is on an
 * approved school visit. `visits` is the `visitDays` array returned by
 * GET /attendance/my-attendance or GET /profile/:id — each item has
 * fromDate/toDate (and schoolName/reason, unused for painting).
 */
export function buildSchoolVisitMarks(visits = []) {
  const marks = {};
  for (const v of visits) {
    if (!v || !v.fromDate || !v.toDate) continue;
    const cursor = new Date(v.fromDate);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(v.toDate);
    end.setHours(0, 0, 0, 0);
    // Guard against inverted/garbage ranges.
    let guard = 0;
    while (cursor <= end && guard < 400) {
      marks[toYMD(cursor)] = {
        customStyles: {
          container: { backgroundColor: SCHOOL_VISIT_MARK_COLOR, borderRadius: 8 },
          text: { color: 'white', fontWeight: 'bold' },
        },
      };
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  }
  return marks;
}
