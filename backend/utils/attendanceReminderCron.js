const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { sendPushNotification } = require('./pushNotification');

// IST is a fixed offset of UTC+5:30 (India observes no daylight saving).
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * Returns the UTC Date range [start, end] that corresponds to "today" in IST,
 * computed from the moment this runs. Attendance documents store `date` in UTC,
 * so we query against this range to find records created on the current IST day.
 */
function getISTDayRange() {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  // istNow's UTC fields are actually the IST wall-clock values.
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  // IST midnight expressed back in real UTC milliseconds.
  const istMidnightUtcMs = Date.UTC(y, m, d, 0, 0, 0, 0) - IST_OFFSET_MS;
  return {
    start: new Date(istMidnightUtcMs),
    end: new Date(istMidnightUtcMs + 24 * 60 * 60 * 1000 - 1),
  };
}

/**
 * Finds every trainer / team leader who can mark attendance (facial registration
 * approved) but has NOT checked in yet today (IST), and pushes them a reminder to
 * check in. Runs each morning hour until they check in.
 */
async function sendCheckinReminders() {
  try {
    const { start, end } = getISTDayRange();

    // Anyone with an attendance record today has already checked in.
    const checkedInIds = await Attendance.distinct('trainerId', {
      date: { $gte: start, $lte: end },
    });
    const checkedInSet = new Set(checkedInIds.map((id) => id.toString()));

    // Trainers / team leaders who can actually check in (approved face) and have
    // a registered push token.
    const users = await User.find({
      role: { $in: ['trainer', 'team_leader'] },
      expoPushToken: { $ne: null },
      $or: [
        { facialRegistrationStatusV2: 'approved' },
        { facialRegistrationStatus: 'approved' },
      ],
    }).select('name role expoPushToken');

    let sent = 0;
    let pending = 0;
    for (const user of users) {
      if (checkedInSet.has(user._id.toString())) continue; // already checked in
      pending += 1;

      const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';

      try {
        await sendPushNotification(
          user.expoPushToken,
          '☀️ Time to Check In',
          `Hi ${firstName}, please check in on the app to mark your attendance for today.`,
          { type: 'checkin_reminder', role: user.role }
        );
        sent += 1;
      } catch (err) {
        console.error(`[checkin-reminder] Failed for ${user._id}:`, err.message);
      }
    }

    console.log(`[checkin-reminder] Reminders sent: ${sent}/${pending} pending check-ins.`);
  } catch (err) {
    console.error('[checkin-reminder] Job error:', err.message);
  }
}

/**
 * Finds every trainer / team leader who checked in today (IST) but has NOT yet
 * checked out, and pushes them a reminder to check out so their attendance is
 * recorded as Present.
 */
async function sendCheckoutReminders() {
  try {
    const { start, end } = getISTDayRange();

    // Checked in today + no checkout yet = needs a reminder.
    const pending = await Attendance.find({
      date: { $gte: start, $lte: end },
      checkOutTime: null,
    }).populate('trainerId', 'name role expoPushToken');

    if (pending.length === 0) {
      console.log('[checkout-reminder] No pending check-outs to remind.');
      return;
    }

    let sent = 0;
    for (const att of pending) {
      const user = att.trainerId;
      // Only trainers and team leaders mark attendance; skip anything else,
      // and skip users without a registered push token.
      if (!user || !user.expoPushToken) continue;
      if (!['trainer', 'team_leader'].includes(user.role)) continue;

      const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';

      try {
        await sendPushNotification(
          user.expoPushToken,
          '⏰ Don’t forget to Check Out',
          `Hi ${firstName}, you’re still checked in. Please check out in the app so your attendance is marked Present and tracked correctly.`,
          { type: 'checkout_reminder', role: user.role }
        );
        sent += 1;
      } catch (err) {
        console.error(`[checkout-reminder] Failed for ${user._id}:`, err.message);
      }
    }

    console.log(`[checkout-reminder] Reminders sent: ${sent}/${pending.length}`);
  } catch (err) {
    console.error('[checkout-reminder] Job error:', err.message);
  }
}

let checkinTask = null;
let checkoutTask = null;

/**
 * Schedules the attendance reminder crons (Asia/Kolkata timezone so the schedule
 * is correct regardless of the server's local time / UTC):
 *
 *  - Check-in reminder: fires at 08:00–12:00 IST (08, 09, 10, 11, 12) every day.
 *    Each run only notifies users who have NOT checked in yet today.
 *  - Check-out reminder: fires at 16:00–22:00 IST (every hour from 4 PM up to
 *    and including 10 PM). Each run only notifies users who checked in today and
 *    have not checked out yet.
 */
function startAttendanceReminderCron() {
  if (checkinTask && checkoutTask) return { checkinTask, checkoutTask }; // guard against double-registration

  // Minute 0 of hours 8..12 — morning check-in nudges until they check in.
  checkinTask = cron.schedule(
    '0 8-12 * * *',
    sendCheckinReminders,
    { timezone: 'Asia/Kolkata' }
  );

  // Minute 0 of hours 16..22 — evening check-out reminders (now starting 4 PM).
  checkoutTask = cron.schedule(
    '0 16-22 * * *',
    sendCheckoutReminders,
    { timezone: 'Asia/Kolkata' }
  );

  console.log('[attendance-reminder] Crons scheduled: check-in hourly 08:00–12:00 IST, check-out hourly 16:00–22:00 IST.');
  return { checkinTask, checkoutTask };
}

module.exports = { startAttendanceReminderCron, sendCheckinReminders, sendCheckoutReminders };
