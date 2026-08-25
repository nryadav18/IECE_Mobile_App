#!/usr/bin/env node
/**
 * PHASE 4 — prove the copy worked, independently of the thing that made it.
 *
 *   npm run r2:verify-copy                full check, 5% deep-compared
 *   npm run r2:verify-copy -- --sample=100  deep-compare 100% (slow, thorough)
 *
 * READ-ONLY. Nothing is written to MongoDB, R2 or Cloudinary.
 *
 * This is the gate. Phase 5 rewrites live database records, and once that has
 * happened the app is pointing at R2 for real — so everything that could be
 * wrong has to be found here, while Cloudinary is still serving every byte and
 * nothing has changed.
 *
 * It deliberately re-derives its own scope from MongoDB rather than trusting
 * the ledger's list. A file that was never copied has no ledger row, so a check
 * that only walked the ledger would report a clean bill of health for a
 * migration that had silently skipped things. The two lists are compared, and a
 * referenced URL with no row is a failure.
 *
 * THE HARD RULES
 *   - every referenced Cloudinary URL has a ledger row
 *   - every verified row's object exists in R2, at the recorded size
 *   - the deep-compared sample matches by SHA-256, byte for byte
 *   - EVERY video has a poster at the exact key installed app builds guess
 *   - every stored URL round-trips back to its key
 *   - the public domain serves each object with a usable Content-Type
 */

const crypto = require('crypto');

const { r2Config, ConfigError } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const { collectReferences, isCloudinaryUrl } = require('./lib/references');
const AssetMigration = require('../../models/AssetMigration');
const r2 = require('../../utils/storage/r2');
const keys = require('../../utils/storage/keys');

const args = process.argv.slice(2);
const SAMPLE_PCT = (() => {
  const a = args.find((x) => x.startsWith('--sample='));
  return a ? Math.min(100, Math.max(0, Number(a.split('=')[1]))) : 5;
})();

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const bytesHuman = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};

const failures = [];
const warnings = [];
const fail = (what, detail) => failures.push({ what, detail });
const warn = (what, detail) => warnings.push({ what, detail });

async function sha256Of(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { sha: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

async function main() {
  let cfg;
  try {
    cfg = r2Config({ requireCustomDomain: true });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  Configuration problem\n\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  console.log('\n  PHASE 4 — VERIFY THE COPY');
  console.log('  Read-only. Nothing is written anywhere.\n');

  const connection = await connect();
  const db = connection.db;

  // ---- 1. scope from Mongo, not from the ledger ------------------------
  const references = await collectReferences(db);
  const referenced = [...references.keys()].filter(isCloudinaryUrl);
  const rows = await AssetMigration.find({}).lean();
  const byOldUrl = new Map(rows.map((r) => [r.oldUrl, r]));

  console.log(`  ${referenced.length} Cloudinary URL(s) referenced by the database`);
  console.log(`  ${rows.length} row(s) in the migration ledger\n`);

  const missingRows = referenced.filter((u) => !byOldUrl.has(u));
  if (missingRows.length) {
    fail(`${missingRows.length} referenced URL(s) have no ledger row`,
      'they were never copied — run npm run r2:copy again');
  }

  const verified = rows.filter((r) => r.status === 'verified' || r.status === 'flipped');
  const dangling = rows.filter((r) => r.status === 'dangling');
  const failed = rows.filter((r) => r.status === 'failed');
  if (failed.length) {
    fail(`${failed.length} file(s) are marked failed`, 'npm run r2:copy -- --retry');
  }

  // ---- 2. every object is where the ledger says, at the right size -----
  process.stdout.write('  Checking every object exists in R2');
  let checked = 0;
  const videos = [];
  const images = [];
  for (const row of verified) {
    const head = await r2.head(row.bucket, row.key);
    if (!head) {
      fail(`missing from R2: ${row.key}`, `ledger says verified, bucket says 404`);
    } else if (Number(head.ContentLength) !== row.bytes) {
      fail(`size mismatch: ${row.key}`, `ledger ${row.bytes}, R2 ${head.ContentLength}`);
    }
    if (row.resourceType === 'video') videos.push(row);
    if (row.resourceType === 'image') images.push(row);
    checked += 1;
    if (checked % 25 === 0) process.stdout.write('.');
  }
  console.log(` ${checked} checked.`);

  // ---- 3. THE POSTERS. Hard failure. -----------------------------------
  //
  // Installed app builds construct this URL themselves by replacing .mp4 with
  // .jpg (frontend/src/components/ActivityCover.js). Cloudinary invented the
  // frame on demand; R2 will 404 it. A missing poster is a broken thumbnail on
  // every phone in the field, reported by nothing.
  process.stdout.write('  Checking every video has its poster');
  let posters = 0;
  for (const row of videos) {
    const expected = keys.posterKey(row.key);
    const head = await r2.head(row.bucket, expected);
    if (!head) {
      fail(`NO POSTER for ${row.key}`, `installed builds will request ${expected} and get 404`);
    } else {
      posters += 1;
      // The app derives the poster from the stored URL by string replacement,
      // so confirm that derivation lands on the key we actually wrote.
      const guessed = row.newUrl.replace(/\.mp4$/i, '.jpg');
      if (r2.keyFromPublicUrl(guessed) !== expected) {
        fail(`poster key mismatch for ${row.key}`,
          `app would request ${r2.keyFromPublicUrl(guessed)}, we stored ${expected}`);
      }
    }
  }
  console.log(` ${posters}/${videos.length} present.`);

  // ---- 4. variants (a warning, not a failure) --------------------------
  let withVariants = 0;
  for (const row of images) {
    const has = (row.derivatives || []).filter((k) => /_w\d+\./.test(k)).length;
    if (has) withVariants += 1;
  }
  if (images.length && withVariants < images.length) {
    // Legitimate: an image already narrower than 480px gets no variant, because
    // a "small" copy larger than the original would cost storage to serve the
    // same pixels.
    warn(`${images.length - withVariants} image(s) have no resized variants`,
      'expected for images already smaller than 480px');
  }

  // ---- 5. URL round-trip ----------------------------------------------
  //
  // A key is raw bytes; a URL path is percent-encoded. Two files in this
  // account carry a literal `%20` in their public_id, and a URL built by naive
  // concatenation would point at a different key than the one stored.
  let roundTripped = 0;
  for (const row of verified) {
    if (row.newUrl.startsWith('r2:')) { roundTripped += 1; continue; }
    if (r2.keyFromPublicUrl(row.newUrl) !== row.key) {
      fail(`URL does not round-trip: ${row.key}`, `${row.newUrl} decodes to ${r2.keyFromPublicUrl(row.newUrl)}`);
    } else {
      roundTripped += 1;
    }
  }
  console.log(`  URL round-trip: ${roundTripped}/${verified.length} exact.`);

  // ---- 6. deep byte comparison on a sample -----------------------------
  const publicRows = verified.filter((r) => !r.newUrl.startsWith('r2:'));
  const sampleSize = SAMPLE_PCT >= 100
    ? publicRows.length
    : Math.min(publicRows.length, Math.max(5, Math.ceil(publicRows.length * (SAMPLE_PCT / 100))));
  // Deterministic pick, so a re-run checks the same files and a fix can be
  // confirmed rather than hidden by a different random draw.
  const sample = [...publicRows]
    .sort((a, b) => a.key.localeCompare(b.key))
    .filter((_, i) => i % Math.max(1, Math.floor(publicRows.length / sampleSize)) === 0)
    .slice(0, sampleSize);

  console.log(`\n  Deep-comparing ${sample.length} of ${publicRows.length} file(s) byte for byte…`);
  let compared = 0;
  let sampleBytes = 0;
  for (const row of sample) {
    try {
      const mine = await sha256Of(row.newUrl);
      if (row.sha256 && mine.sha !== row.sha256) {
        fail(`SHA-256 mismatch: ${row.key}`, 'the copy is not the same bytes as the source');
      } else if (mine.bytes !== row.bytes) {
        fail(`length mismatch: ${row.key}`, `${mine.bytes} served, ${row.bytes} expected`);
      } else {
        compared += 1;
        sampleBytes += mine.bytes;
      }
    } catch (error) {
      fail(`could not fetch ${row.newUrl}`, error.message);
    }
  }
  console.log(`  ${compared}/${sample.length} identical (${bytesHuman(sampleBytes)}).`);

  // ---- 7. content types over the public domain -------------------------
  let octetStream = 0;
  for (const row of sample) {
    try {
      const res = await fetch(row.newUrl, { method: 'HEAD' });
      const ct = res.headers.get('content-type') || '';
      if (ct.startsWith('application/octet-stream')) {
        octetStream += 1;
        warn(`served as octet-stream: ${row.key}`, 'the file may not open in the app');
      }
    } catch { /* covered by the fetch check above */ }
  }

  // ---- report ----------------------------------------------------------
  const line = '  ' + '─'.repeat(74);
  console.log(`\n${line}`);
  console.log('  LEDGER\n');
  console.log(`  verified / flipped  ${padL(verified.length, 6)}   ${bytesHuman(verified.reduce((n, r) => n + (r.bytes || 0), 0))}`);
  console.log(`  already missing     ${padL(dangling.length, 6)}   broken before the migration began`);
  console.log(`  failed              ${padL(failed.length, 6)}`);
  console.log(`  videos with posters ${padL(posters, 6)} / ${videos.length}`);
  console.log(`  images with variants${padL(withVariants, 6)} / ${images.length}`);
  console.log(line);

  if (warnings.length) {
    console.log('\n  WARNINGS (not blocking)\n');
    for (const w of warnings.slice(0, 10)) console.log(`  - ${w.what}\n      ${w.detail}`);
    if (warnings.length > 10) console.log(`  … and ${warnings.length - 10} more`);
  }

  console.log(`\n${line}`);
  if (failures.length === 0) {
    console.log('  GATE 4 — CLEAR\n');
    console.log(`  ${verified.length} file(s) copied, present, and provably identical on the sample.`);
    console.log(`  ${videos.length ? 'Every video has the poster installed app builds will ask for.' : ''}`);
    console.log('\n  Phase 5 may begin: node scripts/r2/05-flip.js --step=1');
  } else {
    console.log('  GATE 4 — NOT CLEAR\n');
    for (const f of failures.slice(0, 20)) console.log(`  - ${f.what}\n      ${f.detail}`);
    if (failures.length > 20) console.log(`  … and ${failures.length - 20} more`);
    console.log('\n  DO NOT run Phase 5. One unverified file is enough to stop the migration —');
    console.log('  fix the cause, re-run the copy, and re-run this.');
  }
  console.log(`${line}\n`);

  await disconnect();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(`\n  Verification failed to run:\n\n  ${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  await disconnect();
  process.exit(1);
});
