#!/usr/bin/env node
/**
 * WHERE THE MIGRATION STANDS, IN ONE COMMAND.
 *
 *   npm run r2:status
 *
 * READ-ONLY. The thing to run during the seven-day watch, and the thing to read
 * before deciding Phase 6 is safe.
 *
 * It answers the only question that actually matters at this stage — "is
 * anything still depending on Cloudinary?" — by counting live references in the
 * application collections themselves, not by trusting the ledger. The ledger
 * says what the migration BELIEVES it did; the collections say what is true.
 */

const { r2Config, cloudinaryConfig } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const { URL_FIELDS, label, filterFor, projectionFor, readField } = require('./lib/urlFields');
const AssetMigration = require('../../models/AssetMigration');

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const bytesHuman = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};

async function main() {
  let cfg = null;
  try { cfg = r2Config(); } catch { /* status is still useful without it */ }
  let cloud = null;
  try { cloud = cloudinaryConfig(); } catch { /* likewise */ }

  const connection = await connect();
  const db = connection.db;

  console.log('\n  MIGRATION STATUS');
  console.log(`  ${db.databaseName}  ->  ${cfg ? cfg.publicBaseUrl : '(R2 not configured)'}\n`);

  const line = '  ' + '─'.repeat(74);
  console.log(`  ${pad('field', 46)}${padL('cloudinary', 12)}${padL('r2', 8)}${padL('other', 8)}`);
  console.log(line);

  let totalCloud = 0;
  let totalR2 = 0;
  let totalOther = 0;

  for (const spec of URL_FIELDS) {
    const Model = require(`../../models/${spec.model}`);
    const cursor = db.collection(Model.collection.name)
      .find(filterFor(spec), { projection: projectionFor(spec) })
      .batchSize(500);

    let cl = 0;
    let r2 = 0;
    let other = 0;
    for await (const doc of cursor) {
      for (const { value } of readField(doc, spec)) {
        if (value.includes('cloudinary.com')) cl += 1;
        else if (cfg && (value.startsWith(cfg.publicBaseUrl) || value.startsWith('r2:'))) r2 += 1;
        else other += 1;
      }
    }
    totalCloud += cl; totalR2 += r2; totalOther += other;
    const flag = cl > 0 ? '  <-- still on Cloudinary' : '';
    console.log(`  ${pad(label(spec), 46)}${padL(cl, 12)}${padL(r2, 8)}${padL(other, 8)}${flag}`);
  }

  console.log(line);
  console.log(`  ${pad('TOTAL', 46)}${padL(totalCloud, 12)}${padL(totalR2, 8)}${padL(totalOther, 8)}`);

  // ---- the ledger's own view -------------------------------------------
  const counts = await AssetMigration.aggregate([
    { $group: { _id: '$status', n: { $sum: 1 }, bytes: { $sum: '$bytes' } } },
  ]);
  if (counts.length) {
    console.log('\n  LEDGER\n');
    for (const c of counts.sort((a, b) => a._id.localeCompare(b._id))) {
      console.log(`  ${pad(c._id, 20)}${padL(c.n, 6)}   ${bytesHuman(c.bytes)}`);
    }
  }

  console.log(`\n${line}`);
  if (totalCloud === 0) {
    console.log('  NO LIVE CLOUDINARY REFERENCES.\n');
    console.log('  Every URL the app can reach now points at R2. Phase 6 may proceed once');
    console.log('  this has held for seven days:');
    console.log('    npm run r2:purge-cloudinary -- --dry-run');
    if (cloud) console.log(`\n  The account (${cloud.cloudName}) still holds every original until then.`);
  } else {
    console.log(`  ${totalCloud} REFERENCE(S) STILL POINT AT CLOUDINARY.\n`);
    console.log('  The account cannot be closed. Run the remaining flip steps:');
    console.log('    npm run r2:flip -- --list');
  }
  console.log(`${line}\n`);

  await disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(`\n  Status failed:\n\n  ${error.message}\n`);
  await disconnect();
  process.exit(1);
});
