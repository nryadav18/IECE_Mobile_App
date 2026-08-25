const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const r2 = require('./r2');
const keys = require('./keys');
const { processImage, makePoster, removeQuietly } = require('./media');

// utils/cloudinary.js is not deleted and not deprecated — it becomes the legacy
// driver. It still owns every Cloudinary URL in the database, and it will keep
// owning them until Phase 5 has flipped the last one and Phase 6 has closed the
// account. Its report formatters are reused verbatim so callers see identical
// wording whichever cloud a file happened to live in.
const legacy = require('../cloudinary');

// ---------------------------------------------------------------------------
// ONE DOOR TO CLOUD STORAGE.
//
// WHERE NEW FILES GO is a runtime switch: STORAGE_DRIVER=cloudinary | r2.
// WHERE OLD FILES LIVE is not a switch at all — it is a property of each stored
// value, and it is read from the value itself.
//
// That asymmetry is the whole design. During the migration the database holds
// Cloudinary URLs and R2 URLs side by side, for weeks. Anything that decided
// where to delete from by looking at a global flag would, the moment the flag
// flipped, start aiming every deletion at the wrong cloud: reporting success
// (S3 and Cloudinary both answer cheerfully for keys that do not exist) while
// the real files quietly stayed behind. So deletion routes on the hostname of
// the value in hand, and always will, even long after Cloudinary is gone.
//
// The flag is also the rollback. Set it back to `cloudinary`, restart, and new
// uploads go where they always did. Nothing else has to be undone.
// ---------------------------------------------------------------------------

const driver = () => (String(process.env.STORAGE_DRIVER || 'cloudinary').toLowerCase() === 'r2' ? 'r2' : 'cloudinary');

// Generous, but not unbounded. There was no limit before, because Cloudinary
// streamed straight past the server; now the file lands on this box first, and
// an unbounded upload is an unbounded disk write.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 300 * 1024 * 1024);

/* ------------------------------------------------------------------ *
 * The multer instance used by POST /upload                            *
 * ------------------------------------------------------------------ */

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `iece-up-${crypto.randomBytes(8).toString('hex')}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Disk, not memory. A 200 MB activity video held as a Buffer is 200 MB of heap
// on a small VPS, per concurrent upload; and ffmpeg needs a seekable file on
// disk to pull a poster frame out of anyway.
const upload = driver() === 'r2' ? diskUpload : legacy.upload;

/* ------------------------------------------------------------------ *
 * Putting one uploaded file where it belongs                          *
 * ------------------------------------------------------------------ */

const videoContentType = (ext) => ({
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
}[ext] || 'video/mp4');

const docContentType = (ext) => ({
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}[ext] || 'application/octet-stream');

/**
 * Store one uploaded file, plus everything derived from it.
 *
 * @returns {Promise<{url: string, keys: string[]}>} the public URL to record,
 *          and every key written — so a later failure in the same request can
 *          clean up after itself instead of leaving paid-for orphans behind.
 */
async function storeUploadedFile(file) {
  const cfg = r2.config();
  const info = keys.buildKey(file.mimetype, file.originalname);
  const written = [];

  if (info.kind === 'image') {
    const processed = await processImage(file.path, info);

    if (!processed) {
      // Animated GIF, or something sharp could not decode. Store the bytes
      // exactly as they arrived — always a correct answer.
      await r2.putFile({
        bucket: cfg.bucketPublic,
        key: info.key,
        filePath: file.path,
        contentType: file.mimetype || 'application/octet-stream',
      });
      written.push(info.key);
    } else {
      await r2.put({
        bucket: cfg.bucketPublic,
        key: info.key,
        body: processed.main,
        contentType: processed.contentType,
        contentLength: processed.main.length,
      });
      written.push(info.key);

      for (const variant of processed.variants) {
        const vKey = keys.variantKey(info.key, variant.width);
        await r2.put({
          bucket: cfg.bucketPublic,
          key: vKey,
          body: variant.buffer,
          contentType: processed.contentType,
          contentLength: variant.buffer.length,
        });
        written.push(vKey);
      }
    }
  } else if (info.kind === 'video') {
    await r2.putFile({
      bucket: cfg.bucketPublic,
      key: info.key,
      filePath: file.path,
      contentType: videoContentType(info.extension),
    });
    written.push(info.key);

    // THE POSTER. Installed app builds construct this exact URL themselves by
    // replacing .mp4 with .jpg — see frontend/src/components/ActivityCover.js.
    // Cloudinary generated it on demand; here it has to genuinely exist.
    const poster = await makePoster(file.path);
    if (poster) {
      const pKey = keys.posterKey(info.key);
      await r2.put({
        bucket: cfg.bucketPublic,
        key: pKey,
        body: poster,
        contentType: 'image/jpeg',
        contentLength: poster.length,
      });
      written.push(pKey);
    }
  } else {
    await r2.putFile({
      bucket: cfg.bucketPublic,
      key: info.key,
      filePath: file.path,
      contentType: info.kind === 'doc'
        ? docContentType(info.extension)
        : (file.mimetype || 'application/octet-stream'),
    });
    written.push(info.key);
  }

  return { url: r2.publicUrl(info.key), keys: written };
}

/**
 * Express middleware: push whatever multer collected into storage, then make it
 * look exactly like it always did.
 *
 * `req.file.path` and `req.files[].path` are what uploadController reads and
 * what every client has been receiving since the app shipped. Preserving those
 * two property names is what makes this change invisible to phones already
 * installed — there is no new API shape for anyone to upgrade to.
 *
 * A no-op while STORAGE_DRIVER is `cloudinary`, because multer-storage-cloudinary
 * has already done all of this.
 */
async function finalizeUploads(req, res, next) {
  if (driver() !== 'r2') return next();

  const files = req.files && req.files.length ? req.files
    : (req.file ? [req.file] : []);
  if (!files.length) return next();

  // Captured BEFORE the loop, because `file.path` is about to be overwritten
  // with the public URL. Reading it afterwards would hand the cleanup a URL
  // instead of a filename, and every upload would leave its temp file on disk
  // forever — a slow, silent disk leak that only shows up as a full volume.
  const tempPaths = files.map((f) => f.path);
  const writtenKeys = [];
  let failure = null;

  try {
    for (const file of files) {
      const { url, keys: written } = await storeUploadedFile(file);
      writtenKeys.push(...written);
      // The contract every caller already depends on.
      file.path = url;
      file.filename = url;
    }
  } catch (error) {
    failure = error;
    // Partial success is worse than failure: the caller gets an error and walks
    // away, while the files that did upload sit in the bucket forever with
    // nothing pointing at them. Undo what this request managed to write.
    for (const key of writtenKeys) {
      try {
        await r2.destroy(r2.publicUrl(key));
      } catch { /* best effort — the audit script finds anything left */ }
    }
    console.error(`[storage] upload failed, rolled back ${writtenKeys.length} object(s): ${error.message}`);
  }

  // Cleanup happens BEFORE next(), not in a `finally` after it. Calling next()
  // first hands control back to the route while these deletes are still in
  // flight, so a burst of uploads can leave a pile of temp files behind that
  // nothing is waiting on and no error surfaces for. Removing three files takes
  // microseconds; the response can afford to wait for it.
  for (const temp of tempPaths) await removeQuietly(temp);

  return next(failure || undefined);
}

/* ------------------------------------------------------------------ *
 * Face recordings                                                     *
 * ------------------------------------------------------------------ */

/**
 * Store a facial-registration video and return the value to persist.
 *
 * Under R2 this goes to the PRIVATE bucket and the value returned is a
 * reference (`r2:bucket/key`), not a URL — a signed URL expires, so writing one
 * into MongoDB would store a link that is dead by the time anybody clicks it.
 * middleware/signedAssets.js turns the reference into a working URL on the way
 * out of every response.
 *
 * Best-effort, exactly as it was before: a storage hiccup must never stop
 * somebody registering their face, because the embedding — which is what
 * attendance actually matches against — has already been computed by then.
 */
async function putFaceVideo(buffer, mimetype, { userId, schoolId } = {}) {
  if (driver() !== 'r2') {
    try {
      const b64 = Buffer.from(buffer).toString('base64');
      const result = await legacy.cloudinary.uploader.upload(
        `data:${mimetype};base64,${b64}`,
        { folder: 'facial_registrations_v2', resource_type: 'video' }
      );
      return result.secure_url || null;
    } catch (error) {
      console.error('[storage] Cloudinary face video upload failed:', error.message);
      return null;
    }
  }

  try {
    const cfg = r2.config();
    const key = keys.faceVideoKey(userId, schoolId);
    await r2.put({
      bucket: cfg.bucketPrivate,
      key,
      body: Buffer.from(buffer),
      contentType: mimetype || 'video/mp4',
      contentLength: Buffer.byteLength(buffer),
      // Never cached: the recording is reviewed once and then deleted, and a
      // year-long immutable cache on something designed to be destroyed is a
      // copy of a person's face living in an edge cache after the original is
      // gone.
      cacheControl: 'private, no-store',
    });
    return r2.privateRef(key);
  } catch (error) {
    console.error('[storage] R2 face video upload failed:', error.message);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Deleting — routed by the value, never by the flag                   *
 * ------------------------------------------------------------------ */

const EMPTY_REPORT = {
  ok: true, requested: 0, deleted: 0, missing: 0, failed: 0,
  verified: 0, unverified: 0, stillPresent: 0,
  gone: [], failures: [], blocked: false, blockedReason: null,
};

/**
 * Remove files from wherever they actually are.
 *
 * Returns exactly the report shape utils/cloudinary.purgeAssets always
 * returned, so activityController, mediaController, schoolController and
 * faceVideo.js keep working unchanged — including `gone`, which is the list of
 * URLs it is now safe to drop from the database. A value whose file could not
 * be removed is deliberately KEPT there, because it is the only handle anyone
 * will ever have on that file again.
 */
async function purgeAssets(urls = []) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) return { ...EMPTY_REPORT };

  const mine = list.filter((u) => r2.isOurs(u));
  const theirs = list.filter((u) => !r2.isOurs(u));

  const [r2Results, legacyReport] = await Promise.all([
    Promise.all(mine.map((u) => r2.destroy(u))),
    theirs.length ? legacy.purgeAssets(theirs) : Promise.resolve({ ...EMPTY_REPORT }),
  ]);

  // Evicting the edge is part of deleting, not an afterthought. An object
  // removed from the bucket is still served by cdn.iece.org.in from cache —
  // measured, with `cf-cache-status: HIT` — and the immutable one-year TTL means
  // it stays reachable for a year unless it is explicitly purged. See the note
  // above purgeCdn in ./r2.js.
  const cdnUrls = r2Results.flatMap((r) => r.cdnUrls || []);
  const cdn = await r2.purgeCdn(cdnUrls);

  const r2Gone = r2Results.filter((r) => r.ok).map((r) => r.url);
  const r2Failures = r2Results.filter((r) => !r.ok).map((r) => ({ url: r.url, error: r.error }));
  const r2Blocked = r2Results.find((r) => r.blocked);
  const r2StillPresent = r2Results.filter((r) => r.stillPresent);

  if (r2Failures.length) {
    console.error(
      `R2 purge incomplete — ${r2Failures.length}/${mine.length} still in the bucket:`,
      r2Failures.map((f) => `${f.url} (${f.error})`).join('; ')
    );
  }
  if (r2StillPresent.length) {
    console.error(
      `R2 reported success for ${r2StillPresent.length} object(s) that are STILL present:`,
      r2StillPresent.map((r) => r.url).join('; ')
    );
  }

  const report = {
    requested: list.length,
    deleted: r2Results.filter((r) => r.status === 'deleted').length + legacyReport.deleted,
    missing: r2Results.filter((r) => r.status === 'missing').length + legacyReport.missing,
    failed: r2Failures.length + legacyReport.failed,
    verified: r2Results.filter((r) => r.ok && r.verified !== false).length + (legacyReport.verified || 0),
    unverified: r2Results.filter((r) => r.ok && r.verified === false).length + (legacyReport.unverified || 0),
    stillPresent: r2StillPresent.length + (legacyReport.stillPresent || 0),
    gone: [...r2Gone, ...legacyReport.gone],
    failures: [...r2Failures, ...legacyReport.failures],
    blocked: !!r2Blocked || !!legacyReport.blocked,
    blockedReason: (r2Blocked && r2Blocked.error) || legacyReport.blockedReason || null,
    // Additive: nothing that reads this report today looks for these, but a
    // caller that wants to say "and it is out of the CDN too" now can.
    cdnPurged: cdn.ok,
    cdnPurgeError: cdn.error,
  };
  report.ok = report.failures.length === 0;
  return report;
}

/** Back-compat single-URL helper, unchanged in meaning. */
const deleteFile = async (url) => {
  const report = await purgeAssets([url]);
  return report.ok;
};

module.exports = {
  driver,
  upload,
  finalizeUploads,
  putFaceVideo,
  purgeAssets,
  deleteFile,
  // Report wording is shared so a message never reveals which cloud it came from.
  purgeSummary: legacy.purgeSummary,
  purgeProblem: legacy.purgeProblem,
  // Private references
  signPrivateRef: r2.signPrivateRef,
  isPrivateRef: r2.isPrivateRef,
  publicUrl: r2.publicUrl,
  MAX_UPLOAD_BYTES,
};
