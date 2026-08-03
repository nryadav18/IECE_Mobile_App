/**
 * The rules behind the Check In / Check Out buttons, in one place.
 *
 * Staff assigned to several schools routinely work one school in the morning
 * and a different one in the afternoon, so a day may START at one school and
 * FINISH at another. That makes the two actions differently scoped:
 *
 *   - Check IN  happens ONCE per day, at whichever school they start at.
 *   - Check OUT happens ONCE per day, at whichever school they end at — which
 *     may or may not be the one they checked in at.
 *
 * So "have they checked in?" is a question about the DAY, while "can they act
 * here?" also depends on THIS school's face registration. Mixing those two up
 * is what makes the buttons wrong, which is why the whole decision lives here
 * and both portals just render the result.
 */

/** Local-day comparison — a record's date vs today. */
export function isSameDay(a, b = new Date()) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/** Today's attendance record out of a list, or null. */
export function findTodayAttendance(records = []) {
  return records.find((r) => r && r.date && isSameDay(r.date)) || null;
}

const idOf = (v) => (v ? String(v._id || v) : null);
const nameOf = (v, fallback) => (v && v.name) || fallback;

/**
 * @param {object}  opts
 * @param {object}  opts.todayAttendance  today's record (or null)
 * @param {string}  opts.selectedSchoolId school currently selected in the portal
 * @param {string}  opts.regStatus        'none' | 'pending' | 'approved' for THAT school
 * @param {boolean} opts.isHolidayToday   school is closed today
 */
export function deriveAttendanceActions({
  todayAttendance,
  selectedSchoolId,
  regStatus = 'none',
  isHolidayToday = false,
} = {}) {
  const here = selectedSchoolId ? String(selectedSchoolId) : null;

  const inSchoolId = todayAttendance ? idOf(todayAttendance.schoolId) : null;
  const inSchoolName = nameOf(todayAttendance?.schoolId, 'another school');

  // Records created before check-out-elsewhere existed have no checkOutSchoolId,
  // and back then check-out was forced to happen at the check-in school — so
  // falling back to schoolId is exactly what those records meant. Without this
  // an old record reads as a split day and the UI misreports where they were.
  const outSchoolId = todayAttendance ? (idOf(todayAttendance.checkOutSchoolId) || inSchoolId) : null;
  const outSchoolName = todayAttendance?.checkOutSchoolId
    ? nameOf(todayAttendance.checkOutSchoolId, 'another school')
    : inSchoolName;

  // Day-scoped facts.
  const checkedInToday = !!(todayAttendance && todayAttendance.checkInTime);
  const checkedOutToday = !!(todayAttendance && todayAttendance.checkOutTime);

  // School-scoped facts.
  const checkedInHere = checkedInToday && inSchoolId === here;
  const checkedInElsewhere = checkedInToday && inSchoolId !== here;
  const checkedOutHere = checkedOutToday && outSchoolId === here;
  const approvedHere = regStatus === 'approved';

  // A day that started at one school and finished at another.
  const splitDay = checkedOutToday && !!inSchoolId && !!outSchoolId && inSchoolId !== outSchoolId;

  const canCheckIn = approvedHere && !checkedInToday && !isHolidayToday;
  // The key rule: check-out is allowed at ANY school this person is approved
  // for, not only the one they checked in at.
  const canCheckOut = approvedHere && checkedInToday && !checkedOutToday && !isHolidayToday;

  // A short line explaining anything the buttons alone cannot say — chiefly
  // "you started your day somewhere else". Null when the buttons speak for
  // themselves.
  let notice = null;

  if (checkedOutToday) {
    if (splitDay) {
      notice = {
        tone: 'info',
        text: `Your day is complete — checked in at ${inSchoolName} and checked out at ${outSchoolName}.`,
      };
    } else if (!checkedOutHere) {
      notice = {
        tone: 'info',
        text: `Your day is complete — you checked in and out at ${outSchoolName} today.`,
      };
    }
  } else if (checkedInElsewhere) {
    if (isHolidayToday) {
      // Never invite them to check out somewhere the button is dead.
      notice = {
        tone: 'warn',
        text: `You checked in at ${inSchoolName} today. This school is closed today, so check out at ${inSchoolName}.`,
      };
    } else if (approvedHere) {
      notice = {
        tone: 'info',
        text: `You checked in at ${inSchoolName} today. If you have moved here for the rest of the day, check out here — your day will be recorded across both schools.`,
      };
    } else if (regStatus === 'pending') {
      notice = {
        tone: 'warn',
        text: `You checked in at ${inSchoolName} today. Once the admin approves your face registration for this school you can check out here; until then, check out at ${inSchoolName}.`,
      };
    } else {
      notice = {
        tone: 'warn',
        text: `You checked in at ${inSchoolName} today. Register your face here and get it approved to check out at this school — otherwise check out at ${inSchoolName}.`,
      };
    }
  }

  return {
    checkedInToday,
    checkedOutToday,
    checkedInHere,
    checkedInElsewhere,
    checkedOutHere,
    splitDay,
    inSchoolName,
    outSchoolName,
    canCheckIn,
    canCheckOut,
    checkInLabel: checkedInHere ? 'Checked In' : 'Check In',
    checkOutLabel: checkedOutToday ? 'Checked Out' : 'Check Out',
    notice,
  };
}
