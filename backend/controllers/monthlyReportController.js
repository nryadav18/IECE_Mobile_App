const MonthlyReportRun = require('../models/MonthlyReportRun');
const User = require('../models/User');
const Team = require('../models/Team');
const { runMonthlyReports, runSingleReport, runTeamReport } = require('../utils/monthlyReport');
const { reportableRoles, isManagerRole } = require('../utils/monthlyReport/metrics');
const { isValidPeriod, previousPeriodOf, periodOf, periodLabel } = require('../utils/monthlyReport/period');

// ---------------------------------------------------------------------------
// The Admin's manual handle on the monthly report.
//
// The report is a cron job — it needs no help on a normal month. This exists
// for the abnormal one: a send that failed because Brevo was down, a person who
// deleted the email, a month where the numbers were questioned and need to be
// re-issued. Without it the only recovery would be waiting four weeks or
// getting shell access to the server.
//
// Admin only. The CEO may read the delivery log but not re-issue reports, which
// matches how the CEO login works everywhere else in the app: a full view of
// everything, no write actions.
// ---------------------------------------------------------------------------

/**
 * @desc    Re-run the monthly report — for one person, or for everyone
 * @route   POST /api/admin/monthly-report/run
 * @access  Private (creator_admin)
 *
 * Body: { period?: 'YYYY-MM', email?: string, sendTo?: string, dryRun?: boolean }
 *   - `email` limits the run to that person (and rebuilds their bundle).
 *   - `sendTo` redirects delivery to another address, for verifying content.
 *   - omitting both runs the whole organisation, resuming past anyone already
 *     sent for that month.
 */
exports.runMonthlyReport = async (req, res) => {
  try {
    const period = req.body.period || previousPeriodOf();
    if (!isValidPeriod(period)) {
      return res.status(400).json({ message: 'period must be in YYYY-MM format, e.g. 2026-08.' });
    }

    const { email, sendTo, dryRun = false } = req.body;

    // A single person is quick enough to wait for, and the caller wants to see
    // the numbers that went out.
    if (email) {
      const result = await runSingleReport({ email, period, sendTo, dryRun, isTest: !!sendTo });
      return res.json({
        message: `Report for ${result.user.name} — ${periodLabel(period)}: ${result.status || 'sent'}.`,
        period,
        recipient: sendTo || result.user.email,
        kind: result.kind,
        status: result.status || 'sent',
        summary: result.metrics ? {
          workingDays: result.metrics.attendance.workingDays,
          present: result.metrics.attendance.presentDays,
          absent: result.metrics.attendance.absentDays,
          attendanceRate: Number(result.metrics.attendance.rate.toFixed(1)),
          activities: result.metrics.activities.uploaded,
          schoolVisits: result.metrics.schoolVisits.completed,
          score: result.metrics.performance.score,
          grade: result.metrics.performance.grade.grade,
        } : { staffCovered: (result.allMetrics || []).length },
      });
    }

    // A whole-organisation run builds a PDF per person and can take minutes —
    // far longer than any sensible HTTP timeout. Acknowledge immediately and
    // let it finish in the background; MonthlyReportRun records the outcome and
    // the runs endpoint below reports progress.
    res.status(202).json({
      message: `Monthly report run started for ${periodLabel(period)}. `
        + 'Anyone already sent this month is skipped. Track progress at GET /api/admin/monthly-report/runs.',
      period,
      dryRun: !!dryRun,
    });

    runMonthlyReports({ period, dryRun })
      .then((s) => console.log(`[monthly-report] Manual run finished: ${s.sent} sent, ${s.skipped} skipped, ${s.failed} failed.`))
      .catch((err) => console.error('[monthly-report] Manual run failed:', err.message));
  } catch (err) {
    console.error('[monthly-report] Trigger error:', err);
    if (!res.headersSent) res.status(500).json({ message: err.message || 'Could not run the monthly report.' });
  }
};

/**
 * @desc    Who a report can be requested about — staff and teams
 * @route   GET /api/admin/monthly-report/subjects?search=
 * @access  Private (creator_admin)
 *
 * Purpose-built rather than reusing the portal's separate heads / leaders /
 * trainers lists, so the picker offers EXACTLY the set the request endpoint
 * will accept. Anyone the report engine does not measure — the chairman
 * (school) logins, the Admins and the CEO — can never appear here, which means
 * the admin cannot pick a subject that then fails on send.
 *
 * `search` filters staff by name or email so the list stays usable as the
 * organisation grows; teams are always returned in full (there are few).
 */
exports.getMonthlyReportSubjects = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const filter = { role: { $in: reportableRoles() } };
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }];
    }

    const [staff, teams] = await Promise.all([
      User.find(filter)
        .select('name email role teamId')
        .populate('teamId', 'name')
        .sort({ name: 1 })
        .limit(300)
        .lean(),
      Team.find({}).select('name').sort({ name: 1 }).lean(),
    ]);

    // Member counts let the picker show "12 members" without a second call.
    const counts = await User.aggregate([
      { $match: { role: { $in: reportableRoles() }, teamId: { $ne: null } } },
      { $group: { _id: '$teamId', n: { $sum: 1 } } },
    ]);
    const countByTeam = new Map(counts.map((c) => [String(c._id), c.n]));

    res.json({
      data: staff.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        teamName: u.teamId?.name || null,
        // True when this person's report would also cover other people, so the
        // client knows whether to offer the "include their team" toggle.
        isManager: isManagerRole(u.role),
      })),
      teams: teams.map((t) => ({
        _id: t._id,
        name: t.name,
        memberCount: countByTeam.get(String(t._id)) || 0,
      })),
    });
  } catch (err) {
    console.error('[monthly-report] Subject list failed:', err);
    res.status(500).json({ message: 'Could not load the list of people and teams.' });
  }
};

/**
 * @desc    Email the signed-in admin a report for one person or one team
 * @route   POST /api/admin/monthly-report/request
 * @access  Private (creator_admin)
 *
 * Body: { period: 'YYYY-MM', subjectType: 'user' | 'team', subjectId, includeTeam? }
 *
 * This is the Admin portal's "Monthly Performance Report" section. It differs
 * from the run endpoint above in three deliberate ways:
 *
 *   - The recipient is ALWAYS the requesting admin, taken from their auth token
 *     rather than the request body. There is no way to address this at anyone
 *     else, so an admin reviewing someone can never accidentally email that
 *     person their own performance report, and a confidential report cannot be
 *     sent outside the organisation by typo.
 *   - It is always logged as a test send, so pulling August's numbers on the
 *     3rd never consumes the real August report that goes out on 1 September.
 *     The same report can be requested as often as needed.
 *   - Asking for the CURRENT month is allowed and produces an interim report:
 *     days that have not happened yet are excluded from every figure and the
 *     PDF says so on the page (see metrics.js `upcoming`).
 */
exports.requestMonthlyReport = async (req, res) => {
  try {
    const { period, subjectType = 'user', subjectId, includeTeam = true } = req.body;

    if (!isValidPeriod(period)) {
      return res.status(400).json({ message: 'Pick a month first (expected YYYY-MM, e.g. 2026-08).' });
    }
    if (!subjectId) {
      return res.status(400).json({ message: `Pick a ${subjectType === 'team' ? 'team' : 'person'} to report on.` });
    }
    if (!['user', 'team'].includes(subjectType)) {
      return res.status(400).json({ message: 'subjectType must be "user" or "team".' });
    }
    // A month that has not started yet has nothing to measure.
    if (period > periodOf()) {
      return res.status(400).json({ message: `${periodLabel(period)} has not started yet.` });
    }

    if (subjectType === 'team') {
      const result = await runTeamReport({ teamId: subjectId, period, requestedBy: req.user });
      if (result.status !== 'sent') {
        return res.status(502).json({ message: 'The report was built but the email could not be sent. Please try again.' });
      }
      return res.json({
        message: `Report for ${result.team.name} (${periodLabel(period)}) sent to ${req.user.email}.`,
        period,
        sentTo: req.user.email,
        subject: { type: 'team', name: result.team.name, memberCount: result.allMetrics.length },
        partialMonth: result.allMetrics.some((m) => m.attendance.isPartialMonth),
      });
    }

    const result = await runSingleReport({
      userId: subjectId,
      period,
      sendTo: req.user.email,
      isTest: true,
      includeTeam: !!includeTeam,
    });

    if (result.status && !['sent', 'dry-run'].includes(result.status)) {
      return res.status(502).json({ message: 'The report was built but the email could not be sent. Please try again.' });
    }

    const m = result.metrics;
    return res.json({
      message: `Report for ${result.user.name} (${periodLabel(period)}) sent to ${req.user.email}.`,
      period,
      sentTo: req.user.email,
      subject: { type: 'user', name: result.user.name, role: result.user.role },
      partialMonth: !!m?.attendance?.isPartialMonth,
      summary: m ? {
        workingDays: m.attendance.workingDays,
        present: m.attendance.presentDays,
        absent: m.attendance.absentDays,
        attendanceRate: Number(m.attendance.rate.toFixed(1)),
        activities: m.activities.uploaded,
        schoolVisits: m.schoolVisits.completed,
        score: m.performance.score,
        grade: m.performance.grade.grade,
      } : null,
    });
  } catch (err) {
    console.error('[monthly-report] On-demand request failed:', err);
    res.status(400).json({ message: err.message || 'Could not generate that report.' });
  }
};

/**
 * @desc    The delivery log for a month — who got their report and who did not
 * @route   GET /api/admin/monthly-report/runs?period=YYYY-MM
 * @access  Private (creator_admin, ceo)
 */
exports.getMonthlyReportRuns = async (req, res) => {
  try {
    const period = req.query.period || previousPeriodOf();
    if (!isValidPeriod(period)) {
      return res.status(400).json({ message: 'period must be in YYYY-MM format, e.g. 2026-08.' });
    }

    const runs = await MonthlyReportRun.find({ period })
      .sort({ status: 1, recipientName: 1 })
      .lean();

    const counts = runs.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      period,
      label: periodLabel(period),
      counts,
      total: runs.length,
      runs: runs.map((r) => ({
        id: r._id,
        name: r.recipientName,
        email: r.recipientEmail,
        role: r.recipientRole,
        bundle: r.bundle,
        subjectCount: r.subjectCount,
        status: r.status,
        error: r.error,
        sentAt: r.sentAt,
        sizeKb: r.pdfBytes ? Math.round(r.pdfBytes / 1024) : 0,
        isTest: r.isTest,
      })),
    });
  } catch (err) {
    console.error('[monthly-report] Log read error:', err);
    res.status(500).json({ message: 'Could not read the monthly report log.' });
  }
};
