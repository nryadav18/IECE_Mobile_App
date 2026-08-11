const cron = require('node-cron');
const { runMonthlyReports } = require('./monthlyReport');
const { previousPeriodOf, periodLabel } = require('./monthlyReport/period');

// The monthly performance report goes out at 06:00 IST on the 1st of every
// month and covers the whole month that just ended — so a report received on
// 1 September is August's, complete, with nothing still to come.
//
// The timezone is pinned to Asia/Kolkata rather than left to the server, which
// on most hosts runs in UTC; without it the job would fire at 11:30 IST.
//
// Firing twice is not a risk this schedule has to avoid on its own: every send
// is claimed in MonthlyReportRun first, so a restart, a redeploy or a second
// app instance can re-enter this job freely and nobody receives a duplicate.
const SCHEDULE = '0 6 1 * *'; // 06:00, day 1, every month

let task = null;

/** Run the job now, for the month that just ended. Exported for manual runs. */
async function runNow(opts = {}) {
  const period = opts.period || previousPeriodOf();
  console.log(`[monthly-report] Triggered for ${periodLabel(period)}.`);
  try {
    return await runMonthlyReports({ ...opts, period });
  } catch (err) {
    console.error('[monthly-report] Job error:', err.message);
    console.error(err.stack);
    return { period, sent: 0, failed: 0, skipped: 0, error: err.message };
  }
}

function startMonthlyReportCron() {
  if (task) return task; // guard against double-registration

  task = cron.schedule(SCHEDULE, () => runNow(), { timezone: 'Asia/Kolkata' });

  console.log('[monthly-report] Cron scheduled: 06:00 IST on the 1st of each month (covers the previous month).');
  return task;
}

module.exports = { startMonthlyReportCron, runNow, SCHEDULE };
