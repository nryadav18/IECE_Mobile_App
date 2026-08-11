const { IST_OFFSET_MS } = require('../holiday');

// A "period" throughout the monthly report feature is the string 'YYYY-MM'
// naming a calendar month in IST — '2026-08' is August 2026. Everything else
// (the date range to query, the list of days, the label on the PDF) is derived
// from it, so there is exactly one representation of "which month is this
// report about" and no way for the cron, the PDF and the run-log to disagree.
//
// Every calculation here is done in IST. The server may run in UTC (Render,
// Railway, most hosts do) and attendance rows store `date` as a UTC instant, so
// asking JavaScript for "the 1st of the month" with local-time methods would
// silently be five and a half hours off and drop the first evening / last
// evening of the month out of the report.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True when `period` is a well-formed 'YYYY-MM' string. */
function isValidPeriod(period) {
  return typeof period === 'string' && PERIOD_RE.test(period);
}

/**
 * The IST wall-clock date for a given instant, as plain numbers.
 * Shifting the instant by the IST offset makes the UTC getters read out the
 * IST values — the same trick the attendance reminder cron uses.
 */
function istParts(d = new Date()) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1, // 1-12
    day: ist.getUTCDate(),
    weekday: ist.getUTCDay(),     // 0 = Sunday
  };
}

/** The period string for the IST month containing `d`. */
function periodOf(d = new Date()) {
  const { year, month } = istParts(d);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The period string for the month BEFORE the one containing `d`.
 * This is what the cron reports on: it fires at 06:00 IST on the 1st and the
 * report covers the whole month that just ended.
 */
function previousPeriodOf(d = new Date()) {
  const { year, month } = istParts(d);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

/** { year, month } from a period string. */
function parsePeriod(period) {
  const [y, m] = period.split('-');
  return { year: Number(y), month: Number(m) };
}

/** 'August 2026' — the human label used in subjects, headings and filenames. */
function periodLabel(period) {
  const { year, month } = parsePeriod(period);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** 'Aug-2026' — the short form used inside PDF filenames. */
function periodFileLabel(period) {
  const { year, month } = parsePeriod(period);
  return `${MONTH_NAMES[month - 1].slice(0, 3)}-${year}`;
}

/**
 * The UTC instants bounding an IST month: [start, end] where start is IST
 * midnight on the 1st and end is the last millisecond of the last IST day.
 * Use this for every `date: { $gte, $lte }` query in the report.
 */
function periodRange(period) {
  const { year, month } = parsePeriod(period);
  const startUtcMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - IST_OFFSET_MS;
  // Date.UTC rolls month 12 over to January of the next year on its own.
  const nextStartUtcMs = Date.UTC(year, month, 1, 0, 0, 0, 0) - IST_OFFSET_MS;
  return { start: new Date(startUtcMs), end: new Date(nextStartUtcMs - 1) };
}

/** How many days the month has. */
function daysInPeriod(period) {
  const { year, month } = parsePeriod(period);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Every day of the month as { key: 'YYYY-MM-DD', day: 1-31, weekday: 0-6 }.
 * `key` is the same 'YYYY-MM-DD' IST format SchoolHoliday stores, so holiday
 * lookups are a plain string comparison with no timezone conversion at all.
 */
function periodDays(period) {
  const { year, month } = parsePeriod(period);
  const total = daysInPeriod(period);
  const out = [];
  for (let day = 1; day <= total; day += 1) {
    out.push({
      key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    });
  }
  return out;
}

/** The IST 'YYYY-MM-DD' key for an instant. */
function dayKeyOf(d) {
  const { year, month, day } = istParts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Every IST day key touched by an inclusive [from, to] window, clipped to the
 * days of `period`. Leave, substitution and school-visit records all store a
 * date window rather than individual days, so this is how a window becomes a
 * set of days that can be counted against the month.
 */
function dayKeysBetween(from, to, period) {
  if (!from) return [];
  const monthKeys = new Set(periodDays(period).map((d) => d.key));
  const out = [];
  const end = to ? new Date(to) : new Date(from);

  // Walk in IST-day steps from the window's first day. Stepping by 24h on the
  // shifted clock is safe because IST has no daylight saving.
  let cursor = new Date(new Date(from).getTime() + IST_OFFSET_MS);
  cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
  const endIst = new Date(end.getTime() + IST_OFFSET_MS);
  const endDay = Date.UTC(endIst.getUTCFullYear(), endIst.getUTCMonth(), endIst.getUTCDate());

  // Hard stop well past any sane window so a corrupt record cannot spin forever.
  let guard = 0;
  while (cursor.getTime() <= endDay && guard < 400) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`;
    if (monthKeys.has(key)) out.push(key);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    guard += 1;
  }
  return out;
}

/** '12 Aug 2026' — the date format used throughout the PDF and emails. */
function formatDay(d) {
  if (!d) return '—';
  const { year, month, day } = istParts(new Date(d));
  return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
}

/** '12 Aug 2026' from a 'YYYY-MM-DD' key (no timezone maths needed). */
function formatDayKey(key) {
  if (!key) return '—';
  const [y, m, d] = key.split('-');
  return `${d} ${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`;
}

/** Minutes past IST midnight for an instant — used for punctuality averages. */
function istMinutesOfDay(d) {
  if (!d) return null;
  const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** '09:14 AM' from minutes past midnight. */
function formatMinutes(mins) {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return '—';
  const total = Math.round(mins);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** '7h 45m' from a count of minutes. */
function formatDuration(mins) {
  if (!mins || mins <= 0) return '0h 0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

module.exports = {
  MONTH_NAMES,
  isValidPeriod,
  istParts,
  periodOf,
  previousPeriodOf,
  parsePeriod,
  periodLabel,
  periodFileLabel,
  periodRange,
  daysInPeriod,
  periodDays,
  dayKeyOf,
  dayKeysBetween,
  formatDay,
  formatDayKey,
  istMinutesOfDay,
  formatMinutes,
  formatDuration,
};
