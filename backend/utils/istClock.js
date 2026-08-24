// India observes no daylight saving, so IST is a fixed offset and can be done
// with arithmetic rather than a timezone database. The same constant appears in
// attendanceReminderCron.js and the monthly report — this module exists so the
// maintenance window does not become a fourth place that spells it out.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;   // DD-MM-YYYY
const TIME_RE = /^(\d{1,2}):(\d{2})$/;         // HH:mm, 24-hour

/**
 * Turn an IST wall-clock "DD-MM-YYYY" + "HH:mm" into real UTC milliseconds.
 *
 * Returns null for anything that is not a complete, valid moment — a blank
 * field, "25/08/2026", "2pm", the 31st of February. The caller decides what a
 * null means; this function never guesses, because guessing here would silently
 * shift a maintenance window by hours.
 *
 * The round-trip check at the end is what catches a date that parses but does
 * not exist: `Date.UTC(2026, 1, 31)` cheerfully yields 3 March, and a window
 * that ends two days late is worse than one that is rejected outright.
 */
function istToUtcMs(dateStr, timeStr) {
  const d = DATE_RE.exec(String(dateStr || '').trim());
  const t = TIME_RE.exec(String(timeStr || '').trim());
  if (!d || !t) return null;

  const day = Number(d[1]);
  const month = Number(d[2]);
  const year = Number(d[3]);
  const hour = Number(t[1]);
  const minute = Number(t[2]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  // The wall-clock instant as if it were UTC, then shifted back by the offset
  // to give the real instant.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  // Rejects 31-02-2026 and friends: JS rolls them forward instead of failing.
  const check = new Date(asUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return asUtc - IST_OFFSET_MS;
}

/**
 * "2:00 PM, 25 Aug 2026" — the same moment, written the way it would be read
 * aloud. Formatted on the SERVER because the phone may be in another timezone
 * (or have its clock wrong), and the window is defined in IST regardless of
 * where the person holding the phone happens to be.
 */
function formatIst(utcMs) {
  if (utcMs == null) return null;
  const ist = new Date(utcMs + IST_OFFSET_MS);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let hour = ist.getUTCHours();
  const minute = String(ist.getUTCMinutes()).padStart(2, '0');
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}, ${ist.getUTCDate()} ${months[ist.getUTCMonth()]} ${ist.getUTCFullYear()} IST`;
}

module.exports = { IST_OFFSET_MS, istToUtcMs, formatIst };
