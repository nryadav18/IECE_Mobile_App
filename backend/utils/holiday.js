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
 * True when the school is off on dateKey — i.e. it's a Sunday, or the school has
 * an APPROVED holiday on that date. (No DB hit needed for Sundays.)
 */
async function isSchoolOffDay(schoolId, dateKey = istDateKey()) {
  if (isSunday(dateKey)) return true;
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
