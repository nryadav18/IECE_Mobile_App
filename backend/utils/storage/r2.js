const fs = require('fs');
const {
  S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { presignGetUrl } = require('./presign');

// ---------------------------------------------------------------------------
// THE R2 DRIVER.
//
// Everything the running application does to cloud storage goes through here.
// The contract it honours predates R2 — the callers (activityController,
// mediaController, schoolController, faceVideo) were written against it when
// the app used a different provider entirely, and it survived the move because
// it is a good one:
//
//   * a file that is gone and a file that was never there are BOTH success;
//   * anything else is a failure and is reported as one, never swallowed;
//   * a deletion is not believed until the object has been LOOKED UP again.
//
// That last rule is the one worth keeping honest. `DeleteObject` on S3 returns
// 204 for a key that never existed, for a key in a bucket you cannot read, and
// for a key you actually deleted. It is a report of intent, not of outcome. The
// only proof is a HEAD that answers 404.
// ---------------------------------------------------------------------------

// A reference to an object in the PRIVATE bucket, as stored in MongoDB. It is
// deliberately not a URL: a signed URL expires, so persisting one would write a
// dead link into the database. The signing happens on the way out, per request.
const PRIVATE_SCHEME = 'r2:';

function config() {
  const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/+$/, '');
  return {
    endpoint,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketPublic: process.env.R2_BUCKET_PUBLIC,
    bucketPrivate: process.env.R2_BUCKET_PRIVATE,
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    signedTtl: Number(process.env.R2_SIGNED_URL_TTL || 900),
    zoneId: process.env.CLOUDFLARE_ZONE_ID,
    purgeToken: process.env.CLOUDFLARE_PURGE_TOKEN,
  };
}

let client = null;
function s3() {
  if (client) return client;
  const cfg = config();
  client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return client;
}

/* ------------------------------------------------------------------ *
 * References and URLs                                                 *
 * ------------------------------------------------------------------ */

// ---------------------------------------------------------------------------
// A KEY IS NOT A URL PATH.
//
// The key is raw bytes; the URL path is percent-encoded. For every key this app
// generates the two look identical, because new keys are sanitised down to
// [A-Za-z0-9-_./]. Migrated keys are not — they are whatever Cloudinary's
// public_id happened to be.
//
// Two real files in this account are named
//   iece_mous/1787651280546-Priya%20Weeding%20invitation%20card-1
// with a LITERAL percent-two-zero in the name (Cloudinary stored the URL-encoded
// filename and then encoded it again for delivery, so the stored URL reads
// `%2520`). Building a URL by concatenation would produce `...Priya%20Weeding...`,
// which a client decodes back to `...Priya Weeding...` — a different key. The
// object would upload successfully and then be permanently unreachable, and the
// delete path would never find it either.
//
// So the URL is built by encoding each path segment, and keyFromPublicUrl
// decodes it back. The two are exact inverses, and there is a round-trip check
// over every migrated key in scripts/r2/04-verify.js.
// ---------------------------------------------------------------------------

const encodeKey = (key) => String(key).split('/').map(encodeURIComponent).join('/');

/** `https://cdn.iece.org.in/iece_images/x.jpg` for a public key. */
const publicUrl = (key) => `${config().publicBaseUrl}/${encodeKey(key)}`;

/** `r2:iece-faces/facial_registrations_v2/x.mp4` for a private key. */
const privateRef = (key) => `${PRIVATE_SCHEME}${config().bucketPrivate}/${key}`;

const isPrivateRef = (value) => typeof value === 'string' && value.startsWith(PRIVATE_SCHEME);

/** Split `r2:bucket/some/key.mp4` back into its parts. */
function parsePrivateRef(value) {
  if (!isPrivateRef(value)) return null;
  const rest = value.slice(PRIVATE_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

/** Is this one of our own stored values, public or private? */
function isOurs(value) {
  if (typeof value !== 'string' || !value) return false;
  if (isPrivateRef(value)) return true;
  const base = config().publicBaseUrl;
  return !!base && value.startsWith(`${base}/`);
}

/** The object key behind one of our public URLs. */
function keyFromPublicUrl(url) {
  const base = config().publicBaseUrl;
  if (!base || !url.startsWith(`${base}/`)) return null;
  try {
    // Strip any query string, and undo the percent-encoding a client may have
    // applied — the key is stored raw.
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

/**
 * A time-limited HTTPS URL for a private reference.
 *
 * Synchronous by design — see utils/storage/presign.js. Returns null rather
 * than throwing, so a signing problem degrades to "no video shown" instead of
 * turning an entire admin listing into a 500.
 */
function signPrivateRef(value, ttl) {
  const parsed = parsePrivateRef(value);
  if (!parsed) return null;
  const cfg = config();
  try {
    return presignGetUrl({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      endpoint: cfg.endpoint,
      bucket: parsed.bucket,
      key: parsed.key,
      expiresIn: ttl || cfg.signedTtl,
    });
  } catch (error) {
    console.error(`[storage] could not sign ${value}: ${error.message}`);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Writing                                                             *
 * ------------------------------------------------------------------ */

/**
 * Put one object.
 *
 * `contentType` is a required argument, not an option. Cloudinary derived it
 * from the asset; R2 stores exactly what it is handed, and an object served as
 * `application/octet-stream` is a video that will not play and a PDF that
 * downloads as junk. Making omission impossible is cheaper than finding it
 * later.
 *
 * `contentLength` matters for streams: without it the SDK buffers the whole
 * body in memory to measure it, which for a 200 MB video is exactly the
 * behaviour streaming exists to avoid.
 */
async function put({ bucket, key, body, contentType, contentLength, cacheControl }) {
  if (!contentType) throw new Error(`storage.put: contentType is required (key: ${key})`);
  await s3().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: contentLength,
    // Every key is unique — timestamp plus random token — so nothing at a given
    // key ever changes, which makes an immutable year-long cache correct rather
    // than merely convenient.
    CacheControl: cacheControl || 'public, max-age=31536000, immutable',
  }));
  return key;
}

/** Put a file from disk without reading it into memory first. */
async function putFile({ bucket, key, filePath, contentType, cacheControl }) {
  const { size } = await fs.promises.stat(filePath);
  return put({
    bucket,
    key,
    body: fs.createReadStream(filePath),
    contentType,
    contentLength: size,
    cacheControl,
  });
}

/* ------------------------------------------------------------------ *
 * Purging the CDN                                                     *
 * ------------------------------------------------------------------ */

// ---------------------------------------------------------------------------
// DELETING THE OBJECT IS NOT DELETING THE FILE.
//
// Public objects are served through cdn.iece.org.in, which is Cloudflare's edge
// cache, and they are stored with `max-age=31536000, immutable` because every
// key is unique and nothing at a key ever changes. That is correct for a live
// file and catastrophic for a deleted one: removing the object from the bucket
// leaves the EDGE still serving its copy, and "immutable" means it will go on
// doing so for a year.
//
// This was measured, not assumed. After a verified delete — the S3 API answering
// 404 for the key — the public URL still returned 200 with `cf-cache-status:
// HIT`. Anyone holding the link to a banner or an activity photo that had been
// "deleted" could keep opening it.
//
// This is a lesson the previous provider had already taught: its delete call
// took an `invalidate` flag for exactly this reason — without it "the file is
// gone from storage but edge caches keep serving it for hours, which does not
// look deleted to anyone actually checking". R2 has no equivalent flag, so the
// purge is an explicit API call, made here.
//
// The private bucket needs none of this: it is not behind the domain, and face
// recordings are stored `no-store` precisely so no cache ever holds one.
// ---------------------------------------------------------------------------

// Cloudflare accepts at most 30 URLs per purge request.
const PURGE_BATCH = 30;

let warnedNoPurgeConfig = false;

/**
 * Evict these URLs from Cloudflare's edge.
 *
 * @returns {Promise<{ok: boolean, purged: number, configured: boolean, error: string|null}>}
 */
async function purgeCdn(urls = []) {
  const list = [...new Set(urls.filter((u) => typeof u === 'string' && u.startsWith('http')))];
  if (!list.length) return { ok: true, purged: 0, configured: true, error: null };

  const cfg = config();
  if (!cfg.zoneId || !cfg.purgeToken) {
    if (!warnedNoPurgeConfig) {
      warnedNoPurgeConfig = true;
      console.error(
        '[storage] CLOUDFLARE_ZONE_ID / CLOUDFLARE_PURGE_TOKEN are not set, so deleted '
        + 'files CANNOT be evicted from the CDN. They are gone from the bucket but the '
        + 'edge will keep serving its cached copy for up to a year. See '
        + 'docs/r2-migration-runbook.md section 3.2.'
      );
    }
    return { ok: false, purged: 0, configured: false, error: 'cache purge is not configured' };
  }

  let purged = 0;
  for (let i = 0; i < list.length; i += PURGE_BATCH) {
    const batch = list.slice(i, i + PURGE_BATCH);
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${cfg.zoneId}/purge_cache`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.purgeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: batch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) {
        const detail = (body.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
        console.error(`[storage] CDN purge failed for ${batch.length} url(s): ${detail}`);
        return { ok: false, purged, configured: true, error: detail };
      }
      purged += batch.length;
    } catch (error) {
      console.error(`[storage] CDN purge request failed: ${error.message}`);
      return { ok: false, purged, configured: true, error: error.message };
    }
  }
  return { ok: true, purged, configured: true, error: null };
}

/* ------------------------------------------------------------------ *
 * Reading back / deleting                                             *
 * ------------------------------------------------------------------ */

/** HEAD one object. null means "not there", which is an answer, not an error. */
async function head(bucket, key) {
  try {
    return await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

/**
 * Delete one stored value and PROVE it is gone.
 *
 * Also removes the derivatives that value implies — the `_w480` / `_w1080`
 * images and the `.jpg` poster beside a video. They are invisible to every
 * caller (nothing in the database references them) which is precisely why they
 * would otherwise accumulate forever: deleting an activity would leave three
 * orphans per photo behind, paid for monthly, referenced by nothing.
 */
async function destroy(value) {
  const { variantKey, posterKey, VARIANT_WIDTHS } = require('./keys');
  const cfg = config();

  let bucket;
  let key;
  if (isPrivateRef(value)) {
    const parsed = parsePrivateRef(value);
    if (!parsed) return { url: value, ok: true, status: 'unparseable', error: null, verified: true };
    ({ bucket, key } = parsed);
  } else {
    key = keyFromPublicUrl(value);
    bucket = cfg.bucketPublic;
    if (!key) return { url: value, ok: true, status: 'unparseable', error: null, verified: true };
  }

  try {
    const existed = await head(bucket, key);
    await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

    // Derivatives are best-effort: failing to remove a thumbnail must not keep
    // a record pointing at a primary file that is already gone.
    const extras = [];
    if (/\.(jpe?g|png|webp)$/i.test(key)) {
      for (const width of VARIANT_WIDTHS) extras.push(variantKey(key, width));
    } else if (/\.(mp4|mov|m4v|webm)$/i.test(key)) {
      extras.push(posterKey(key));
    }
    for (const extra of extras) {
      try {
        await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: extra }));
      } catch (error) {
        console.warn(`[storage] could not remove derivative ${extra}: ${error.message}`);
      }
    }

    // The only answer that proves the end state.
    const still = await head(bucket, key);
    if (still) {
      return {
        url: value,
        ok: false,
        status: 'failed',
        error: 'R2 accepted the delete but the object is still in the bucket',
        verified: true,
        stillPresent: true,
      };
    }

    return {
      url: value,
      ok: true,
      status: existed ? 'deleted' : 'missing',
      error: null,
      verified: true,
      // Every public URL this delete made stale. The caller batches these into
      // one CDN purge rather than firing an API call per object.
      cdnUrls: bucket === cfg.bucketPublic
        ? [publicUrl(key), ...extras.map((k) => publicUrl(k))]
        : [],
    };
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    return {
      url: value,
      ok: false,
      status: 'failed',
      error: error.message,
      verified: false,
      // 401/403 against credentials that worked a moment ago is the token being
      // revoked or rescoped, not this object being special.
      blocked: status === 401 || status === 403,
    };
  }
}

module.exports = {
  config,
  publicUrl,
  privateRef,
  isPrivateRef,
  parsePrivateRef,
  isOurs,
  keyFromPublicUrl,
  encodeKey,
  signPrivateRef,
  put,
  putFile,
  head,
  destroy,
  purgeCdn,
  PRIVATE_SCHEME,
};
