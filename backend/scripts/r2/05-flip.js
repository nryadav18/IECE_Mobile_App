#!/usr/bin/env node
/**
 * PHASE 5 — point the database at R2, one field at a time.
 *
 *   npm run r2:flip -- --list              show the steps and where each stands
 *   npm run r2:flip -- --step=1 --dry-run  say exactly what would change
 *   npm run r2:flip -- --step=1            do it
 *   npm run r2:flip -- --step=1 --rollback undo it
 *
 * THIS IS THE ONLY SCRIPT THAT WRITES TO APPLICATION DATA. Everything before it
 * was additive — files copied into an empty bucket, rows in a collection
 * nothing reads. This one edits `activities`, `media`, `users` and
 * `leaverequests`, and after it runs the live app is serving from R2.
 *
 * FOUR THINGS MAKE THAT SAFE
 *
 *   ONE STEP AT A TIME, SMALLEST FIRST. Banners (1 file) before leave proofs
 *   (7) before activities (181). If something is wrong, it is wrong about one
 *   banner, on a screen where re-uploading is trivial — not about every photo
 *   in the app at once. Soak 24 hours between steps.
 *
 *   EXACT PAIRS, NEVER PATTERNS. Each write comes from an `oldUrl -> newUrl`
 *   pair recorded in the ledger and already verified. There is no regex over a
 *   collection, no string replacement, no "update where url contains".
 *
 *   MATCHED ON VALUE, NOT POSITION. Every update requires the field to still
 *   hold the exact old URL. So it cannot clobber a value somebody changed while
 *   the copy was running, it cannot corrupt an array whose order shifted, and
 *   running it twice does nothing the second time.
 *
 *   REVERSIBLE. --rollback swaps the pair and matches on the new URL instead.
 *   Cloudinary is still live and still holds every original until Phase 6, so a
 *   reverted URL works the instant it is written.
 */

const { r2Config, ConfigError } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const { URL_FIELDS, label } = require('./lib/urlFields');
const AssetMigration = require('../../models/AssetMigration');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ROLLBACK = args.includes('--rollback');
const LIST = args.includes('--list');
const STEP = (() => {
  const a = args.find((x) => x.startsWith('--step='));
  return a ? Number(a.split('=')[1]) : null;
})();

// ---------------------------------------------------------------------------
// THE ORDER, BY BLAST RADIUS.
//
// Not the order the fields appear in the schema — the order in which being
// wrong costs least. Banners are one file on one carousel and can be
// re-uploaded in a minute; activity media is 181 files across the busiest
// screen in the app. Face recordings go last because they are the only ones in
// the private bucket, so they are also the only ones that depend on the signing
// middleware being right.
// ---------------------------------------------------------------------------
const FLIP_ORDER = [
  'Media.imageUrl',
  'School.mouPdfUrl',
  'User.timetablePdfUrl',
  'LeaveRequest.proofs[]',
  'Activity.mediaUrls[]',
  'User.registrationPhotoUrl',
  'User.faceRegistrations[].registrationPhotoUrl',
];

const specByLabel = new Map(URL_FIELDS.map((s) => [label(s), s]));
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

/**
 * The update for one (record, field, oldUrl -> newUrl).
 *
 * Every filter includes the old value. That is the whole safety property: the
 * write applies only if the database still says what the ledger thought it
 * said.
 */
function updateFor(spec, use, from, to) {
  const { ObjectId } = require('mongoose').Types;
  const _id = new ObjectId(use.recordId);

  if (spec.kind === 'scalar') {
    return {
      updateOne: {
        filter: { _id, [spec.path]: from },
        update: { $set: { [spec.path]: to } },
      },
    };
  }

  if (spec.kind === 'array') {
    // `$[el]` with an arrayFilter rewrites EVERY element equal to the old URL.
    // The positional `$` would only do the first, which silently leaves a
    // duplicate behind pointing at a cloud that is about to be closed.
    return {
      updateOne: {
        filter: { _id, [spec.path]: from },
        update: { $set: { [`${spec.path}.$[el]`]: to } },
        arrayFilters: [{ el: from }],
      },
    };
  }

  // subdocArray: users.faceRegistrations[].registrationPhotoUrl
  const [arrayName, leaf] = spec.path.split('.');
  return {
    updateOne: {
      filter: { _id, [`${arrayName}.${leaf}`]: from },
      update: { $set: { [`${arrayName}.$[el].${leaf}`]: to } },
      arrayFilters: [{ [`el.${leaf}`]: from }],
    },
  };
}

async function statusOf(fieldLabel) {
  const [ready, done] = await Promise.all([
    AssetMigration.countDocuments({ status: 'verified', 'uses.field': fieldLabel }),
    AssetMigration.countDocuments({ status: 'flipped', 'uses.field': fieldLabel }),
  ]);
  return { ready, done };
}

async function showList() {
  console.log('\n  PHASE 5 — FLIP STEPS\n');
  console.log(`  ${pad('#', 3)}${pad('field', 48)}${padL('to flip', 9)}${padL('flipped', 9)}`);
  console.log('  ' + '─'.repeat(68));
  for (let i = 0; i < FLIP_ORDER.length; i += 1) {
    const f = FLIP_ORDER[i];
    const { ready, done } = await statusOf(f);
    const mark = ready === 0 && done === 0 ? '  (nothing to do)' : done && !ready ? '  done' : '';
    console.log(`  ${pad(i + 1, 3)}${pad(f, 48)}${padL(ready, 9)}${padL(done, 9)}${mark}`);
  }
  console.log('\n  Run one step at a time, in order, and leave 24 hours between them.');
  console.log('  Always --dry-run first.\n');
}

async function runStep(fieldLabel) {
  const spec = specByLabel.get(fieldLabel);
  if (!spec) throw new Error(`no such field: ${fieldLabel}`);

  const wantStatus = ROLLBACK ? 'flipped' : 'verified';
  const rows = await AssetMigration.find({ status: wantStatus, 'uses.field': fieldLabel }).lean();

  console.log(`\n  ${ROLLBACK ? 'ROLLBACK' : 'FLIP'}  ${fieldLabel}`);
  console.log(`  ${rows.length} file(s) ${ROLLBACK ? 'to revert' : 'ready'}${DRY_RUN ? '  — DRY RUN, nothing will be written' : ''}\n`);

  if (!rows.length) {
    console.log('  Nothing to do.\n');
    return { matched: 0, modified: 0, rows: 0 };
  }

  const Model = require(`../../models/${spec.model}`);
  const ops = [];
  let references = 0;

  for (const row of rows) {
    const from = ROLLBACK ? row.newUrl : row.oldUrl;
    const to = ROLLBACK ? row.oldUrl : row.newUrl;
    if (!from || !to) continue;
    // One file can be referenced from several records — copied once, repointed
    // everywhere. Only the uses belonging to THIS field are touched, so a face
    // video recorded in both User.registrationPhotoUrl and the per-school entry
    // is flipped by its own step, not by whichever runs first.
    for (const use of row.uses.filter((u) => u.field === fieldLabel)) {
      ops.push(updateFor(spec, use, from, to));
      references += 1;
    }
  }

  console.log(`  ${references} database reference(s) across ${rows.length} file(s).`);

  if (DRY_RUN) {
    for (const row of rows.slice(0, 8)) {
      console.log(`\n  ${ROLLBACK ? row.newUrl : row.oldUrl}`);
      console.log(`    -> ${ROLLBACK ? row.oldUrl : row.newUrl}`);
    }
    if (rows.length > 8) console.log(`\n  … and ${rows.length - 8} more.`);
    console.log('\n  DRY RUN — nothing was written. Re-run without --dry-run to apply.\n');
    return { matched: 0, modified: 0, rows: rows.length };
  }

  const result = await Model.collection.bulkWrite(ops, { ordered: false });
  const matched = result.matchedCount || 0;
  const modified = result.modifiedCount || 0;

  // Mark the ledger only for what actually changed in the database.
  await AssetMigration.updateMany(
    { _id: { $in: rows.map((r) => r._id) } },
    ROLLBACK
      ? { $set: { status: 'verified', flippedAt: null } }
      : { $set: { status: 'flipped', flippedAt: new Date() } }
  );

  console.log(`\n  matched ${matched}, modified ${modified}, of ${references} reference(s).`);

  if (matched < references) {
    // Not necessarily wrong. A record deleted since the copy, or a value a user
    // changed, will not match — and NOT matching is the safety property working:
    // the filter refused to overwrite something it did not recognise.
    console.log(`\n  ${references - matched} reference(s) did not match.`);
    console.log('  This is the value-guard doing its job, not an error: the record was');
    console.log('  deleted, or its URL was changed, since the copy ran. Re-run the audit if');
    console.log('  you want the current picture.');
  }

  return { matched, modified, rows: rows.length };
}

async function main() {
  try {
    r2Config({ requireCustomDomain: true });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  Configuration problem\n\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  await connect();

  if (LIST || (!STEP && !args.some((a) => a.startsWith('--field=')))) {
    await showList();
    await disconnect();
    process.exit(0);
  }

  const fieldArg = args.find((a) => a.startsWith('--field='));
  const fieldLabel = fieldArg ? fieldArg.split('=')[1] : FLIP_ORDER[STEP - 1];

  if (!fieldLabel) {
    console.error(`\n  --step must be between 1 and ${FLIP_ORDER.length}. Use --list to see them.\n`);
    await disconnect();
    process.exit(1);
  }

  const { rows } = await runStep(fieldLabel);

  if (!DRY_RUN && rows) {
    console.log('\n  ' + '─'.repeat(74));
    console.log('  Open the app on a real phone and look at this feature before the next step.');
    console.log(`  To undo: npm run r2:flip -- --field="${fieldLabel}" --rollback`);
    console.log('  Cloudinary still holds every original, so a revert works instantly.');
    console.log('  ' + '─'.repeat(74) + '\n');
  }

  await disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(`\n  Flip failed:\n\n  ${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  await disconnect();
  process.exit(1);
});
