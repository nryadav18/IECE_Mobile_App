#!/usr/bin/env node
/**
 * HOUSEKEEPING — clear database references to files that no longer exist.
 *
 *   npm run r2:clear-dangling -- --dry-run    say what would change
 *   npm run r2:clear-dangling                 do it
 *
 * Not part of the migration. Nothing depends on it and skipping it changes
 * nothing a user can see.
 *
 * WHAT THESE REFERENCES ARE
 *
 * A facial registration video is a temporary artefact by design: the ML service
 * turns it into an embedding, the Admin watches it once to decide, and
 * utils/faceVideo.js then deletes it — because the embedding is what every
 * check-in is matched against, and the video is a person's face sitting in a
 * third-party account serving no further purpose.
 *
 * That deletion normally clears the URL field too. In 60 cases it did not: the
 * file went, the string stayed. The Phase 0 audit found every one of them, and
 * confirmed all 60 belong to registrations that are already APPROVED, on users
 * who all have a usable embedding. No pending registration is affected and no
 * screen is broken — the app shows registration STATUS, not the recording.
 *
 * So this is not a repair. It is stopping the database from claiming a file
 * exists when it does not, so that future audits report zero dangling
 * references instead of 60 that somebody has to remember are expected.
 *
 * SAFETY
 *
 * Only fields whose ledger row says `dangling` are touched, and each one is
 * re-checked against Cloudinary immediately before it is cleared. A URL that
 * turns out to still resolve is left completely alone and reported — that would
 * mean the audit was wrong, and clearing a reference to a file that exists is
 * exactly the mistake worth refusing to make.
 */

const { cloudinaryConfig, ConfigError } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const AssetMigration = require('../../models/AssetMigration');
const User = require('../../models/User');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const padL = (s, n) => String(s).padStart(n);

async function main() {
  try {
    cloudinaryConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  console.log('\n  CLEAR DANGLING FACE-VIDEO REFERENCES');
  console.log(`  ${DRY_RUN ? 'DRY RUN — nothing will be written.' : 'Clearing stale URL strings. No file is deleted; the files are already gone.'}\n`);

  await connect();

  const dangling = await AssetMigration.find({ status: 'dangling' }).lean();
  console.log(`  ${dangling.length} reference(s) marked dangling in the ledger.\n`);
  if (!dangling.length) {
    console.log('  Nothing to do.\n');
    await disconnect();
    process.exit(0);
  }

  // Re-check before clearing. The audit ran earlier; a file could in principle
  // have been restored since, and clearing the only pointer to a file that
  // exists is not recoverable.
  process.stdout.write('  Re-checking each source is really gone');
  const gone = [];
  const stillThere = [];
  let n = 0;
  for (const row of dangling) {
    try {
      const res = await fetch(row.oldUrl, { method: 'HEAD' });
      if (res.status === 404 || res.status === 410) gone.push(row);
      else stillThere.push({ row, status: res.status });
    } catch {
      // Could not check. Not evidence either way, so leave it alone.
      stillThere.push({ row, status: 'unreachable' });
    }
    n += 1;
    if (n % 10 === 0) process.stdout.write('.');
  }
  console.log(` ${gone.length} confirmed gone, ${stillThere.length} not cleared.`);

  if (stillThere.length) {
    console.log('\n  NOT CLEARED (the source answered, or could not be checked):');
    for (const s of stillThere.slice(0, 10)) console.log(`    ${s.status}  ${s.row.oldUrl}`);
    if (stillThere.length > 10) console.log(`    … and ${stillThere.length - 10} more`);
  }

  if (DRY_RUN) {
    console.log(`\n  DRY RUN — ${gone.length} reference(s) would be cleared across:`);
    const byField = {};
    for (const row of gone) {
      for (const use of row.uses) byField[use.field] = (byField[use.field] || 0) + 1;
    }
    for (const f in byField) console.log(`    ${padL(byField[f], 4)}  ${f}`);
    console.log('\n  Re-run without --dry-run to apply.\n');
    await disconnect();
    process.exit(0);
  }

  // Both fields are on User, and both are matched on the exact stale value so a
  // registration re-recorded since the audit cannot be wiped by accident.
  const ops = [];
  const { ObjectId } = require('mongoose').Types;
  for (const row of gone) {
    for (const use of row.uses) {
      const _id = new ObjectId(use.recordId);
      if (use.field === 'User.registrationPhotoUrl') {
        ops.push({ updateOne: { filter: { _id, registrationPhotoUrl: row.oldUrl }, update: { $set: { registrationPhotoUrl: null } } } });
      } else if (use.field === 'User.faceRegistrations[].registrationPhotoUrl') {
        ops.push({
          updateOne: {
            filter: { _id, 'faceRegistrations.registrationPhotoUrl': row.oldUrl },
            update: { $set: { 'faceRegistrations.$[el].registrationPhotoUrl': null } },
            arrayFilters: [{ 'el.registrationPhotoUrl': row.oldUrl }],
          },
        });
      }
    }
  }

  const result = await User.collection.bulkWrite(ops, { ordered: false });
  await AssetMigration.updateMany(
    { _id: { $in: gone.map((r) => r._id) } },
    { $set: { error: 'source gone; database reference cleared' } }
  );

  console.log(`\n  matched ${result.matchedCount}, modified ${result.modifiedCount}, of ${ops.length} reference(s).`);
  console.log('\n  The recordings were already deleted; only the stale strings are gone.');
  console.log('  Facial attendance is unaffected — it matches against the stored embedding.\n');

  await disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(`\n  Failed:\n\n  ${error.message}\n`);
  await disconnect();
  process.exit(1);
});
