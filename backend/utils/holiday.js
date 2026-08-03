const SchoolHoliday = require('../models/SchoolHoliday');

// IST is a fixed offset of UTC+5:30 (India observes no daylight saving).
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** 'YYYY-MM-DD' for the current IST day (or a given Date). */
function istDateKey(d = new Date()) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Is the given 'YYYY-MM-DD' a Sunday? */
function isSunday(dateKey = istDateKey()) {
  const dt = new Date(`${dateKey}T00:00:00Z`);
  return dt.getUTCDay() === 0; // 0 = Sunday
}

/**
 * True when attendance is CLOSED for this school on dateKey — i.e. the school
 * has an APPROVED holiday on that date.
 *
 * Sundays are deliberately NOT included. Trainers do sometimes work Sundays, so
 * check-in / check-out stays open and a Sunday they work is recorded normally.
 * Sunday only suppresses the reminder push notifications (see
 * attendanceReminderCron), which is a separate decision — do not fold `isSunday`
 * back in here.
 */
async function isSchoolOffDay(schoolId, dateKey = istDateKey()) {
  if (!schoolId) return false;
  const holiday = await SchoolHoliday.findOne({ schoolId, date: dateKey, status: 'approved' });
  return !!holiday;
}

/** Returns the Set of schoolId strings that have an approved holiday on dateKey. */
async function approvedHolidaySchoolIds(dateKey = istDateKey()) {
  const ids = await SchoolHoliday.find({ date: dateKey, status: 'approved' }).distinct('schoolId');
  return new Set(ids.map((id) => id.toString()));
}

module.exports = { istDateKey, isSunday, isSchoolOffDay, approvedHolidaySchoolIds, IST_OFFSET_MS };
