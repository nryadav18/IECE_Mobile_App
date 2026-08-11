const User = require('../../models/User');
const MonthlyReportRun = require('../../models/MonthlyReportRun');
const { ADMIN_ROLES } = require('../roles');
const { getApprovalSubjectFilter } = require('../hierarchy');
const { ROLE_LABELS } = require('../roleLabels');

const { periodLabel, previousPeriodOf, isValidPeriod } = require('./period');
const { gradeFor } = require('./score');
const { buildContext, collectMetrics, reportableRoles, isManagerRole, summariseMetrics } = require('./metrics');
const { buildIndividualPdf, buildTeamPdf, buildOrgPdf } = require('./pdf');
const { sendReportEmail, fileNameFor } = require('./email');

// ---------------------------------------------------------------------------
// Running the month.
//
// Who gets what, restated from the requirement:
//
//   Trainer                -> their own report.
//   Team / trainee TL      -> their own report + a condensed page for each
//                             trainer reporting to them.
//   Head (zonal/cluster/
//   regional)              -> their own report + a condensed page for every
//                             team leader, trainee team leader and trainer in
//                             the teams they oversee.
//   Admin + CEO            -> one organisation-wide report covering everybody.
//   Chairman (school login)-> NOTHING. Schools are never sent staff performance.
//
// "Who is under me" is not re-implemented here. It is resolved with
// getApprovalSubjectFilter — the same function that decides whose requests a
// person may approve. Tying the two together means a manager's report covers
// exactly the people they are already accountable for, and a change to the
// hierarchy can never leave the two definitions disagreeing.
//
// Every person's metrics are computed ONCE per run and shared: a trainer's
// numbers are gathered a single time and reused in their own report, their
// leader's bundle, their head's bundle and the org report.
// ---------------------------------------------------------------------------

/** A 'sending' claim older than this is assumed dead and may be retried. */
const STALE_CLAIM_MINUTES = 30;

const idStr = (v) => String(v && v._id ? v._id : v);
const firstName = (name) => (String(name || '').trim().split(/\s+/)[0] || 'Colleague');

/**
 * Claim the (period, recipient) slot before sending.
 *
 * @returns {Promise<{run: object|null, skip: boolean, reason: string}>}
 *   `skip` is true when this person already has their report for this month.
 */
async function claimSend(period, user, bundle, { isTest = false } = {}) {
  const base = {
    period,
    recipient: user._id,
    recipientEmail: user.email,
    recipientName: user.name,
    recipientRole: user.role,
    bundle,
    isTest,
  };

  if (isTest) {
    // A test run is logged so it is visible in the delivery log, but it never
    // claims the real slot: the unique index skips isTest rows, so testing
    // August does not stop August's genuine report from going out, and a test
    // is never mistaken for a delivered report.
    const run = await MonthlyReportRun.create({ ...base, status: 'sending', sentAt: new Date() })
      .catch((e) => { console.error('[monthly-report] Could not log test run:', e.message); return null; });
    return { run, skip: false, reason: '' };
  }

  try {
    const run = await MonthlyReportRun.create({ ...base, status: 'sending', sentAt: new Date() });
    return { run, skip: false, reason: '' };
  } catch (err) {
    if (err.code !== 11000) throw err;

    // Somebody already holds this slot. Only a dead claim or a previous failure
    // may be retried — a successful send is never repeated.
    const prior = await MonthlyReportRun.findOne({ period, recipient: user._id, isTest: false });
    if (!prior) return { run: null, skip: true, reason: 'claim race' };
    if (prior.status === 'sent') return { run: prior, skip: true, reason: 'already sent' };
    if (prior.status === 'sending') {
      const ageMin = (Date.now() - new Date(prior.sentAt).getTime()) / 60000;
      if (ageMin < STALE_CLAIM_MINUTES) return { run: prior, skip: true, reason: 'send already in progress' };
    }
    prior.set({ ...base, status: 'sending', sentAt: new Date(), error: null });
    await prior.save();
    return { run: prior, skip: false, reason: '' };
  }
}

async function settleClaim(run, patch) {
  if (!run) return;
  run.set(patch);
  await run.save().catch((e) => console.error('[monthly-report] Could not update run log:', e.message));
}

/** The people whose numbers belong in this person's bundle (may be empty). */
async function subordinatesOf(user, roles) {
  if (!isManagerRole(user.role)) return [];
  const filter = getApprovalSubjectFilter(user);
  if (!filter) return [];
  return User.find({ ...filter, role: { $in: roles } })
    .select('name email role schoolId schoolIds teamId teamIds anonymousLocation')
    .lean();
}

/**
 * Build and send one person's report.
 *
 * @param {object} opts
 * @param {object} opts.user        - the recipient (a lean User doc)
 * @param {object} opts.ctx         - from buildContext()
 * @param {Map}    opts.metricsById - shared metrics cache for the run
 * @param {string} [opts.overrideTo]- send to this address instead (testing)
 * @param {boolean}[opts.isTest]
 * @param {boolean}[opts.dryRun]    - build the PDF but do not send
 */
async function sendIndividualReport({
  user, ctx, metricsById, overrideTo = null, isTest = false, dryRun = false, includeTeam = true,
}) {
  const { period } = ctx;
  const roles = reportableRoles();

  const metrics = await getMetrics(user, ctx, metricsById);
  const team = [];
  // The monthly cron always includes a manager's people — that is what the
  // report IS for a leader or head. The Admin's on-demand screen can turn it
  // off when they only want to look at one person.
  if (includeTeam) {
    for (const sub of await subordinatesOf(user, roles)) {
      if (idStr(sub._id) === idStr(user._id)) continue;
      team.push(await getMetrics(sub, ctx, metricsById));
    }
  }

  const bundle = team.length ? 'manager' : 'individual';
  const { run, skip, reason } = await claimSend(period, user, bundle, { isTest });
  if (skip) {
    console.log(`[monthly-report] Skipping ${user.email} — ${reason}.`);
    return { status: 'skipped', reason, metrics };
  }

  try {
    const pdf = await buildIndividualPdf(metrics, { team, period });
    const fileName = fileNameFor(user.name, period);
    const to = overrideTo || user.email;

    const a = metrics.attendance;
    const stats = [
      { label: 'Present', value: `${a.presentDays} / ${a.workingDays}`, hint: 'of your working days', color: '#16A34A' },
      { label: 'Attendance', value: `${a.rate.toFixed(1)}%`, hint: `${a.absentDays} day(s) absent`, color: a.rate >= 90 ? '#16A34A' : a.rate >= 75 ? '#D97706' : '#DC2626' },
      { label: 'Activities', value: metrics.activities.uploaded, hint: `${metrics.activities.approved} approved`, color: '#0D9488' },
      { label: 'School visits', value: metrics.schoolVisits.completed, hint: `${metrics.visitReports.filed} report(s) filed`, color: '#0D9488' },
    ];

    const headline = team.length
      ? `Here is your performance summary for <strong>${periodLabel(period)}</strong>, together with a `
        + `condensed report for each of the <strong>${team.length}</strong> people reporting to you.`
      : `Here is your performance summary for <strong>${periodLabel(period)}</strong>, covering your attendance, `
        + `the activities you published and the field work you completed.`;

    const note = team.length
      ? `The attached file continues past your own report with a ranked summary of your team and a full page `
        + `for every person under you — attendance, activities, visits and score.`
      : '';

    if (dryRun) {
      console.log(`[monthly-report] DRY RUN — built ${fileName} (${(pdf.length / 1024).toFixed(0)} KB) for ${to}, not sending.`);
      await settleClaim(run, { status: 'skipped', error: 'dry run', pdfBytes: pdf.length, subjectCount: 1 + team.length });
      return { status: 'dry-run', metrics, pdf, fileName };
    }

    const ok = await sendReportEmail({
      to,
      toName: user.name,
      subject: `Your IECE Performance Report — ${periodLabel(period)}`,
      pdf,
      fileName,
      greetingName: firstName(user.name),
      period,
      headline,
      stats,
      score: metrics.performance,
      note,
    });

    await settleClaim(run, {
      status: ok ? 'sent' : 'failed',
      error: ok ? null : 'Brevo rejected the message',
      pdfBytes: pdf.length,
      subjectCount: 1 + team.length,
      sentAt: new Date(),
    });

    return { status: ok ? 'sent' : 'failed', metrics, pdf, fileName };
  } catch (err) {
    await settleClaim(run, { status: 'failed', error: err.message });
    throw err;
  }
}

/** Metrics for a person, computed at most once per run. */
async function getMetrics(user, ctx, cache) {
  const key = idStr(user._id);
  if (cache.has(key)) return cache.get(key);
  const m = await collectMetrics(user, ctx);
  cache.set(key, m);
  return m;
}

/**
 * Build the organisation-wide PDF once and send it to every Admin and CEO.
 * The same buffer is reused for all of them — it is the same document.
 */
async function sendOrgReports({ ctx, allMetrics, admins, overrideTo = null, isTest = false, dryRun = false }) {
  const { period } = ctx;
  const results = [];
  if (!admins.length) return results;

  const pdf = await buildOrgPdf(allMetrics, { period });
  const fileName = `IECE_Monthly_Performance_${period}.pdf`;

  const n = allMetrics.length || 1;
  const sum = (fn) => allMetrics.reduce((s, x) => s + fn(x), 0);
  const avgRate = sum((x) => x.attendance.rate) / n;
  const avgScore = sum((x) => x.performance.score) / n;
  const attention = allMetrics.filter((x) => x.performance.score < 60 || x.attendance.rate < 75).length;

  for (const admin of admins) {
    const { run, skip, reason } = await claimSend(period, admin, 'organisation', { isTest });
    if (skip) {
      console.log(`[monthly-report] Skipping ${admin.email} — ${reason}.`);
      results.push({ user: admin, status: 'skipped', reason });
      continue;
    }

    try {
      if (dryRun) {
        console.log(`[monthly-report] DRY RUN — built ${fileName} (${(pdf.length / 1024).toFixed(0)} KB) for ${admin.email}, not sending.`);
        await settleClaim(run, { status: 'skipped', error: 'dry run', pdfBytes: pdf.length, subjectCount: allMetrics.length });
        results.push({ user: admin, status: 'dry-run' });
        continue;
      }

      const ok = await sendReportEmail({
        to: overrideTo || admin.email,
        toName: admin.name,
        subject: `IECE Organisation Performance Report — ${periodLabel(period)}`,
        pdf,
        fileName,
        greetingName: firstName(admin.name),
        period,
        headline: `Here is the organisation-wide performance report for <strong>${periodLabel(period)}</strong>, `
          + `covering all <strong>${allMetrics.length}</strong> monitored staff members across every team.`,
        stats: [
          { label: 'Staff reported', value: allMetrics.length, hint: 'Field staff only', color: '#0D9488' },
          { label: 'Average attendance', value: `${avgRate.toFixed(1)}%`, hint: `${sum((x) => x.attendance.absentDays)} absence(s) in total`, color: avgRate >= 90 ? '#16A34A' : '#D97706' },
          { label: 'Activities uploaded', value: sum((x) => x.activities.uploaded), hint: `${sum((x) => x.activities.approved)} approved`, color: '#0D9488' },
          { label: 'Needs attention', value: attention, hint: 'Below 60 score or 75% attendance', color: attention ? '#DC2626' : '#16A34A' },
        ],
        score: { score: Math.round(avgScore), grade: gradeFor(Math.round(avgScore)) },
        note: 'The attachment opens with a full ranked leaderboard and the attention list, then gives a page '
          + 'per person grouped by team so each head\'s people stay together.',
      });

      await settleClaim(run, {
        status: ok ? 'sent' : 'failed',
        error: ok ? null : 'Brevo rejected the message',
        pdfBytes: pdf.length,
        subjectCount: allMetrics.length,
        sentAt: new Date(),
      });
      results.push({ user: admin, status: ok ? 'sent' : 'failed' });
    } catch (err) {
      await settleClaim(run, { status: 'failed', error: err.message });
      results.push({ user: admin, status: 'failed', error: err.message });
    }
  }

  return { results, pdf, fileName };
}

/**
 * A report about ONE TEAM, emailed to whoever asked for it.
 *
 * Only ever reached from the Admin's on-demand screen — the monthly cron has no
 * concept of "the team" as a recipient, because a team is not a person with an
 * inbox. The requesting admin is the recipient; the team is only the subject.
 *
 * Membership is every monitored staff member carrying this teamId, which
 * includes the team's own leaders as well as its trainers. Heads are not
 * included: a head oversees several teams and belongs to none of them, so
 * folding them in would double-count them across every team they cover.
 *
 * @param {object} opts
 * @param {string} opts.teamId
 * @param {string} opts.period
 * @param {object} opts.requestedBy - the admin user doc; receives the email
 * @param {boolean}[opts.dryRun]
 */
async function runTeamReport({ teamId, period: rawPeriod, requestedBy, dryRun = false }) {
  const period = rawPeriod || previousPeriodOf();
  if (!isValidPeriod(period)) throw new Error(`Invalid period "${period}" — expected YYYY-MM.`);

  const Team = require('../../models/Team');
  const team = await Team.findById(teamId).select('name').lean();
  if (!team) throw new Error('That team no longer exists.');

  const members = await User.find({ teamId, role: { $in: reportableRoles() } })
    .select('name email role schoolId schoolIds teamId teamIds anonymousLocation')
    .sort({ name: 1 })
    .lean();

  if (members.length === 0) {
    throw new Error(`${team.name} has no staff assigned to it, so there is nothing to report on.`);
  }

  const ctx = await buildContext(period);
  const metricsById = new Map();
  const allMetrics = [];
  for (const m of members) allMetrics.push(await getMetrics(m, ctx, metricsById));

  const pdf = await buildTeamPdf(allMetrics, { period, teamName: team.name });
  const fileName = fileNameFor(team.name, period, 'Team_Report');

  const n = allMetrics.length;
  const sum = (fn) => allMetrics.reduce((s, x) => s + fn(x), 0);
  const avgRate = sum((x) => x.attendance.rate) / n;
  const avgScore = Math.round(sum((x) => x.performance.score) / n);
  const attention = allMetrics.filter((x) => x.performance.score < 60 || x.attendance.rate < 75).length;
  const partial = allMetrics.some((x) => x.attendance.isPartialMonth);

  if (dryRun) {
    console.log(`[monthly-report] DRY RUN — built ${fileName} (${(pdf.length / 1024).toFixed(0)} KB), not sending.`);
    return { kind: 'team', team, period, allMetrics, pdf, fileName, status: 'dry-run' };
  }

  const ok = await sendReportEmail({
    to: requestedBy.email,
    toName: requestedBy.name,
    subject: `Team Performance Report — ${team.name}, ${periodLabel(period)}`,
    pdf,
    fileName,
    greetingName: firstName(requestedBy.name),
    period,
    headline: `Here is the performance report you requested for <strong>${team.name}</strong> covering `
      + `<strong>${periodLabel(period)}</strong>${partial ? ' <em>(up to today — the month is still in progress)</em>' : ''}, `
      + `across all <strong>${n}</strong> member(s) of the team.`,
    stats: [
      { label: 'Team size', value: n, hint: 'Monitored staff', color: '#0D9488' },
      { label: 'Average attendance', value: `${avgRate.toFixed(1)}%`, hint: `${sum((x) => x.attendance.absentDays)} absence(s)`, color: avgRate >= 90 ? '#16A34A' : avgRate >= 75 ? '#D97706' : '#DC2626' },
      { label: 'Activities uploaded', value: sum((x) => x.activities.uploaded), hint: `${sum((x) => x.activities.approved)} approved`, color: '#0D9488' },
      { label: 'Needs attention', value: attention, hint: 'Below 60 score or 75% attendance', color: attention ? '#DC2626' : '#16A34A' },
    ],
    score: { score: avgScore, grade: gradeFor(avgScore) },
    note: 'The attachment opens with the team overview and a ranked table, then gives a full page for '
      + 'every member — attendance calendar, activities, field work and score.',
  });

  // Logged for visibility in the delivery list, and always as a test row: an
  // ad-hoc pull must never consume a real monthly slot. The team is recorded as
  // the subject via subjectCount; the recipient is the admin who asked.
  await MonthlyReportRun.create({
    period,
    recipient: requestedBy._id,
    recipientEmail: requestedBy.email,
    recipientName: `${team.name} (team)`,
    recipientRole: 'team',
    bundle: 'manager',
    subjectCount: n,
    status: ok ? 'sent' : 'failed',
    error: ok ? null : 'Brevo rejected the message',
    pdfBytes: pdf.length,
    sentAt: new Date(),
    isTest: true,
  }).catch((e) => console.error('[monthly-report] Could not log team run:', e.message));

  return { kind: 'team', team, period, allMetrics, pdf, fileName, status: ok ? 'sent' : 'failed' };
}

/**
 * THE MONTHLY RUN. Everything above, for everybody.
 *
 * @param {object} [opts]
 * @param {string} [opts.period]  - 'YYYY-MM'; defaults to the month just ended
 * @param {boolean}[opts.dryRun]  - build every PDF but send nothing
 * @param {string[]}[opts.onlyEmails] - restrict to these recipients (testing)
 * @returns {Promise<object>} a summary of what was sent
 */
async function runMonthlyReports(opts = {}) {
  const period = opts.period || previousPeriodOf();
  if (!isValidPeriod(period)) throw new Error(`Invalid period "${period}" — expected YYYY-MM.`);

  const startedAt = Date.now();
  console.log(`[monthly-report] ===== ${periodLabel(period)} — starting =====`);

  const ctx = await buildContext(period);
  const roles = reportableRoles();

  const staff = await User.find({ role: { $in: roles }, email: { $ne: null } })
    .select('name email role schoolId schoolIds teamId teamIds anonymousLocation')
    .sort({ name: 1 })
    .lean();

  const admins = await User.find({ role: { $in: ADMIN_ROLES }, email: { $ne: null } })
    .select('name email role')
    .lean();

  console.log(`[monthly-report] ${staff.length} staff to report on, ${admins.length} admin/CEO recipient(s).`);

  const metricsById = new Map();
  const summary = { period, sent: 0, skipped: 0, failed: 0, staff: staff.length, admins: admins.length, failures: [] };

  const wanted = opts.onlyEmails ? new Set(opts.onlyEmails.map((e) => e.toLowerCase())) : null;

  for (const user of staff) {
    if (wanted && !wanted.has(String(user.email).toLowerCase())) continue;
    try {
      const res = await sendIndividualReport({ user, ctx, metricsById, dryRun: opts.dryRun });
      if (res.status === 'sent') summary.sent += 1;
      else if (res.status === 'failed') { summary.failed += 1; summary.failures.push(user.email); }
      else summary.skipped += 1;
      if (res.metrics) console.log(`[monthly-report]   ${res.status.padEnd(8)} ${summariseMetrics(res.metrics)}`);
    } catch (err) {
      summary.failed += 1;
      summary.failures.push(user.email);
      console.error(`[monthly-report]   FAILED ${user.email}: ${err.message}`);
    }
  }

  // Make sure the org report covers everyone, including anyone skipped above
  // because their own email had already gone out.
  const allMetrics = [];
  for (const user of staff) allMetrics.push(await getMetrics(user, ctx, metricsById));

  const adminTargets = wanted ? admins.filter((a) => wanted.has(String(a.email).toLowerCase())) : admins;
  if (adminTargets.length) {
    const org = await sendOrgReports({ ctx, allMetrics, admins: adminTargets, dryRun: opts.dryRun });
    (org.results || []).forEach((r) => {
      if (r.status === 'sent') summary.sent += 1;
      else if (r.status === 'failed') { summary.failed += 1; summary.failures.push(r.user.email); }
      else summary.skipped += 1;
    });
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[monthly-report] ===== ${periodLabel(period)} — done in ${secs}s: `
    + `${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed =====`);
  if (summary.failures.length) console.log(`[monthly-report] Failed: ${summary.failures.join(', ')}`);

  return summary;
}

/**
 * Build (and optionally send) ONE person's report on demand. Backs both the
 * admin re-send endpoint and the test script.
 *
 * @param {object} opts
 * @param {string} opts.email       - whose performance to report on
 * @param {string} [opts.period]
 * @param {string} [opts.sendTo]    - deliver here instead of to the subject
 * @param {boolean}[opts.dryRun]
 * @param {boolean}[opts.isTest]
 */
async function runSingleReport({
  email, userId, period: rawPeriod, sendTo = null, dryRun = false, isTest = false, includeTeam = true,
}) {
  const period = rawPeriod || previousPeriodOf();
  if (!isValidPeriod(period)) throw new Error(`Invalid period "${period}" — expected YYYY-MM.`);

  const select = 'name email role schoolId schoolIds teamId teamIds anonymousLocation';

  // Either identifier works. The Admin's on-demand screen picks people out of a
  // list and so has their id; the test script and the cron work from an email.
  let user = null;
  if (userId) {
    user = await User.findById(userId).select(select).lean();
    if (!user) throw new Error('That staff member no longer exists.');
  } else {
    user = await User.findOne({ email: new RegExp(`^${String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
      .select(select)
      .lean();
    if (!user) throw new Error(`No user found with the email "${email}".`);
  }

  const ctx = await buildContext(period);
  const metricsById = new Map();

  // The Admin and CEO are not measured — they receive the organisation report.
  if (ADMIN_ROLES.includes(user.role)) {
    const staff = await User.find({ role: { $in: reportableRoles() }, email: { $ne: null } })
      .select('name email role schoolId schoolIds teamId teamIds anonymousLocation')
      .sort({ name: 1 })
      .lean();
    const allMetrics = [];
    for (const s of staff) allMetrics.push(await getMetrics(s, ctx, metricsById));
    const org = await sendOrgReports({
      ctx, allMetrics, admins: [user], overrideTo: sendTo, isTest, dryRun,
    });
    return { kind: 'organisation', user, period, allMetrics, ...org };
  }

  if (!reportableRoles().includes(user.role)) {
    throw new Error(
      `${user.name} is a ${ROLE_LABELS[user.role] || user.role}. `
      + 'Performance reports cover IECE field staff only — school logins are never measured.'
    );
  }

  const res = await sendIndividualReport({
    user, ctx, metricsById, overrideTo: sendTo, isTest, dryRun, includeTeam,
  });
  return { kind: 'individual', user, period, ...res };
}

module.exports = {
  runMonthlyReports,
  runSingleReport,
  runTeamReport,
  sendIndividualReport,
  sendOrgReports,
  buildContext,
  collectMetrics,
  summariseMetrics,
  STALE_CLAIM_MINUTES,
};
