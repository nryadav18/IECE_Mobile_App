/* eslint-disable no-console */
//
// ===========================================================================
//  MONTHLY PERFORMANCE REPORT — TEST HARNESS
// ===========================================================================
//
//  Builds one real monthly report from live data and emails it wherever you
//  tell it to, so you can check the PDF and the email template before the cron
//  sends them to the whole organisation on the 1st.
//
//  This is a TEST TOOL. It never consumes a real send: everything it writes to
//  the delivery log is flagged `isTest`, so testing August does not stop
//  August's genuine report from going out on 1 September.
//
//  ---------------------------------------------------------------------
//  HOW TO RUN
//  ---------------------------------------------------------------------
//
//    cd backend
//    node scripts/testMonthlyReport.js
//
//  Either edit the CONFIG block below, or override any of it on the command
//  line (the flags win over the constants):
//
//    node scripts/testMonthlyReport.js --user=ramesh@iece.com --to=you@gmail.com
//    node scripts/testMonthlyReport.js --month=2026-07
//    node scripts/testMonthlyReport.js --dry               # build, don't send
//    node scripts/testMonthlyReport.js --save              # also write the PDF to disk to eyeball it
//    node scripts/testMonthlyReport.js --list              # who can I test with?
//
//  --save is for local inspection ONLY. Nothing in the real feature ever
//  writes a PDF to disk; the file it drops is yours to delete.
//
//  Requires the same .env the server uses (MONGO_URI and BREVO_API_KEY). With
//  no BREVO_API_KEY the script still builds the PDF and prints every number —
//  it just logs the email instead of sending it, which is a perfectly good way
//  to check the maths without spending a send.
//
// ===========================================================================

const dns = require('dns');
// Same workaround server.js applies: some local networks refuse the SRV lookup
// a mongodb+srv:// connection string needs, which surfaces as
// "querySrv ECONNREFUSED". Forcing Google DNS off production makes the script
// connect wherever the server itself can.
if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

// ===========================================================================
//  CONFIG — edit these three, or pass --user / --to / --month instead
// ===========================================================================

// Whose performance to build the report from. Must be an IECE staff login
// (trainer, team leader, trainee team leader, or any head). Give an Admin or
// CEO email instead and you will get the organisation-wide report.
const SUBJECT_EMAIL = 'trainer@iece.com';

// Where to deliver it. This is a TEST address — the real person is not emailed.
const SEND_TO = 'kirankumarilm@gmail.com';

// Which month to report on, as 'YYYY-MM'. null = the month that just ended,
// which is exactly what the cron would send.
const MONTH = null;

// true = build the PDF and print the numbers, but send nothing.
const DRY_RUN = false;

// ===========================================================================

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

const subjectEmail = flag('user') || SUBJECT_EMAIL;
const sendTo = flag('to') || SEND_TO;
const month = flag('month') || MONTH;
const dryRun = flag('dry') === true || DRY_RUN;
const savePdf = flag('save') === true;
const listOnly = flag('list') === true;

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m',
};
const ok = (s) => console.log(`${c.green}  OK${c.reset}  ${s}`);
const bad = (s) => console.log(`${c.red} ERR${c.reset}  ${s}`);
const info = (s) => console.log(`${c.cyan}   ·${c.reset}  ${s}`);
const rule = () => console.log(`${c.grey}${'─'.repeat(68)}${c.reset}`);
const head = (s) => { rule(); console.log(`${c.bold}${s}${c.reset}`); rule(); };

/** Aligned "label ... value" line. */
const kv = (label, value, note = '') => {
  const l = String(label).padEnd(26, ' ');
  const v = String(value).padStart(8, ' ');
  console.log(`      ${c.grey}${l}${c.reset}${c.bold}${v}${c.reset}${note ? `  ${c.grey}${note}${c.reset}` : ''}`);
};

async function main() {
  head('IECE — Monthly Performance Report · TEST HARNESS');

  if (!process.env.MONGO_URI) {
    bad('MONGO_URI is not set. Check backend/.env.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  ok(`Connected to MongoDB (${mongoose.connection.name})`);

  // Requires come AFTER the connection so model registration is clean.
  const User = require('../models/User');
  const { reportableRoles } = require('../utils/monthlyReport/metrics');
  const { runSingleReport } = require('../utils/monthlyReport');
  const {
    previousPeriodOf, periodLabel, formatMinutes, formatDuration,
  } = require('../utils/monthlyReport/period');
  const { ROLE_LABELS } = require('../utils/roleLabels');

  // ---- --list: show who is available to test with --------------------------
  if (listOnly) {
    const staff = await User.find({ role: { $in: reportableRoles() } })
      .select('name email role').sort({ role: 1, name: 1 }).lean();
    head(`Staff you can test with (${staff.length})`);
    staff.forEach((u) => console.log(
      `      ${c.bold}${String(u.email).padEnd(34)}${c.reset}${c.grey}${u.name} — ${ROLE_LABELS[u.role] || u.role}${c.reset}`,
    ));
    const admins = await User.find({ role: { $in: ['creator_admin', 'ceo'] } })
      .select('name email role').lean();
    head(`Admin / CEO logins (these get the organisation-wide report)`);
    admins.forEach((u) => console.log(
      `      ${c.bold}${String(u.email).padEnd(34)}${c.reset}${c.grey}${u.name} — ${ROLE_LABELS[u.role] || u.role}${c.reset}`,
    ));
    await mongoose.disconnect();
    return;
  }

  const period = month || previousPeriodOf();

  info(`Subject      ${c.bold}${subjectEmail}${c.reset}`);
  info(`Deliver to   ${c.bold}${sendTo}${c.reset}`);
  info(`Month        ${c.bold}${periodLabel(period)}${c.reset} ${c.grey}(${period})${c.reset}`);
  info(`Mode         ${dryRun ? `${c.yellow}DRY RUN — nothing will be sent${c.reset}` : 'live send'}`);
  if (!process.env.BREVO_API_KEY) {
    info(`${c.yellow}No BREVO_API_KEY — the PDF is still built and reported, the email is only logged.${c.reset}`);
  }
  console.log('');

  const t0 = Date.now();
  const result = await runSingleReport({
    email: subjectEmail,
    period,
    sendTo,
    dryRun,
    isTest: true, // never consumes the real monthly send for this person
  });

  // ---- Print every computed number so it can be checked against the app ----
  if (result.kind === 'organisation') {
    head(`Organisation report — ${periodLabel(period)}`);
    const all = result.allMetrics || [];
    kv('Staff covered', all.length);
    kv('Average attendance', `${(all.reduce((s, x) => s + x.attendance.rate, 0) / (all.length || 1)).toFixed(1)}%`);
    kv('Average score', (all.reduce((s, x) => s + x.performance.score, 0) / (all.length || 1)).toFixed(0));
    kv('Activities uploaded', all.reduce((s, x) => s + x.activities.uploaded, 0));
    kv('Total absences', all.reduce((s, x) => s + x.attendance.absentDays, 0));
    console.log('');
    all
      .slice()
      .sort((a, b) => b.performance.score - a.performance.score)
      .forEach((m, i) => console.log(
        `      ${c.grey}${String(i + 1).padStart(3)}.${c.reset} ${String(m.user.name).padEnd(24).slice(0, 24)} `
        + `${c.grey}${String(ROLE_LABELS[m.user.role] || m.user.role).padEnd(20).slice(0, 20)}${c.reset}`
        + `${String(m.performance.score).padStart(4)} ${c.grey}${m.performance.grade.grade}${c.reset}`,
      ));
  } else {
    const m = result.metrics;
    const a = m.attendance;

    head(`${m.user.name} — ${ROLE_LABELS[m.user.role] || m.user.role}`);
    info(`Team    ${m.user.teamName || m.user.teamNames.join(', ') || '—'}`);
    info(`Schools ${m.user.isAnonymous ? 'Anonymous location (no school)' : (m.user.schools.map((s) => s.name).join(', ') || 'none')}`);

    console.log(`\n   ${c.bold}ATTENDANCE${c.reset}`);
    kv('Days in month', a.totalDays);
    kv('Working days', a.workingDays, '(month − Sundays − holidays)');
    kv('Expected days', a.expectedDays, '(working − leave − substituted)');
    kv('Present', a.presentDays);
    kv('Half days', a.partialDays, '(no check-out)');
    kv('Absent', a.absentDays);
    kv('On leave', a.leaveDays);
    kv('School holidays', a.holidayDays);
    kv('Sundays', a.sundayDays);
    kv('On school visit', a.visitDays);
    kv('Covered by substitute', a.substitutedDays);
    kv('Worked as substitute', a.substituteDutyDays);
    kv('Extra days worked', a.extraDaysWorked, '(Sunday / holiday)');
    if (a.upcomingDays) kv('Not yet occurred', a.upcomingDays, `${c.yellow}month still in progress — excluded${c.reset}`);
    kv('Attendance rate', `${a.rate.toFixed(1)}%`);

    console.log(`\n   ${c.bold}ACTIVITIES${c.reset}`);
    kv('Uploaded', m.activities.uploaded);
    kv('  approved', m.activities.approved);
    kv('  pending', m.activities.pending);
    kv('  rejected', m.activities.rejected);
    kv('As tagged organiser', m.activities.asOrganizer);
    kv('Star activities', m.activities.starred);
    m.activities.list.slice(0, 12).forEach((x) => console.log(
      `      ${c.grey}· ${String(x.name).slice(0, 40).padEnd(42)}${x.schoolName.slice(0, 18).padEnd(20)}${x.status}${c.reset}`,
    ));
    if (m.activities.list.length > 12) console.log(`      ${c.grey}· … ${m.activities.list.length - 12} more${c.reset}`);

    console.log(`\n   ${c.bold}FIELD WORK${c.reset}`);
    kv('School visits', m.schoolVisits.completed, `${m.schoolVisits.days} day(s)`);
    kv('Visit reports filed', m.visitReports.filed, `${m.visitReports.approved} approved`);
    kv('Reports about them', m.visitReports.received);

    console.log(`\n   ${c.bold}HOURS & ENGAGEMENT${c.reset}`);
    kv('Average check-in', formatMinutes(m.punctuality.avgCheckIn));
    kv('Average check-out', formatMinutes(m.punctuality.avgCheckOut));
    kv('Total on duty', formatDuration(m.punctuality.totalMinutes));
    kv('On time', `${m.punctuality.onTimeDays}/${m.punctuality.ratedDays}`, `${m.punctuality.lateDays} late`);
    kv('Meetings posted', m.meetings.posted);
    kv('Media uploaded', m.media.uploaded);
    if (m.approvals.total) {
      kv('Approvals actioned', m.approvals.total,
        m.approvals.avgTurnaroundHours === null ? '' : `avg ${m.approvals.avgTurnaroundHours.toFixed(1)}h`);
    }

    console.log(`\n   ${c.bold}SCORE${c.reset}`);
    m.performance.dimensions.forEach((d) => kv(
      `${d.label} (${d.weight.toFixed(0)}%)`, d.points.toFixed(1), d.basis,
    ));
    kv('TOTAL', `${m.performance.score}/100`, `${m.performance.grade.grade} — ${m.performance.grade.label}`);
  }

  // ---- Outcome --------------------------------------------------------------
  rule();
  const pdf = result.pdf;
  if (pdf) {
    ok(`PDF built — ${(pdf.length / 1024).toFixed(0)} KB`);
    if (savePdf) {
      const out = path.join(__dirname, '..', result.fileName || `test-report-${period}.pdf`);
      fs.writeFileSync(out, pdf);
      ok(`Saved for inspection: ${out}`);
      info(`${c.yellow}This file is from --save only. The real feature never writes a PDF to disk.${c.reset}`);
    }
  }

  const status = result.status || (result.results && result.results[0] && result.results[0].status);
  if (dryRun) {
    console.log(`${c.yellow}  DRY${c.reset}  Nothing was sent.`);
  } else if (status === 'sent' || status === undefined) {
    ok(`Email sent to ${c.bold}${sendTo}${c.reset}`);
  } else {
    bad(`Send finished with status "${status}". Check the Brevo output above.`);
  }
  info(`Finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  rule();

  await mongoose.disconnect();
}

main().catch(async (err) => {
  bad(err.message);
  if (process.env.DEBUG) console.error(err.stack);
  else console.log(`${c.grey}      Run again with DEBUG=1 for the full stack trace.${c.reset}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
