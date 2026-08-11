/**
 * ---------------------------------------------------------------------------
 *  IECE — Sample Credentials Seeder
 * ---------------------------------------------------------------------------
 *  Creates a full, realistic sample hierarchy for every role in the app and
 *  prints an easy-to-read map of the org + all login emails.
 *
 *  What it creates:
 *    • 1 Admin (creator_admin)          • 1 CEO
 *    • 3 Heads   → 1 Cluster, 1 Regional, 1 Zonal
 *    • 6 Teams   → 2 under each Head (sample team names)
 *    • Per team  → 1 Team Leader + 1 Trainee Team Leader + 4 Trainers
 *                  (Team Leader manages 2 trainers, Trainee Team Leader the other 2)
 *    • Sample Chairmen (schools legally require a chairman) + Sample Schools
 *      - "shared" teams: all 4 trainers share ONE school
 *      - "individual" teams: each trainer gets their OWN school
 *      - one specific trainer is mapped to MULTIPLE schools
 *
 *  Every login uses the SAME password:  Sample@2026
 *  Every email starts with:             sample_...
 *
 *  Run it from the backend folder:   node scripts/seedSampleData.js
 *  (It is idempotent — re-running wipes previous "sample_" data and rebuilds.)
 * ---------------------------------------------------------------------------
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Force public DNS so the mongodb+srv:// SRV lookup resolves (the local resolver
// refuses querySrv on some networks). Mirrors the workaround in server.js.
const dns = require('dns');
if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const mongoose = require('mongoose');
const User = require('../models/User');
const Team = require('../models/Team');
const School = require('../models/School');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PASSWORD = 'Sample@2026';
const DOMAIN = 'sample.com';
const email = (local) => `${local}@${DOMAIN}`.toLowerCase();

const STATES = ['Kerala', 'Tamil Nadu', 'Karnataka', 'Andhra Pradesh', 'Telangana', 'Maharashtra'];
const ASSOC_YEARS = ['1st-year', '2nd-year', '3rd-year'];
// Neutral school-name pool — NO team names / "shared" wording, since chairman
// (school) logins can see school names and must never see team terminology.
const SCHOOL_NAMES = [
  'Green Valley', 'Sunrise', 'Riverside', 'Silver Oak', 'Maple Grove', 'Lotus',
  'Blue Ridge', 'Hillside', 'Cedar Park', 'Meadow Brook', 'Pinewood', 'Crescent',
  'Harmony', 'Evergreen', 'Bright Future', 'Unity', 'Horizon', 'Springfield',
  'Lakeview', 'Grand Vista', 'Rosewood', 'Golden Gate', 'Whitefield', 'Eastwood',
];

// Little ANSI helpers for a readable console report.
const A = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const paint = (color, s) => `${color}${s}${A.reset}`;

// Collect every created login for the final credentials table.
const allLogins = [];
const track = (role, doc) => { allLogins.push({ role, name: doc.name, email: doc.email }); return doc; };

// create() runs the schema's save hooks (so the password gets hashed).
async function createUser(fields) {
  const doc = await User.create({ password: PASSWORD, ...fields });
  return track(fields.role, doc);
}

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------
async function seed() {
  if (!process.env.MONGO_URI) {
    console.error(paint(A.red, '✖ MONGO_URI is not set. Add it to backend/.env before running.'));
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(paint(A.green, `✔ Connected to MongoDB (${mongoose.connection.host})`));

  // --- Clean previous sample data so re-runs stay idempotent ---
  const delUsers = await User.deleteMany({ email: /^sample_/i });
  const delTeams = await Team.deleteMany({ name: /^Sample Team/i });
  const delSchools = await School.deleteMany({ name: /^Sample /i });
  console.log(paint(A.gray, `  cleaned previous sample data → ${delUsers.deletedCount} users, ${delTeams.deletedCount} teams, ${delSchools.deletedCount} schools`));

  // --- School factory (needs a chairman; assigns round-robin) ---
  const chairmen = [];
  for (let i = 1; i <= 3; i++) {
    chairmen.push(await createUser({ name: `Sample Chairman ${i}`, email: email(`sample_chairman${i}`), role: 'chairman' }));
  }

  let schoolCount = 0;
  let chairIdx = 0;
  // Neutral, unique school name — no team/allocation terminology. The `label`
  // argument is intentionally ignored (kept for call-site readability only).
  const createSchool = async () => {
    const chairman = chairmen[chairIdx++ % chairmen.length];
    const base = SCHOOL_NAMES[schoolCount % SCHOOL_NAMES.length];
    schoolCount += 1;
    return School.create({
      name: `Sample ${base} Public School ${schoolCount}`,
      chairmanId: chairman._id,
      associationYear: ASSOC_YEARS[schoolCount % ASSOC_YEARS.length],
      classCoverage: '8th to 10th',
      state: STATES[schoolCount % STATES.length],
    });
  };

  // --- Top of the org ---
  const admin = await createUser({ name: 'Sample Admin', email: email('sample_admin1'), role: 'creator_admin' });
  const ceo = await createUser({ name: 'Sample CEO', email: email('sample_ceo1'), role: 'ceo' });

  // --- Three heads ---
  const clusterHead = await createUser({ name: 'Sample Cluster Head', email: email('sample_clusterhead1'), role: 'cluster_head', teamIds: [] });
  const regionalHead = await createUser({ name: 'Sample Regional Head', email: email('sample_regionalhead1'), role: 'regional_head', teamIds: [] });
  const zonalHead = await createUser({ name: 'Sample Zonal Head', email: email('sample_zonalhead1'), role: 'zonal_head', teamIds: [] });

  // --- Team plan: 2 teams under each head; mix of school-allocation models ---
  const teamPlan = [
    { name: 'Sample Team Alpha', head: clusterHead, model: 'shared' },
    { name: 'Sample Team Bravo', head: clusterHead, model: 'individual' },
    { name: 'Sample Team Charlie', head: regionalHead, model: 'shared' },
    { name: 'Sample Team Delta', head: regionalHead, model: 'individual' },
    { name: 'Sample Team Echo', head: zonalHead, model: 'shared' },
    { name: 'Sample Team Foxtrot', head: zonalHead, model: 'individual', special: true }, // holds the multi-school trainer
  ];

  const report = [];
  let trainerNum = 0;

  for (let t = 0; t < teamPlan.length; t++) {
    const plan = teamPlan[t];
    const teamNo = t + 1;

    const team = await Team.create({ name: plan.name, createdBy: admin._id });

    // A school for the team's leaders (and, for "shared" teams, all trainers too).
    const leaderSchool = await createSchool();

    const teamLeader = await createUser({
      name: `Sample Team Leader ${teamNo}`, email: email(`sample_teamleader${teamNo}`),
      role: 'team_leader', teamId: team._id, schoolIds: [leaderSchool._id],
    });
    const traineeLeader = await createUser({
      name: `Sample Trainee Team Leader ${teamNo}`, email: email(`sample_traineeteamleader${teamNo}`),
      role: 'trainee_team_leader', teamId: team._id, schoolIds: [leaderSchool._id],
    });

    // 4 trainers — first 2 report to the team leader, last 2 to the trainee team leader.
    const trainers = [];
    for (let i = 0; i < 4; i++) {
      trainerNum += 1;
      const managedBy = i < 2 ? teamLeader : traineeLeader;

      let schools;
      if (plan.model === 'shared') {
        schools = [leaderSchool];
      } else if (plan.special && i === 3) {
        // The ONE trainer mapped to multiple schools.
        schools = [
          await createSchool(),
          await createSchool(),
          await createSchool(),
        ];
      } else {
        schools = [await createSchool()];
      }

      const trainer = await createUser({
        name: `Sample Trainer ${trainerNum}`, email: email(`sample_trainer${trainerNum}`),
        role: 'trainer', teamId: team._id, teamLeaderId: managedBy._id,
        schoolIds: schools.map((s) => s._id),
      });

      trainers.push({ trainer, managedBy, schools, multi: schools.length > 1 });
    }

    plan.head.teamIds.push(team._id);
    report.push({ team, plan, teamLeader, traineeLeader, trainers, leaderSchool });
  }

  // Persist each head's team assignments.
  await clusterHead.save();
  await regionalHead.save();
  await zonalHead.save();

  printReport({ admin, ceo, chairmen, heads: [clusterHead, regionalHead, zonalHead], report, schoolCount });

  await mongoose.disconnect();
  console.log(paint(A.green, '\n✔ Done. You can now log in with any email above and password "Sample@2026".\n'));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Pretty report
// ---------------------------------------------------------------------------
function printReport({ admin, ceo, chairmen, heads, report, schoolCount }) {
  const hr = paint(A.gray, '─'.repeat(74));
  const cred = (doc) => `${paint(A.cyan, doc.email)} ${paint(A.gray, '/')} ${paint(A.yellow, PASSWORD)}`;

  console.log('\n' + paint(A.bold + A.magenta, '╔════════════════════════════════════════════════════════════════════════╗'));
  console.log(paint(A.bold + A.magenta, '║                 IECE — SAMPLE CREDENTIALS & HIERARCHY                    ║'));
  console.log(paint(A.bold + A.magenta, '╚════════════════════════════════════════════════════════════════════════╝'));

  console.log('\n' + paint(A.bold, 'TOP-LEVEL OVERSIGHT'));
  console.log(hr);
  console.log(`${paint(A.bold + A.red, 'ADMIN')}  ${admin.name.padEnd(26)} ${cred(admin)}`);
  console.log(`${paint(A.bold + A.red, 'CEO  ')}  ${ceo.name.padEnd(26)} ${cred(ceo)}`);

  console.log('\n' + paint(A.bold, 'CHAIRMEN') + paint(A.gray, '  (school signatories — required so sample schools can exist)'));
  console.log(hr);
  chairmen.forEach((ch) => console.log(`  ${ch.name.padEnd(26)} ${cred(ch)}`));

  console.log('\n' + paint(A.bold, 'ORGANISATION TREE'));
  console.log(hr);

  const headLabel = { cluster_head: 'CLUSTER HEAD', regional_head: 'REGIONAL HEAD', zonal_head: 'ZONAL HEAD' };

  heads.forEach((head, hi) => {
    const headTeams = report.filter((r) => String(r.plan.head._id) === String(head._id));
    const lastHead = hi === heads.length - 1;
    console.log(`\n${paint(A.bold + A.blue, headLabel[head.role])}  ${head.name}   ${cred(head)}`);

    headTeams.forEach((r, ti) => {
      const lastTeam = ti === headTeams.length - 1;
      const teamBranch = lastTeam ? '└─' : '├─';
      const pad = lastTeam ? '   ' : '│  ';
      console.log(paint(A.gray, ` ${teamBranch} `) + paint(A.bold + A.green, `${r.team.name}`) + paint(A.gray, `   (${r.trainers.length} trainers)`));

      // Team Leader group
      const tlTrainers = r.trainers.filter((x) => String(x.managedBy._id) === String(r.teamLeader._id));
      const ttlTrainers = r.trainers.filter((x) => String(x.managedBy._id) === String(r.traineeLeader._id));

      const printLeader = (leaderDoc, roleTag, group, isLastGroup) => {
        const gBranch = isLastGroup ? '└─' : '├─';
        const gPad = isLastGroup ? '   ' : '│  ';
        console.log(paint(A.gray, ` ${pad} ${gBranch} `) + paint(A.bold, `${roleTag}: `) + `${leaderDoc.name}   ${cred(leaderDoc)}`);
        group.forEach((x, xi) => {
          const last = xi === group.length - 1;
          const tBranch = last ? '└─' : '├─';
          const schoolText = x.multi
            ? paint(A.magenta, `${x.schools.length} schools: `) + x.schools.map((s) => s.name).join('  |  ')
            : paint(A.gray, x.schools[0].name);
          console.log(paint(A.gray, ` ${pad} ${gPad} ${tBranch} `) + `${x.trainer.name}  ${cred(x.trainer)}`);
          console.log(paint(A.gray, ` ${pad} ${gPad} ${last ? '   ' : '│  '}    ↳ `) + schoolText);
        });
      };

      printLeader(r.teamLeader, 'Team Leader', tlTrainers, false);
      printLeader(r.traineeLeader, 'Trainee Team Leader', ttlTrainers, true);
    });
  });

  // Full flat credentials table
  console.log('\n' + paint(A.bold, 'ALL LOGINS (flat list)'));
  console.log(hr);
  const roleOrder = ['creator_admin', 'ceo', 'zonal_head', 'regional_head', 'cluster_head', 'team_leader', 'trainee_team_leader', 'trainer', 'chairman'];
  const label = {
    creator_admin: 'Admin', ceo: 'CEO', zonal_head: 'Zonal Head', regional_head: 'Regional Head',
    cluster_head: 'Cluster Head', team_leader: 'Team Leader', trainee_team_leader: 'Trainee TL',
    trainer: 'Trainer', chairman: 'Chairman',
  };
  allLogins
    .slice()
    .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.email.localeCompare(b.email))
    .forEach((l) => {
      console.log(`  ${paint(A.blue, label[l.role].padEnd(14))} ${l.email.padEnd(34)} ${paint(A.yellow, PASSWORD)}`);
    });

  // Summary
  const counts = allLogins.reduce((acc, l) => ((acc[l.role] = (acc[l.role] || 0) + 1), acc), {});
  const multiTrainer = report.flatMap((r) => r.trainers).find((x) => x.multi);
  console.log('\n' + paint(A.bold, 'SUMMARY'));
  console.log(hr);
  console.log(`  Total logins : ${paint(A.bold, allLogins.length)}  ` +
    paint(A.gray, `(admin ${counts.creator_admin}, ceo ${counts.ceo}, heads ${(counts.zonal_head || 0) + (counts.regional_head || 0) + (counts.cluster_head || 0)}, ` +
    `team leaders ${counts.team_leader}, trainee TLs ${counts.trainee_team_leader}, trainers ${counts.trainer}, chairmen ${counts.chairman})`));
  console.log(`  Teams        : ${paint(A.bold, report.length)}  ${paint(A.gray, '(2 under each head)')}`);
  console.log(`  Schools      : ${paint(A.bold, schoolCount)}  ${paint(A.gray, '(shared, per-person, and multi-school mixes)')}`);
  if (multiTrainer) {
    console.log(`  Multi-school : ${paint(A.magenta, multiTrainer.trainer.name)} (${multiTrainer.trainer.email}) → ${multiTrainer.schools.length} schools`);
  }
  console.log(`  Password     : ${paint(A.yellow, PASSWORD)} ${paint(A.gray, '(same for every login)')}`);
}

seed().catch((err) => {
  console.error(paint(A.red, '\n✖ Seeder failed:'), err);
  mongoose.disconnect().finally(() => process.exit(1));
});
