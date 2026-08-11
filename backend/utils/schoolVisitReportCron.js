const cron = require('node-cron');
const SchoolVisitRequest = require('../models/SchoolVisitRequest');
const { notify } = require('./notify');

/**
 * Once an approved school visit is over, the person is expected to file the
 * IECE EGM Visit Report for the school they inspected. This job finds visits
 * whose window closed and nudges the applicant exactly once (the
 * `reportPromptedAt` stamp makes it idempotent, so a restart or a re-run never
 * double-nudges).
 *
 * Exported so it can be run by hand while testing.
 */
async function sendVisitReportPrompts(now = new Date()) {
  try {
    // Anything whose last day finished before the start of today.
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const due = await SchoolVisitRequest.find({
      status: 'approved',
      reportPromptedAt: null,
      toDate: { $lt: startOfToday },
    }).populate('school', 'name');

    if (due.length === 0) {
      console.log('[visit-report] No completed school visits awaiting a report prompt.');
      return { sent: 0 };
    }

    let sent = 0;
    for (const visit of due) {
      const schoolName = visit.school ? visit.school.name : 'the school you visited';
      try {
        await notify([visit.applicant], {
          type: 'school_visit_report_due',
          title: '📋 File your Visit Report',
          body: `Your school visit to ${schoolName} has ended. Please file the Visit Report for it.`,
          data: { requestId: String(visit._id), schoolId: String(visit.school?._id || visit.school || '') },
        });
        // Stamp only after a successful send, so a failure retries tomorrow.
        visit.reportPromptedAt = new Date();
        await visit.save();
        sent += 1;
      } catch (err) {
        console.error(`[visit-report] Prompt failed for visit ${visit._id}:`, err.message);
      }
    }

    console.log(`[visit-report] Prompted ${sent}/${due.length} completed school visit(s).`);
    return { sent };
  } catch (err) {
    console.error('[visit-report] Job error:', err.message);
    return { sent: 0 };
  }
}

let task = null;

/**
 * 09:00 IST daily — the morning after a visit window closes, while the visit is
 * still fresh in the person's mind.
 */
function startSchoolVisitReportCron() {
  if (task) return task; // guard against double-registration

  task = cron.schedule('0 9 * * *', () => sendVisitReportPrompts(), {
    timezone: 'Asia/Kolkata',
  });

  console.log('[visit-report] Cron scheduled: daily report prompt at 09:00 IST.');
  return task;
}

module.exports = { startSchoolVisitReportCron, sendVisitReportPrompts };
