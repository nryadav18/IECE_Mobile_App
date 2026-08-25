#!/usr/bin/env node
/**
 * PHASE 3 — copy every referenced file from Cloudinary to R2.
 *
 *   npm run r2:copy               copy everything not already verified
 *   npm run r2:copy -- --dry-run  say what would happen, write nothing
 *   npm run r2:copy -- --limit=10 do the first 10 only (a cautious first run)
 *   npm run r2:copy -- --retry    include previously failed files
 *
 * THE APP IS NOT TOUCHED BY THIS SCRIPT. It reads MongoDB to find out what is
 * referenced, downloads from Cloudinary, uploads to R2, and records what it did
 * in the `assetmigrations` collection. Not one application document is
 * modified — every URL in the database still points at Cloudinary when this
 * finishes, and Cloudinary still serves every byte. The switch happens in
 * Phase 5, and only after Phase 4 has proved this worked.
 *
 * SAFE TO INTERRUPT. Ctrl+C at any moment; re-run and it picks up where it
 * stopped, because "already verified" is recorded per file, not per run.
 *
 * WHAT IT WRITES FOR EACH FILE
 *
 *   the original bytes, unchanged     mirrored key, so old URL and new URL are
 *                                     derivable from each other and the copy can
 *                                     be checked by checksum
 *   _w480 / _w1080                    for images, so a future app build can ask
 *                                     for a screen-sized version the way it used
 *                                     to ask Cloudinary
 *   <name>.jpg                        for videos. NOT optional — installed app
 *                                     builds construct this URL themselves
 *
 * The primary object is copied BYTE FOR BYTE. It is deliberately not re-encoded
 * or resized the way a new upload is: an identical copy is one that can be
 * proved identical, and a checksum that matches is worth more than a few
 * megabytes saved on files that are already uploaded and already being served.
 */

const fs = require('fs');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const sharp = require('sharp');

const { cloudinaryConfig, r2Config, ConfigError } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const { collectReferences, isCloudinaryUrl } = require('./lib/references');
const AssetMigration = require('../../models/AssetMigration');
const r2 = require('../../utils/storage/r2');
const keys = require('../../utils/storage/keys');
const { makePoster, tempPath, removeQuietly } = require('../../utils/storage/media');
const { parseCloudinaryUrl } = require('../../utils/cloudinary');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RETRY_FAILED = args.includes('--retry');
const LIMIT = (() => {
  const a = args.find((x) => x.startsWith('--limit='));
  return a ? Number(a.split('=')[1]) : Infinity;
})();

// Cloudinary is a CDN and copes fine, but this runs from a laptop on a domestic
// connection and the files include 800 MB of video. Six at a time keeps the
// link saturated without making the machine unusable.
const CONCURRENCY = Number(process.env.R2_COPY_CONCURRENCY || 6);
const MAX_ATTEMPTS = 3;

const bytesHuman = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

/** Run `worker` over `items`, at most `n` at a time. */
async function pooled(items, n, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await worker(next[1], next[0]);
    }
  });
  await Promise.all(runners);
}

/**
 * Download one Cloudinary URL to a temp file, hashing as it goes.
 *
 * The hash is computed from the same stream that is written to disk, so it is a
 * statement about the bytes that actually landed — not about a second read that
 * might differ.
 *
 * @returns {Promise<{file: string, bytes: number, sha256: string}|{missing: true}>}
 */
async function download(url) {
  const res = await fetch(url);
  if (res.status === 404 || res.status === 410) return { missing: true };
  if (!res.ok) throw new Error(`source answered ${res.status}`);

  const file = tempPath('.bin');
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const head = [];

  const counting = new (require('stream').Transform)({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      // Keep the first bytes so the type can be sniffed without re-reading the
      // file — some public_ids carry no extension at all.
      if (bytes < 32) head.push(chunk.subarray(0, 32));
      bytes += chunk.length;
      cb(null, chunk);
    },
  });

  await pipeline(res.body, counting, fs.createWriteStream(file));
  return {
    file,
    bytes,
    sha256: hash.digest('hex'),
    magic: Buffer.concat(head).subarray(0, 32),
    sourceType: res.headers.get('content-type') || null,
  };
}

/**
 * The R2 key for a Cloudinary URL — the public_id with its extension.
 *
 * Raw assets (the PDFs and Word files in `iece_mous`) usually carry the
 * extension INSIDE the public_id already, so appending it again would produce
 * `x.pdf.pdf`. Images and videos keep it outside and need it added.
 */
function keyFor(parsed) {
  const { publicId, extension } = parsed;
  if (!extension) return publicId;
  return publicId.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
    ? publicId
    : `${publicId}.${extension}`;
}

/** Image variants, generated from the copied original. Never fatal. */
async function makeVariants(file, key) {
  const out = [];
  try {
    const meta = await sharp(file).metadata();
    const format = ['png', 'webp'].includes(meta.format) ? meta.format : 'jpeg';
    // An animated GIF loses its animation to a still-image resize, so it gets
    // no variants at all — the original is served to everyone.
    if (meta.format === 'gif' && meta.pages > 1) return out;

    for (const width of keys.VARIANT_WIDTHS) {
      // Always written — see the note in utils/storage/media.js. A client that
      // has to guess whether a width exists cannot use any of them.
      let p = sharp(file).rotate().resize({ width, fit: 'inside', withoutEnlargement: true });
      p = format === 'png' ? p.png({ compressionLevel: 9 })
        : format === 'webp' ? p.webp({ quality: 82 })
          : p.jpeg({ quality: 82, mozjpeg: true });
      out.push({ key: keys.variantKey(key, width), buffer: await p.toBuffer(), format });
    }
  } catch (error) {
    console.warn(`      variants skipped (${error.message})`);
  }
  return out;
}

async function copyOne(url, uses, cfg, stats) {
  const existing = await AssetMigration.findOne({ oldUrl: url });
  if (existing && (existing.status === 'verified' || existing.status === 'flipped')) {
    stats.skipped += 1;
    return;
  }
  if (existing && existing.status === 'dangling' && !RETRY_FAILED) {
    stats.dangling += 1;
    return;
  }
  if (existing && existing.status === 'failed' && !RETRY_FAILED) {
    stats.previouslyFailed += 1;
    return;
  }

  const parsed = parseCloudinaryUrl(url);
  if (!parsed) {
    stats.failed += 1;
    if (!DRY_RUN) {
      await AssetMigration.updateOne({ oldUrl: url },
        { $set: { status: 'failed', error: 'could not be parsed into a public_id', uses }, $inc: { attempts: 1 } },
        { upsert: true });
    }
    console.log(`  FAIL  ${url}\n        could not be parsed`);
    return;
  }

  const key = keyFor(parsed);
  const isPrivate = uses[0].bucket === 'private';
  const bucket = isPrivate ? cfg.bucketPrivate : cfg.bucketPublic;
  // Decided below, once the first bytes are in hand.

  if (DRY_RUN) {
    stats.wouldCopy += 1;
    console.log(`  DRY   ${pad(key, 62)} -> ${bucket}  ${keys.contentTypeFor(parsed.extension || key)}`);
    return;
  }

  let temp = null;
  try {
    const got = await download(url);

    if (got.missing) {
      // Already broken before the migration began. A first-class outcome, not a
      // failure — Phase 0 predicted 60 of these, all face recordings that
      // utils/faceVideo.js deleted on purpose once the Admin decided.
      stats.dangling += 1;
      await AssetMigration.updateOne({ oldUrl: url },
        { $set: { status: 'dangling', error: 'source is not in the Cloudinary account', uses, key, bucket }, $inc: { attempts: 1 } },
        { upsert: true });
      console.log(`  GONE  ${key}  (already missing from Cloudinary)`);
      return;
    }

    temp = got.file;
    const derivatives = [];

    // THE HEADER THAT DECIDES WHETHER THE FILE OPENS.
    //
    // In order of trust: the extension if we recognise one (unambiguous and
    // what every client keys off), then the actual bytes, then whatever
    // Cloudinary claimed. Cloudinary is last on purpose — it serves the two
    // extension-less PDFs in this account as `application/octet-stream`, and
    // faithfully copying that header would reproduce a file the app cannot
    // open.
    const byExtension = parsed.extension ? keys.contentTypeFor(parsed.extension) : null;
    const bySniff = keys.sniffContentType(got.magic);
    const contentType =
      (byExtension && byExtension !== 'application/octet-stream') ? byExtension
        : bySniff
          || (got.sourceType && got.sourceType !== 'application/octet-stream'
            ? got.sourceType.split(';')[0].trim()
            : 'application/octet-stream');

    await r2.putFile({
      bucket,
      key,
      filePath: temp,
      contentType,
      // Face recordings are reviewed once and then destroyed; a year-long
      // immutable cache on something designed to be deleted would leave copies
      // of a person's face in edge caches after the original is gone.
      cacheControl: isPrivate ? 'private, no-store' : undefined,
    });

    if (parsed.resourceType === 'image' && !isPrivate) {
      for (const v of await makeVariants(temp, key)) {
        await r2.put({
          bucket, key: v.key, body: v.buffer, contentLength: v.buffer.length,
          contentType: keys.contentTypeFor(v.key),
        });
        derivatives.push(v.key);
      }
    }

    if (parsed.resourceType === 'video' && !isPrivate) {
      // REQUIRED. Installed app builds swap .mp4 for .jpg and request it
      // themselves; without this the thumbnail is broken on every phone in the
      // field. Phase 4 fails the whole migration on a missing poster.
      const poster = await makePoster(temp);
      if (poster) {
        const pKey = keys.posterKey(key);
        await r2.put({ bucket, key: pKey, body: poster, contentLength: poster.length, contentType: 'image/jpeg' });
        derivatives.push(pKey);
      }
    }

    // Proof, not assumption: ask R2 what it is holding.
    const head = await r2.head(bucket, key);
    if (!head) throw new Error('uploaded, but R2 does not have the object');
    if (Number(head.ContentLength) !== got.bytes) {
      throw new Error(`size mismatch: source ${got.bytes} bytes, R2 ${head.ContentLength}`);
    }

    await AssetMigration.updateOne({ oldUrl: url }, {
      $set: {
        newUrl: isPrivate ? r2.privateRef(key) : r2.publicUrl(key),
        bucket, key, derivatives, uses,
        resourceType: parsed.resourceType,
        bytes: got.bytes,
        sha256: got.sha256,
        status: 'verified',
        error: null,
        copiedAt: new Date(),
        verifiedAt: new Date(),
      },
      $inc: { attempts: 1 },
    }, { upsert: true });

    stats.copied += 1;
    stats.bytes += got.bytes;
    const note = contentType === 'application/octet-stream' ? '  ?type' : '';
    console.log(`  OK    ${pad(key, 62)} ${padL(bytesHuman(got.bytes), 9)}${derivatives.length ? `  +${derivatives.length}` : ''}${note}`);
  } catch (error) {
    stats.failed += 1;
    await AssetMigration.updateOne({ oldUrl: url },
      { $set: { status: 'failed', error: error.message, uses, key, bucket }, $inc: { attempts: 1 } },
      { upsert: true });
    console.log(`  FAIL  ${key}\n        ${error.message}`);
  } finally {
    await removeQuietly(temp);
  }
}

async function main() {
  let cfg;
  let cloud;
  try {
    cloud = cloudinaryConfig();
    // The custom domain is required here, not merely preferred: whatever is in
    // R2_PUBLIC_BASE_URL is written into `newUrl` and is what Phase 5 puts into
    // the database. A development hostname baked into every record is a second
    // migration nobody asked for.
    cfg = r2Config({ requireCustomDomain: true });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  Configuration problem\n\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  console.log('\n  PHASE 3 — COPY CLOUDINARY -> R2');
  console.log(`  ${DRY_RUN ? 'DRY RUN — nothing will be written anywhere.' : 'The application is not touched. Every database URL still points at Cloudinary.'}`);
  if (LIMIT !== Infinity) console.log(`  Limited to the first ${LIMIT} file(s).`);
  console.log('');

  const connection = await connect();
  const db = connection.db;
  console.log(`  MongoDB   ${db.databaseName}`);
  console.log(`  Source    cloudinary/${cloud.cloudName}`);
  console.log(`  Target    ${cfg.bucketPublic} + ${cfg.bucketPrivate}  ->  ${cfg.publicBaseUrl}\n`);

  const references = await collectReferences(db);
  const work = [...references.entries()].filter(([url]) => isCloudinaryUrl(url));
  const todo = work.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log(`  ${references.size} distinct URL(s) referenced, ${work.length} of them on Cloudinary.`);
  console.log(`  Working through ${todo.length}, ${CONCURRENCY} at a time.\n`);

  const stats = {
    copied: 0, skipped: 0, dangling: 0, failed: 0,
    previouslyFailed: 0, wouldCopy: 0, bytes: 0,
  };
  const started = Date.now();

  await pooled(todo, CONCURRENCY, ([url, uses]) => copyOne(url, uses, cfg, stats));

  const elapsed = Math.round((Date.now() - started) / 1000);
  const line = '  ' + '─'.repeat(74);
  console.log(`\n${line}`);
  if (DRY_RUN) {
    console.log(`  DRY RUN — ${stats.wouldCopy} file(s) would be copied, ${stats.skipped} already done.`);
    console.log('  Nothing was written. Re-run without --dry-run to do it for real.');
  } else {
    console.log('  RESULT\n');
    console.log(`  copied and verified   ${padL(stats.copied, 6)}   ${bytesHuman(stats.bytes)}`);
    console.log(`  already done          ${padL(stats.skipped, 6)}`);
    console.log(`  already missing       ${padL(stats.dangling, 6)}   (broken before the migration — see Phase 0)`);
    if (stats.previouslyFailed) console.log(`  previously failed     ${padL(stats.previouslyFailed, 6)}   (re-run with --retry)`);
    console.log(`  failed this run       ${padL(stats.failed, 6)}`);
    console.log(`\n  ${elapsed}s elapsed.`);
  }
  console.log(line);

  if (!DRY_RUN) {
    if (stats.failed) {
      console.log('\n  Some files could not be copied. Re-run with --retry once the cause is');
      console.log('  understood — the run is resumable and will not redo anything already verified.\n');
    } else {
      console.log('\n  Next: node scripts/r2/04-verify.js — it re-checks everything independently');
      console.log('  and is the gate that has to be 100% green before any URL is flipped.\n');
    }
  }

  await disconnect();
  process.exit(stats.failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(`\n  Copy failed:\n\n  ${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  await disconnect();
  process.exit(1);
});
