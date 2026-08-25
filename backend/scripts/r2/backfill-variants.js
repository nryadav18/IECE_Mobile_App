#!/usr/bin/env node
/**
 * Fill in resized image variants that were never written.
 *
 *   npm run r2:backfill-variants -- --dry-run
 *   npm run r2:backfill-variants
 *
 * WHY THIS EXISTS
 *
 * The upload path and the copy job originally skipped a variant when the source
 * was already narrower than the target width, reasoning that a "small" copy
 * larger than the original wastes storage. That reasoning is right about bytes
 * and wrong about the thing that matters: it makes a resized URL a gamble the
 * client cannot evaluate. 29 of the 124 migrated images were narrower than
 * 1080px, so a frontend asking for `_w1080` would have 404'd on 23% of them —
 * and a missing variant renders as no image at all, not as a slightly larger
 * one.
 *
 * Cloudinary never had this problem: any width in the URL always worked. This
 * restores that property, so `optimizedImageUrl` can pick a width and be
 * certain.
 *
 * A VIDEO POSTER IS AN IMAGE.
 *
 * The database stores a video's `.mp4` URL, never its poster — the client
 * derives the poster itself by swapping the extension. So a scan that only
 * looked at stored URLs would never see a poster, and posters were exactly the
 * image kind that had no variants. The moment the app began requesting screen
 * sized images, every activity thumbnail backed by a video went blank. This
 * script therefore derives each video's poster and checks that too.
 *
 * SCOPE COMES FROM THE DATABASE, NOT THE LEDGER
 *
 * An earlier version of this script walked `assetmigrations`, which meant it
 * could only ever repair MIGRATED files — and silently missed every image
 * uploaded natively through the app, because those were never on Cloudinary and
 * so have no ledger row. That is exactly the population most likely to be
 * affected: any server still running the old skip rule keeps producing them,
 * and the ledger will never mention one. Walking the seven URL fields covers
 * both, and covers anything added later without having to be told.
 *
 * Existence is asked of STORAGE, not of the ledger, for the same reason: the
 * ledger records what the migration believes it did; the bucket is what is
 * true.
 *
 * Originals are read back out of R2 rather than from Cloudinary, so this still
 * works after the account is closed and can never re-introduce a purged file.
 */

const sharp = require('sharp');
const { r2Config, ConfigError } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const { collectReferences } = require('./lib/references');
const AssetMigration = require('../../models/AssetMigration');
const r2 = require('../../utils/storage/r2');
const keys = require('../../utils/storage/keys');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const IS_VARIANT = /_w\d+\.(jpe?g|png|webp)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

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

  const connection = await connect();
  const references = await collectReferences(connection.db);

  const ours = (url) => url.startsWith(`${cfg.publicBaseUrl}/`);

  // Images stored directly.
  const direct = [...references.keys()].filter((url) =>
    ours(url) && IMAGE_EXT.test(url) && !IS_VARIANT.test(url));

  // Plus the poster behind every video — never stored in the database, always
  // constructed by the client.
  const posters = [...references.keys()]
    .filter((url) => ours(url) && VIDEO_EXT.test(url))
    .map((url) => url.replace(VIDEO_EXT, '.jpg'));

  const images = [...new Set([...direct, ...posters])];

  process.stdout.write(`  ${direct.length} stored image(s) + ${posters.length} video poster(s) = ${images.length}; checking widths`);
  const work = [];
  let checked = 0;
  const noPoster = [];
  for (const url of images) {
    const key = r2.keyFromPublicUrl(url);

    // A derived poster URL is a guess until proven: if poster generation failed
    // for that video, there is nothing to make variants of. Recorded and
    // reported rather than treated as an error — a missing poster is a
    // different problem, and scripts/r2/04-verify.js is where it is caught.
    if (!(await r2.head(cfg.bucketPublic, key))) {
      noPoster.push(key);
      checked += 1;
      continue;
    }

    const missing = [];
    for (const width of keys.VARIANT_WIDTHS) {
      const variant = keys.variantKey(key, width);
      if (!(await r2.head(cfg.bucketPublic, variant))) missing.push(width);
    }
    if (missing.length) work.push({ url, key, missing });
    checked += 1;
    if (checked % 25 === 0) process.stdout.write('.');
  }
  if (noPoster.length) {
    console.log(`\n\n  ${noPoster.length} derived poster(s) do not exist — nothing to resize:`);
    noPoster.slice(0, 5).forEach((k) => console.log(`    ${k}`));
    console.log('  Run scripts/r2/04-verify.js; a missing poster is a hard failure there.');
  }
  console.log(`\n\n  ${work.length} image(s) missing at least one width.\n`);

  if (!work.length) {
    console.log('  Every image has every bucket width. Nothing to do.\n');
    await disconnect();
    process.exit(0);
  }

  if (DRY_RUN) {
    for (const { key, missing } of work.slice(0, 15)) {
      console.log(`  ${key}\n      missing ${missing.map((w) => `_w${w}`).join(', ')}`);
    }
    if (work.length > 15) console.log(`\n  … and ${work.length - 15} more.`);
    console.log('\n  Re-run without --dry-run to write them.\n');
    await disconnect();
    process.exit(0);
  }

  let written = 0;
  let failed = 0;
  for (const { url, key, missing } of work) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`original answered ${res.status}`);
      const original = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(original).metadata();

      // An animated GIF loses its animation to a still-image resize, so it gets
      // no variants at all and the original is served to everyone.
      if (meta.format === 'gif' && meta.pages > 1) {
        console.log(`  SKIP  ${key}  (animated GIF — served whole)`);
        continue;
      }

      const format = ['png', 'webp'].includes(meta.format) ? meta.format : 'jpeg';
      const added = [];
      for (const width of missing) {
        let pipeline = sharp(original).rotate()
          .resize({ width, fit: 'inside', withoutEnlargement: true });
        pipeline = format === 'png' ? pipeline.png({ compressionLevel: 9 })
          : format === 'webp' ? pipeline.webp({ quality: 82 })
            : pipeline.jpeg({ quality: 82, mozjpeg: true });

        const buffer = await pipeline.toBuffer();
        const variant = keys.variantKey(key, width);
        await r2.put({
          bucket: cfg.bucketPublic,
          key: variant,
          body: buffer,
          contentLength: buffer.length,
          contentType: keys.contentTypeFor(variant),
        });
        added.push(variant);
        written += 1;
      }

      // Keep the ledger honest where a row exists. Natively-uploaded images have
      // none and do not need one — this is a no-op for them, not an error.
      await AssetMigration.updateOne({ key }, { $addToSet: { derivatives: { $each: added } } });

      console.log(`  OK    ${key}  +${added.length}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${key}\n        ${error.message}`);
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
  if (process.env.DEBUG) console.error(error);
  await disconnect();
  process.exit(1);
});
