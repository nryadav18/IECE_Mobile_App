// Month helpers for the Monthly Performance Report picker.
//
// A "period" is the string 'YYYY-MM' naming a calendar month in IST — the same
// representation the backend uses end to end (backend/utils/monthlyReport/period.js),
// so what the picker sends is what the report engine reads, with no parsing or
// timezone conversion in between.
//
// IST is a fixed UTC+5:30 offset (India observes no daylight saving). The device
// running this app is normally already on IST, but a phone left on another
// timezone would otherwise roll the month over at the wrong moment and offer
// "next month" as if it had started.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The IST calendar parts for an instant. */
function istParts(d = new Date()) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

/** 'YYYY-MM' for the IST month containing `d`. */
export function periodOf(d = new Date()) {
  const { year, month } = istParts(d);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 'August 2026' */
export function periodLabel(period) {
  if (!period) return '';
  const [y, m] = period.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** 'Aug 2026' — the short form used on the chips. */
export function periodShortLabel(period) {
  if (!period) return '';
  const [y, m] = period.split('-');
  return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`;
}

/** Today's date in IST, for the "so far" caption on the current month. */
export function istToday() {
  const { year, month, day } = istParts();
  return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
}

/**
 * The selectable months: the current one first, then the previous `count - 1`.
 *
 * The current month is flagged `inProgress`. Asking for it is allowed and
 * produces an interim report covering the month up to today — days that have
 * not happened yet are excluded from every figure rather than counted as
 * absences, and the PDF says so on the page.
 *
 * @param {number} count how many months to offer, current month included
 * @returns {Array<{period:string, label:string, short:string, inProgress:boolean}>}
 */
export function monthOptions(count = 12) {
  const { year, month } = istParts();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // Walk back i months from the current one; Date.UTC normalises the rollover
    // across a year boundary on its own.
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    const p = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({
      period: p,
      label: periodLabel(p),
      short: periodShortLabel(p),
      inProgress: i === 0,
    });
  }
  return out;
}
