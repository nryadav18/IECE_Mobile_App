// Holiday / calendar helpers shared by the Trainer & Team Leader portals.
// Dates are handled as local 'YYYY-MM-DD' strings so they line up exactly with
// react-native-calendars' day.dateString (which is local) and the backend's IST
// day keys (devices are in IST).

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day as 'YYYY-MM-DD' (defaults to today). */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Is the given date a Sunday? (defaults to today) */
export function isSunday(d = new Date()) {
  return d.getDay() === 0;
}

/** The school a holiday record belongs to, populated or not. */
const holidaySchoolId = (h) => String(h?.schoolId?._id || h?.schoolId || '');

/**
 * True when attendance should be disabled today: the school being marked at has
 * an APPROVED holiday today.
 *
 * MUST be asked about ONE school. A person assigned to several schools sees the
 * holidays of all of them on their calendar, but only the school they are
 * actually checking in at can close their day — otherwise school A taking a
 * holiday would grey out the buttons for school B while the server (which
 * checks per school, see isSchoolOffDay) happily accepts the attendance.
 * Passing no schoolId falls back to "any school", which is only right for
 * someone with a single school.
 *
 * Sundays are deliberately NOT off. Trainers do sometimes work Sundays, so
 * check-in / check-out stays enabled and the day is recorded normally. Sunday
 * only suppresses the reminder notifications, which the server decides — do not
 * add `isSunday()` back here, or the buttons would grey out while the API
 * happily accepts the attendance.
 */
export function isOffToday(holidays = [], schoolId = null) {
  const today = dayKey();
  const want = schoolId ? String(schoolId) : null;
  return holidays.some(
    (h) =>
      h.date === today &&
      h.status === 'approved' &&
      (!want || holidaySchoolId(h) === want)
  );
}

/**
 * Deep blue for an APPROVED school holiday — a day the school is officially
 * closed. Deliberately a colour nothing else in the calendar uses: green,
 * amber and red are attendance, pink is leave, purple is substitution and teal
 * is a school visit, so a strong blue is the only hue left that cannot be
 * mistaken for any of them at the size of a calendar cell.
 *
 * Pending requests keep a deliberately weaker treatment — a pale wash of the
 * same blue with a solid border — so "asked for" never looks like "granted".
 */
export const HOLIDAY_APPROVED_COLOR = '#1D4ED8'; // deep blue
export const HOLIDAY_PENDING_COLOR = '#DBEAFE';  // pale blue wash
const HOLIDAY_PENDING_TEXT = '#1E3A8A';

/**
 * Builds calendar custom-marking entries for the given holidays.
 *
 * Several schools can close on the same day, and one school's request may be
 * approved while another's is still pending. There is only one cell to paint,
 * so an APPROVED holiday always wins: the strongest true statement about that
 * day is that a school really is shut.
 */
export function buildHolidayMarks(holidays = []) {
  const marks = {};
  const approvedDays = new Set();

  for (const h of holidays) {
    if (!h || h.status === 'rejected') continue;
    const approved = h.status === 'approved';

    // Never let a pending request paint over an approved one.
    if (!approved && approvedDays.has(h.date)) continue;
    if (approved) approvedDays.add(h.date);

    marks[h.date] = {
      customStyles: {
        container: approved
          ? { backgroundColor: HOLIDAY_APPROVED_COLOR, borderRadius: 8 }
          : { backgroundColor: HOLIDAY_PENDING_COLOR, borderRadius: 8, borderWidth: 1, borderColor: HOLIDAY_APPROVED_COLOR },
        text: { color: approved ? '#fff' : HOLIDAY_PENDING_TEXT, fontWeight: 'bold' },
      },
    };
  }
  return marks;
}

/** How many distinct days are covered by an APPROVED holiday. */
export function countApprovedHolidays(holidays = []) {
  const days = new Set();
  for (const h of holidays) {
    if (h && h.status === 'approved' && h.date) days.add(h.date);
  }
  return days.size;
}
