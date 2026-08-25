#!/usr/bin/env node
/**
 * Fill in resized variants that were never written.
 *
 *   npm run r2:backfill-variants -- --dry-run
 *   npm run r2:backfill-variants
 *
 * The copy job originally skipped a variant when the source was already
 * narrower than the target width, on the reasoning that a "small" copy larger
 * than the original wastes storage. That reasoning is correct about bytes and
 * wrong about the thing that matters: it makes a resized URL a gamble the
 * client cannot evaluate. 29 of the 124 migrated images are narrower than
 * 1080px, so a frontend asking for `_w1080` would have 404'd on 23% of them,
 * and a 404 renders as no image at all.
 *
 * Cloudinary never had this problem — any width in the URL always worked. This
 * restores that property: every image has every bucket width, so the client can
 * pick one and be certain.
 *
 * Reads the original back out of R2 rather than from Cloudinary, so it works
 * after the account is closed and cannot re-introduce a file that was purged.
 */

const sharp = require('sharp');
const { r2Config, ConfigError } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const AssetMigration = require('../../models/AssetMigration');
const r2 = require('../../utils/storage/r2');
const keys = require('../../utils/storage/keys');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const padL = (s, n) => String(s).padStart(n);

async function main() {
  let cfg;
  try {
    cfg = r2Config({ requireCustomDomain: true });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  console.log('\n  BACKFILL IMAGE VARIANTS');
  console.log(`  ${DRY_RUN ? 'Dry run — nothing will be written.' : 'Writing the missing widths.'}\n`);

  await connect();

  const images = await AssetMigration.find({
    resourceType: 'image',
    status: { $in: ['flipped', 'verified'] },
  }).lean();

  const work = [];
  for (const row of images) {
    const have = new Set((row.derivatives || [])
      .map((k) => (k.match(/_w(\d+)\./) || [])[1])
      .filter(Boolean)
      .map(Number));
    const missing = keys.VARIANT_WIDTHS.filter((w) => !have.has(w));
    if (missing.length) work.push({ row, missing });
  }

  console.log(`  ${images.length} image(s); ${work.length} missing at least one width.\n`);
  if (!work.length) {
    console.log('  Nothing to do.\n');
    await disconnect();
    process.exit(0);
  }

  if (DRY_RUN) {
    for (const { row, missing } of work.slice(0, 12)) {
      console.log(`  ${row.key}\n      missing ${missing.map((w) => `_w${w}`).join(', ')}`);
    }
    if (work.length > 12) console.log(`\n  … and ${work.length - 12} more.`);
    console.log('\n  Re-run without --dry-run to write them.\n');
    await disconnect();
    process.exit(0);
  }

  let written = 0;
  let failed = 0;
  for (const { row, missing } of work) {
    try {
      const res = await fetch(row.newUrl);
      if (!res.ok) throw new Error(`original answered ${res.status}`);
      const original = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(original).metadata();
      const format = ['png', 'webp'].includes(meta.format) ? meta.format : 'jpeg';
      // An animated GIF loses its animation to a still-image resize, so it is
      // left with no variants at all and the original is served to everyone.
      if (meta.format === 'gif' && meta.pages > 1) continue;

      const added = [];
      for (const width of missing) {
        let p = sharp(original).rotate().resize({ width, fit: 'inside', withoutEnlargement: true });
        p = format === 'png' ? p.png({ compressionLevel: 9 })
          : format === 'webp' ? p.webp({ quality: 82 })
            : p.jpeg({ quality: 82, mozjpeg: true });
        const buffer = await p.toBuffer();
        const vKey = keys.variantKey(row.key, width);
        await r2.put({
          bucket: row.bucket,
          key: vKey,
          body: buffer,
          contentLength: buffer.length,
          contentType: keys.contentTypeFor(vKey),
        });
        added.push(vKey);
        written += 1;
      }
      await AssetMigration.updateOne({ _id: row._id },
        { $addToSet: { derivatives: { $each: added } } });
      console.log(`  OK    ${row.key}  +${added.length}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${row.key}\n        ${error.message}`);
    }
  }

  console.log(`\n  ${written} variant(s) written, ${failed} failure(s).`);
  console.log('  Every image now has every bucket width, so a client can request one');
  console.log('  without having to guess whether it exists.\n');

  await disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(`\n  Failed:\n\n  ${error.message}\n`);
  await disconnect();
  process.exit(1);
});
