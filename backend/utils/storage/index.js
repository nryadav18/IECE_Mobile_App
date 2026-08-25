const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const r2 = require('./r2');
const keys = require('./keys');
const { processImage, makePoster, variantsFromBuffer, removeQuietly } = require('./media');

const { purgeSummary, purgeProblem } = require('./report');

// ---------------------------------------------------------------------------
// ONE DOOR TO CLOUD STORAGE.
//
// Everything the application puts into, or takes out of, the cloud goes through
// here. There is one backend — Cloudflare R2 — and no runtime switch: the
// migration is finished, every URL in the database points at R2, and a second
// path kept "just in case" is a path nobody exercises and therefore nobody can
// trust.
//
// Deletion still routes on the VALUE rather than on any global setting. That
// was essential during the migration, when Cloudinary URLs and R2 URLs sat side
// by side for weeks; it is kept because it is simply the correct shape.
// `isOurs()` refuses anything it does not recognise instead of guessing, so a
// stray URL from anywhere is reported rather than silently counted as deleted
// from a bucket it was never in.
//
// The migration itself, and the last remaining Cloudinary code, live in
// scripts/r2/. Nothing in the running application imports them.
// ---------------------------------------------------------------------------

// Generous, but not unbounded. There was no limit before, because Cloudinary
// streamed straight past the server; now the file lands on this box first, and
// an unbounded upload is an unbounded disk write.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 300 * 1024 * 1024);

/* ------------------------------------------------------------------ *
 * The multer instance used by POST /upload                            *
 * ------------------------------------------------------------------ */

// ---------------------------------------------------------------------------
// UPLOAD SCOPES.
//
// One route serves every kind of upload, but the kinds are not interchangeable.
// A leave proof is looked at by an approver on a phone; a PDF there is a tap
// out into a browser and, historically, an attachment nobody could see inline.
// Activity media legitimately includes video. So the caller names what it is
// uploading and the server holds it to that.
//
// The scope arrives as `?scope=...` on the query string RATHER than in the
// body, deliberately: multer streams multipart fields and files in whatever
// order the client wrote them, so a body field is not reliably parsed by the
// time the first file needs to be judged. A query parameter is available from
// the first byte.
//
// THE FILTER IS NOT THE ENFORCEMENT.
//
// `file.mimetype` is whatever the client wrote in the multipart header — it is
// a claim, not a fact, and a modified client can put `image/jpeg` on a PDF. The
// filter is there to reject the honest mistake cheaply, before anything touches
// disk. The actual rule is enforced in finalizeUploads by looking at the bytes.
// ---------------------------------------------------------------------------
const UPLOAD_SCOPES = {
  'leave-proof': {
    accept: (mime) => /^image\//i.test(mime || ''),
    acceptBytes: (sniffed) => /^image\//i.test(sniffed || ''),
    message: 'Leave proofs must be photos. PDFs and documents are not accepted — '
      + 'please attach a photo of the document instead.',
  },
};

class UploadRejected extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadRejected';
    this.status = 400;
  }
}

const scopeOf = (req) => UPLOAD_SCOPES[String(req.query?.scope || '').trim()] || null;

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `iece-up-${crypto.randomBytes(8).toString('hex')}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const scope = scopeOf(req);
    if (!scope) return cb(null, true);
    if (scope.accept(file.mimetype)) return cb(null, true);
    cb(new UploadRejected(scope.message));
  },
});

// Disk, not memory. A 200 MB activity video held as a Buffer is 200 MB of heap
// on a small VPS, per concurrent upload; and ffmpeg needs a seekable file on
// disk to pull a poster frame out of anyway.
const upload = diskUpload;

/* ------------------------------------------------------------------ *
 * Putting one uploaded file where it belongs                          *
 * ------------------------------------------------------------------ */

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
      contentType: keys.contentTypeFor(info.extension),
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

      // The poster needs the SAME widths as any other image. The client derives
      // the poster URL from the video and then asks for a screen-sized version
      // of it, exactly as it would for a photo — so a poster without variants
      // is a 404 and a blank thumbnail.
      for (const variant of await variantsFromBuffer(poster, 'jpeg')) {
        const vKey = keys.variantKey(pKey, variant.width);
        await r2.put({
          bucket: cfg.bucketPublic,
          key: vKey,
          body: variant.buffer,
          contentType: 'image/jpeg',
          contentLength: variant.buffer.length,
        });
        written.push(vKey);
      }
    }
  } else {
    await r2.putFile({
      bucket: cfg.bucketPublic,
      key: info.key,
      filePath: file.path,
      contentType: info.kind === 'doc'
        ? keys.contentTypeFor(info.extension)
        : (file.mimetype || keys.contentTypeFor(info.extension)),
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
 */
async function finalizeUploads(req, res, next) {
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

  // The bytes decide, not the header the client sent. A PDF renamed to .jpg
  // with `image/jpeg` on it passes the multer filter and fails here, which is
  // the point: this is the check that cannot be talked out of.
  const scope = scopeOf(req);
  if (scope) {
    for (const file of files) {
      let head;
      try {
        const fd = await fs.promises.open(file.path, 'r');
        head = Buffer.alloc(32);
        await fd.read(head, 0, 32, 0);
        await fd.close();
      } catch {
        head = null;
      }
      const sniffed = head ? keys.sniffContentType(head) : null;
      // A format we cannot identify is refused rather than assumed: silently
      // storing something unrecognised is how a broken attachment gets in.
      if (!sniffed || !scope.acceptBytes(sniffed)) {
        for (const temp of tempPaths) await removeQuietly(temp);
        return next(new UploadRejected(scope.message));
      }
    }
  }

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
 * The report shape is a contract activityController, mediaController,
 * schoolController and faceVideo.js were all written against, and it is a good
 * one — `gone` is the list of values it is now safe to drop from the database,
 * and a value whose file could NOT be removed is deliberately left out of it,
 * because that value is the only handle anyone will ever have on that file
 * again.
 */
async function purgeAssets(urls = []) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) return { ...EMPTY_REPORT };

  const mine = list.filter((u) => r2.isOurs(u));
  const foreign = list.filter((u) => !r2.isOurs(u));

  if (foreign.length) {
    // Not ours to delete. Reported rather than swallowed: now that the
    // migration is over, the only way to reach here is a value from somewhere
    // unexpected, and quietly counting it as gone would drop a record's last
    // handle on a file that still exists.
    console.warn(
      `[storage] ${foreign.length} value(s) are not in our buckets and were left alone:`,
      foreign.join('; ')
    );
  }

  const r2Results = await Promise.all(mine.map((u) => r2.destroy(u)));

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
    deleted: r2Results.filter((r) => r.status === 'deleted').length,
    missing: r2Results.filter((r) => r.status === 'missing').length,
    failed: r2Failures.length + foreign.length,
    verified: r2Results.filter((r) => r.ok && r.verified !== false).length,
    unverified: r2Results.filter((r) => r.ok && r.verified === false).length,
    stillPresent: r2StillPresent.length,
    gone: r2Gone,
    failures: [...r2Failures, ...foreign.map((url) => ({ url, error: 'not in our storage' }))],
    blocked: !!r2Blocked,
    blockedReason: (r2Blocked && r2Blocked.error) || null,
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

/**
 * Turn an upload failure into something the person can act on.
 *
 * Mounted after the upload middleware on the /upload routes. Without it a
 * rejected file surfaces as a generic 500, which tells a member of staff
 * nothing about why their photo would not attach.
 */
function handleUploadErrors(err, req, res, next) {
  if (!err) return next();

  if (err instanceof UploadRejected) {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    const mb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    return res.status(413).json({
      success: false,
      error: `That file is too large. The limit is ${mb} MB.`,
    });
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ success: false, error: 'Too many files in one upload.' });
  }

  console.error('[upload] failed:', err);
  return res.status(500).json({ success: false, error: 'The file could not be uploaded. Please try again.' });
}

module.exports = {
  upload,
  handleUploadErrors,
  UPLOAD_SCOPES,
  UploadRejected,
  finalizeUploads,
  putFaceVideo,
  purgeAssets,
  deleteFile,
  // Wording is deliberately provider-neutral — see ./report.js.
  purgeSummary,
  purgeProblem,
  // Private references
  signPrivateRef: r2.signPrivateRef,
  isPrivateRef: r2.isPrivateRef,
  publicUrl: r2.publicUrl,
  MAX_UPLOAD_BYTES,
};
