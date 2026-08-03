/**
 * Calendar-day maths for the celebration system.
 *
 * Everything here works on the phone's *local* calendar day, deliberately not
 * on `toISOString()`. `toISOString()` converts to UTC first, so 1 January
 * 02:00 IST is `2025-12-31T20:30Z` — an app that keyed off that string would
 * wish you a happy new year five and a half hours late, every year. The device
 * clock is the source of truth for "what day is it".
 *
 * (The same trap exists elsewhere in this codebase — `CreatorAdminPortal`'s
 * date pickers use `toISOString().split('T')[0]` — which is exactly why this
 * module exists rather than being inlined.)
 */

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local calendar day as `YYYY-MM-DD`. The canonical key for a day. */
export function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `YYYY-MM-DD` → a Date at *local* midnight (not UTC midnight). */
export function fromYmd(key) {
  if (typeof key !== 'string') return null;
  const parts = key.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Day-of-month of the `nth` `weekday` in a month — the rule behind Mother's
 * Day (2nd Sunday of May), Father's Day (3rd Sunday of June) and Friendship
 * Day (1st Sunday of August).
 *
 * `weekday` is 0=Sunday … 6=Saturday, matching `Date#getDay`.
 */
export function nthWeekdayOf(year, month, weekday, nth) {
  const firstDow = new Date(year, month, 1).getDay();
  const offset = (weekday - firstDow + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

/** `15 August 2026` */
export function prettyDate(date) {
  if (!date) return '';
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** `Sat, 15 Aug` — for dense list rows. */
export function shortDate(date) {
  if (!date) return '';
  return `${WEEKDAY_SHORT[date.getDay()]}, ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}

/** Ordinal suffix, for "79th Independence Day" / "9th Anniversary". */
export function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Every day in a year, as Dates. Used by the admin year listing. */
export function daysInYear(year) {
  const out = [];
  const cursor = new Date(year, 0, 1);
  while (cursor.getFullYear() === year) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
