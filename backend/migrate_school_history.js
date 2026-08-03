// One-off migration that seeds User.schoolHistory — the record of which
// schools a person has worked at — for users created before the field existed.
//
// For every school a user is currently assigned to (schoolIds) with no open
// history entry, it opens one dated by the EARLIEST real evidence of them
// working there:
//   min(attendance date, activity date, visit report date) at that school,
// falling back to the user's account creation date when there is no evidence.
//
// The migration is idempotent: running it again adds nothing.
//
//   node migrate_school_history.js
//
// Optional: --infer-past
//   Also reconstructs CLOSED stints for schools a user is no longer assigned
//   to but demonstrably worked at (they have attendance/activities/reports
//   there). Assignment dates are unknowable for those, so the stint spans the
//   first to the last piece of evidence. Off by default because it infers
//   history rather than recording it.
//
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns');
const User = require('./models/User');
const School = require('./models/School');
const Attendance = require('./models/Attendance');
const Activity = require('./models/Activity');
const VisitReport = require('./models/VisitReport');

dotenv.config();
if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const inferPast = process.argv.includes('--infer-past');

// Every date on which this user demonstrably worked at each school, keyed by
// school id. Used to date a stint we have no assignment record for.
const evidenceByUser = async (userId) => {
  const [attendance, activities, reports] = await Promise.all([
    Attendance.find({ trainerId: userId }).select('schoolId checkOutSchoolId date createdAt'),
    Activity.find({ $or: [{ uploaderId: userId }, { organizers: userId }] })
      .select('schoolId activityDate createdAt'),
    VisitReport.find({ trainerId: userId }).select('schoolId dateOfInspection createdAt'),
  ]);

  const map = new Map(); // schoolId -> { first: Date, last: Date }
  const add = (schoolId, date) => {
    if (!schoolId || !date) return;
    const key = String(schoolId);
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { first: d, last: d });
      return;
    }
    if (d < existing.first) existing.first = d;
    if (d > existing.last) existing.last = d;
  };

  attendance.forEach((a) => {
    add(a.schoolId, a.date || a.createdAt);
    add(a.checkOutSchoolId, a.date || a.createdAt);
  });
  activities.forEach((a) => add(a.schoolId, a.activityDate || a.createdAt));
  reports.forEach((r) => add(r.schoolId, r.dateOfInspection || r.createdAt));

  return map;
};

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected for school-history migration...');
    if (inferPast) console.log('--infer-past: closed stints will be reconstructed from work evidence.\n');

    const users = await User.find({});
    const schools = await School.find({}).select('name state');
    const schoolById = new Map(schools.map(s => [String(s._id), s]));

    let usersTouched = 0;
    let openedCurrent = 0;
    let openedPast = 0;

    for (const user of users) {
      const history = user.schoolHistory || [];
      const openIds = new Set(history.filter(e => !e.removedAt).map(e => String(e.schoolId)));
      const anyIds = new Set(history.map(e => String(e.schoolId)));
      const currentIds = (user.schoolIds || []).map(String);

      const missingCurrent = currentIds.filter(id => !openIds.has(id));
      const needsEvidence = missingCurrent.length > 0 || inferPast;
      const evidence = needsEvidence ? await evidenceByUser(user._id) : new Map();

      let dirty = false;

      // 1. Open a stint for every school they hold today but have no record of.
      for (const id of missingCurrent) {
        const school = schoolById.get(id);
        const firstSeen = evidence.get(id)?.first;
        history.push({
          schoolId: id,
          schoolName: school?.name || null,
          schoolState: school?.state || null,
          assignedAt: firstSeen || user.createdAt || new Date(),
          removedAt: null,
        });
        openedCurrent += 1;
        dirty = true;
      }

      // 2. Optionally reconstruct schools they have left but clearly worked at.
      if (inferPast) {
        for (const [id, span] of evidence.entries()) {
          if (currentIds.includes(id) || anyIds.has(id)) continue;
          const school = schoolById.get(id);
          history.push({
            schoolId: id,
            schoolName: school?.name || null,
            schoolState: school?.state || null,
            assignedAt: span.first,
            removedAt: span.last,
            removedReason: 'unassigned',
          });
          openedPast += 1;
          dirty = true;
        }
      }

      if (dirty) {
        user.schoolHistory = history;
        // The pre-save hook only fires on schoolIds changes, which this is not,
        // so the entries written above are saved exactly as built.
        await user.save();
        usersTouched += 1;
      }
    }

    console.log('\n--- School history migration complete ---');
    console.log(`Users updated:              ${usersTouched}`);
    console.log(`Current stints recorded:    ${openedCurrent}`);
    if (inferPast) console.log(`Past stints reconstructed:  ${openedPast}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

run();
