#!/usr/bin/env node
/**
 * PHASE 6 — delete the Cloudinary originals. THE ONLY IRREVERSIBLE STEP.
 *
 *   npm run r2:purge-cloudinary -- --dry-run   list what would be deleted
 *   npm run r2:purge-cloudinary -- --confirm   delete it
 *
 * Everything up to now has been reversible because Cloudinary still held every
 * original: a bad flip was one command to undo, and a URL reverted by that
 * command worked the instant it was written. This is where that stops being
 * true. After this runs, R2 is the only copy of your media.
 *
 * SO IT REFUSES TO RUN UNLESS ALL FOUR ARE TRUE
 *
 *   1. Not one live Cloudinary reference remains in the database. Checked
 *      against the application collections themselves, not against the ledger —
 *      the ledger records what the migration believes it did, and the point of
 *      this check is to catch the case where that belief is wrong.
 *
 *   2. Every ledger row is `flipped` or `dangling`. A row still marked
 *      `verified` means a file was copied but never repointed; deleting its
 *      source would strand it.
 *
 *   3. The last flip was at least seven days ago. Not ceremony: a monthly
 *      report, a leave approval, an old activity nobody opened this week — the
 *      app has flows that touch stored files rarely, and a week is what it takes
 *      for most of them to have run at least once.
 *
 *   4. `--confirm` was typed. Dry run is the default, always.
 *
 * A failure of any check is a hard stop, not a warning.
 */

const cloudinary = require('cloudinary').v2;

const { cloudinaryConfig, r2Config, ConfigError } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const { URL_FIELDS, label, filterFor, projectionFor, readField } = require('./lib/urlFields');
const AssetMigration = require('../../models/AssetMigration');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const FORCE_EARLY = args.includes('--force-early');
const MIN_DAYS = (() => {
  const a = args.find((x) => x.startsWith('--days='));
  return a ? Number(a.split('=')[1]) : 7;
})();

// Every folder this app has ever written to. `facial_registrations` is the
// legacy single-registration store; nothing has written to it in a long time,
// but it still holds files.
const FOLDERS = [
  { prefix: 'iece_images', resourceType: 'image' },
  { prefix: 'iece_uploads', resourceType: 'image' },
  { prefix: 'iece_uploads', resourceType: 'video' },
  { prefix: 'iece_mous', resourceType: 'raw' },
  { prefix: 'facial_registrations', resourceType: 'video' },
  { prefix: 'facial_registrations_v2', resourceType: 'video' },
];

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

const blockers = [];

async function checkNoLiveReferences(db, cfg) {
  let total = 0;
  const perField = [];
  for (const spec of URL_FIELDS) {
    const Model = require(`../../models/${spec.model}`);
    const cursor = db.collection(Model.collection.name)
      .find(filterFor(spec), { projection: projectionFor(spec) })
      .batchSize(500);
    let n = 0;
    for await (const doc of cursor) {
      for (const { value } of readField(doc, spec)) {
        if (value.includes('cloudinary.com')) n += 1;
      }
    }
    if (n) perField.push(`${label(spec)}: ${n}`);
    total += n;
  }
  if (total) {
    blockers.push(
      `${total} live Cloudinary reference(s) remain in the database`,
      ...perField.map((p) => `    ${p}`),
      '    Run: npm run r2:flip -- --list'
    );
  }
  return total;
}

async function checkLedgerSettled() {
  const unsettled = await AssetMigration.countDocuments({ status: { $nin: ['flipped', 'dangling'] } });
  if (unsettled) {
    const byStatus = await AssetMigration.aggregate([
      { $match: { status: { $nin: ['flipped', 'dangling'] } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    blockers.push(
      `${unsettled} ledger row(s) are not settled`,
      ...byStatus.map((b) => `    ${b._id}: ${b.n}`),
      '    A row still "verified" was copied but never repointed — deleting its source would strand it.'
    );
  }
  return unsettled;
}

async function checkSoak() {
  const latest = await AssetMigration.findOne({ status: 'flipped' }).sort({ flippedAt: -1 }).lean();
  if (!latest || !latest.flippedAt) {
    blockers.push('No flip has been recorded — there is nothing to have soaked.');
    return null;
  }
  const days = (Date.now() - new Date(latest.flippedAt).getTime()) / 86400000;
  if (days < MIN_DAYS && !FORCE_EARLY) {
    blockers.push(
      `The last flip was ${days.toFixed(1)} day(s) ago; ${MIN_DAYS} are required`,
      '    The app has flows that touch stored files rarely — a monthly report, an old',
      '    activity nobody opened this week. The wait is what lets those run at least once.',
      '    Override only if you are certain: --force-early'
    );
  }
  return days;
}

async function listAccount() {
  const found = [];
  for (const { prefix, resourceType } of FOLDERS) {
    let cursor;
    let n = 0;
    let bytes = 0;
    do {
      const res = await cloudinary.api.resources({
        type: 'upload', resource_type: resourceType, prefix, max_results: 500, next_cursor: cursor,
      });
      for (const r of res.resources || []) { n += 1; bytes += r.bytes || 0; }
      cursor = res.next_cursor;
    } while (cursor);
    if (n) found.push({ prefix, resourceType, count: n, bytes });
  }
  return found;
}

async function main() {
  let cloud;
  try {
    cloud = cloudinaryConfig();
    r2Config({ requireCustomDomain: true });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  cloudinary.config({
    cloud_name: cloud.cloudName, api_key: cloud.apiKey, api_secret: cloud.apiSecret, secure: true,
  });

  console.log('\n  PHASE 6 — PURGE CLOUDINARY');
  console.log(`  account: ${cloud.cloudName}`);
  console.log(`  ${CONFIRM ? 'THIS WILL PERMANENTLY DELETE FILES.' : 'Dry run — nothing will be deleted.'}\n`);

  const connection = await connect();
  const db = connection.db;

  console.log('  Running the safety checks…\n');
  const live = await checkNoLiveReferences(db);
  console.log(`  live Cloudinary references in the database   ${padL(live, 6)}  ${live ? 'BLOCKER' : 'ok'}`);
  const unsettled = await checkLedgerSettled();
  console.log(`  unsettled ledger rows                        ${padL(unsettled, 6)}  ${unsettled ? 'BLOCKER' : 'ok'}`);
  const days = await checkSoak();
  console.log(`  days since the last flip                     ${padL(days === null ? '-' : days.toFixed(1), 6)}  ${days !== null && (days >= MIN_DAYS || FORCE_EARLY) ? 'ok' : 'BLOCKER'}`);

  const line = '  ' + '─'.repeat(74);

  if (blockers.length) {
    console.log(`\n${line}`);
    console.log('  REFUSING TO PURGE\n');
    for (const b of blockers) console.log(`  ${b}`);
    console.log(`\n  Nothing was deleted.`);
    console.log(line + '\n');
    await disconnect();
    process.exit(1);
  }

  console.log('\n  All checks passed.\n');
  console.log('  What the account still holds:\n');
  const found = await listAccount();
  let totalFiles = 0;
  let totalBytes = 0;
  for (const f of found) {
    console.log(`  ${pad(`${f.prefix} (${f.resourceType})`, 40)}${padL(f.count, 7)}   ${(f.bytes / 1048576).toFixed(1)} MB`);
    totalFiles += f.count;
    totalBytes += f.bytes;
  }
  console.log(`  ${pad('TOTAL', 40)}${padL(totalFiles, 7)}   ${(totalBytes / 1048576).toFixed(1)} MB`);

  if (!CONFIRM) {
    console.log(`\n${line}`);
    console.log('  DRY RUN — nothing was deleted.\n');
    console.log(`  ${totalFiles} file(s) would be permanently removed. R2 would become the only`);
    console.log('  copy of your media. There is no undo for this step.');
    console.log('\n  When you are ready:  npm run r2:purge-cloudinary -- --confirm');
    console.log(line + '\n');
    await disconnect();
    process.exit(0);
  }

  console.log(`\n${line}`);
  console.log('  DELETING\n');
  let deleted = 0;
  for (const { prefix, resourceType } of FOLDERS) {
    let more = true;
    let rounds = 0;
    while (more && rounds < 60) {
      const res = await cloudinary.api.delete_resources_by_prefix(prefix, {
        resource_type: resourceType,
        type: 'upload',
        invalidate: true,
      });
      const n = Object.keys(res.deleted || {}).length;
      deleted += n;
      // The API removes up to 1000 per call; `partial` says there is more.
      more = res.partial === true && n > 0;
      rounds += 1;
      if (n) console.log(`  ${pad(`${prefix} (${resourceType})`, 40)}${padL(n, 7)} deleted`);
    }
  }

  const remaining = await listAccount();
  const left = remaining.reduce((n, f) => n + f.count, 0);

  console.log(`\n${line}`);
  console.log(`  ${deleted} file(s) deleted. ${left} remaining in the account.`);
  if (left === 0) {
    console.log('\n  The migration is complete. R2 is now the only home for your media.');
    console.log('  You can close or downgrade the Cloudinary account.');
    console.log('  Remove the CLOUDINARY_* variables from backend/.env once you have.');
  } else {
    console.log('\n  Some files remain — re-run to continue, or check them in the dashboard.');
  }
  console.log(line + '\n');

  await disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(`\n  Purge failed:\n\n  ${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  await disconnect();
  process.exit(1);
});
