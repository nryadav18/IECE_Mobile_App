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

/**
 * True when attendance should be disabled today: the user's school has an
 * APPROVED holiday today.
 *
 * Sundays are deliberately NOT off. Trainers do sometimes work Sundays, so
 * check-in / check-out stays enabled and the day is recorded normally. Sunday
 * only suppresses the reminder notifications, which the server decides — do not
 * add `isSunday()` back here, or the buttons would grey out while the API
 * happily accepts the attendance.
 */
export function isOffToday(holidays = []) {
  const today = dayKey();
  return holidays.some((h) => h.date === today && h.status === 'approved');
}

/** Sky-blue background for approved holidays; lighter dashed look for pending. */
export const HOLIDAY_APPROVED_COLOR = '#87CEEB'; // sky blue
export const HOLIDAY_PENDING_COLOR = '#B3E5FC';  // light sky blue

/**
 * Builds calendar custom-marking entries for the given holidays. Approved days
 * get a solid sky-blue background; pending days get a lighter, outlined look.
 */
export function buildHolidayMarks(holidays = []) {
  const marks = {};
  for (const h of holidays) {
    if (h.status === 'rejected') continue;
    const approved = h.status === 'approved';
    marks[h.date] = {
      customStyles: {
        container: approved
          ? { backgroundColor: HOLIDAY_APPROVED_COLOR, borderRadius: 8 }
          : { backgroundColor: HOLIDAY_PENDING_COLOR, borderRadius: 8, borderWidth: 1, borderColor: HOLIDAY_APPROVED_COLOR },
        text: { color: approved ? '#fff' : '#0277BD', fontWeight: 'bold' },
      },
    };
  }
  return marks;
}
