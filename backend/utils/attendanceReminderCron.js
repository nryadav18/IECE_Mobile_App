const cron = require('node-cron');
const Attendance = require('../models/Attendance');
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

let task = null;

/**
 * Schedules the hourly checkout reminder.
 * Fires at 17:00, 18:00, 19:00, 20:00, 21:00 and 22:00 IST every day — i.e.
 * every hour from 5 PM up to and including 10 PM IST. Each run only notifies
 * users who checked in today and have not checked out yet.
 */
function startAttendanceReminderCron() {
  if (task) return task; // guard against double-registration

  // Minute 0 of hours 17..22, scheduled in the Asia/Kolkata timezone so the
  // schedule is correct regardless of the server's local time / UTC.
  task = cron.schedule(
    '0 17-22 * * *',
    sendCheckoutReminders,
    { timezone: 'Asia/Kolkata' }
  );

  console.log('[checkout-reminder] Cron scheduled: hourly 17:00–22:00 IST.');
  return task;
}

module.exports = { startAttendanceReminderCron, sendCheckoutReminders };
