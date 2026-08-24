const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary with credentials from .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer Storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Automatically determine resource type
    let resource_type = 'auto';
    let folder = 'iece_uploads';

    if (file.mimetype === 'application/pdf') {
      resource_type = 'raw'; // Cloudinary treats PDFs as raw unless we explicitly want them as images
      folder = 'iece_mous';
    } else if (file.mimetype.startsWith('image/')) {
      resource_type = 'image';
      folder = 'iece_images';
    } else if (file.mimetype.includes('wordprocessingml.document') || file.mimetype.includes('msword')) {
      resource_type = 'raw';
      folder = 'iece_mous';
    }

    return {
      folder: folder,
      resource_type: resource_type,
      public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
    };
  }
});

const upload = multer({ storage: storage });

// ---------------------------------------------------------------------------
// DELETING FROM THE CLOUD
//
// The app stores delivery URLs, not public_ids, so every deletion begins by
// working the public_id back out of the URL. That parse is the whole ball game:
// get it wrong and Cloudinary cheerfully answers "not found" for a file that is
// still sitting there costing storage, and nothing looks broken. So it is
// written strictly, it is unit-tested (see the checks that ship with this
// change), and every destroy result is inspected rather than assumed.
//
// The contract callers rely on:
//   * a file that is genuinely gone and a file that was never there are BOTH
//     success — the goal is the end state, not the act;
//   * anything else is a FAILURE and is reported as one, never swallowed;
//   * `gone` lists exactly the URLs it is now safe to drop from the database.
//     A URL whose asset could not be destroyed is deliberately kept, because it
//     is the only handle anyone will ever have on that file again.
//
// That last rule is what makes a retry converge: the second attempt finds the
// already-destroyed files "not found" (success) and re-tries only the ones that
// actually failed.
// ---------------------------------------------------------------------------

/**
 * Is one URL path segment a Cloudinary transformation rather than part of the
 * public_id?
 *
 * Transformations are comma-separated `key_value` pairs whose key is a short
 * (1–3 character) parameter name: `w_800`, `c_fill,g_face`, `f_auto,q_auto`.
 *
 * The length limit is not cosmetic — it is what stops a real folder from being
 * mistaken for a transformation and silently chopped off the public_id. This
 * app uploads into `iece_images`, `iece_mous`, `iece_uploads` and
 * `facial_registrations_v2`, every one of which is `word_word` shaped. Their
 * keys are 4+ characters, so none of them can match.
 */
function isTransformSegment(segment) {
  if (!segment) return false;
  return segment.split(',').every((part) => /^[a-z]{1,3}_.+$/.test(part));
}

/**
 * Work the public_id and resource type back out of a Cloudinary delivery URL.
 *
 * Handles the shapes this app actually produces and the ones a CDN or an
 * on-the-fly resize can introduce:
 *   .../image/upload/v123/iece_images/1712-photo.jpg
 *   .../image/upload/w_800,q_auto/v123/iece_images/1712-photo.jpg
 *   .../video/upload/v123/facial_registrations_v2/abc.mp4
 *   .../raw/upload/v123/iece_mous/1712-mou.pdf
 *
 * @returns {{publicId: string, resourceType: string, deliveryType: string, extension: string|null}|null}
 */
function parseCloudinaryUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  if (!fileUrl.includes('cloudinary.com') && !fileUrl.includes('/upload/')) return null;

  let pathname;
  try {
    pathname = new URL(fileUrl).pathname;
  } catch {
    return null;
  }

  // Split on the delivery type. `upload` is all this app produces, but a signed
  // or private asset would name its own and must not be mis-parsed as a folder.
  const marker = ['/upload/', '/private/', '/authenticated/'].find((m) => pathname.includes(m));
  if (!marker) return null;

  const [before, after] = pathname.split(marker);
  if (!after) return null;

  // .../<cloud_name>/<resource_type>/upload/... — the segment right before the
  // delivery type is the resource type, and destroy() must be told it: a video
  // deleted as an image is a no-op that reports success.
  const resourceType = before.split('/').filter(Boolean).pop() || 'image';

  // 'upload' | 'private' | 'authenticated'. The Admin API needs it to look the
  // asset up again during verification — asking for an `authenticated` asset as
  // an `upload` one answers 404, which would read as "successfully deleted" for
  // a file that is still there. That is precisely the lie verification exists
  // to catch, so it must not be the thing verification tells.
  const deliveryType = marker.replace(/\//g, '');

  const segments = after.split('/').filter(Boolean);

  // Drop leading transformation segments, then the version stamp.
  let i = 0;
  while (i < segments.length && isTransformSegment(segments[i])) i += 1;
  if (i < segments.length && /^v\d+$/.test(segments[i])) i += 1;

  const rest = segments.slice(i);
  if (rest.length === 0) return null;

  // The folder path is part of the public_id; only the final extension is not.
  let publicId = rest.join('/');
  let extension = null;
  const lastDot = publicId.lastIndexOf('.');
  const lastSlash = publicId.lastIndexOf('/');
  if (lastDot > lastSlash && lastDot !== -1) {
    extension = publicId.substring(lastDot + 1);
    publicId = publicId.substring(0, lastDot);
  }

  return { publicId: decodeURIComponent(publicId), resourceType, deliveryType, extension };
}

// Failures that are about the ACCOUNT rather than about one file. When
// Cloudinary suspends an account — most often a free plan that has run past its
// monthly credits — every request is refused identically: the Admin API answers
// "disabled customer" and every delivery URL answers 401, whether the asset
// exists or not.
//
// Worth telling apart from an ordinary failure because the remedy is completely
// different. "Please try again" is a dead end when retrying cannot possibly
// work; the account has to be restored first, and nothing in this app can do
// that. Getting this wrong sends someone hunting for a bug in their own code
// while their images are simply switched off.
const ACCOUNT_BLOCKED = /disabled customer|account (is )?(disabled|suspended|blocked)|quota|rate limit|over.?limit/i;

function isAccountBlocked(error) {
  const code = error?.http_code || error?.error?.http_code || error?.response?.status;
  const message = error?.message || error?.error?.message || '';
  // 401/403 from a request the app signed with its own configured credentials
  // is not "these credentials are wrong" — they worked yesterday — it is the
  // account refusing service.
  if ([401, 403, 420, 429].includes(Number(code))) return true;
  return ACCOUNT_BLOCKED.test(message);
}

// ---------------------------------------------------------------------------
// VERIFYING THE DELETION
//
// `destroy()` answering `{result: 'ok'}` is Cloudinary's report of what it did,
// not proof of the end state — and the two have come apart before. A destroy
// aimed at the wrong resource_type, at a derived asset instead of the original,
// or at an id that lost a folder segment in parsing, can all answer 'ok' or
// 'not found' while the real file sits untouched in the account.
//
// So after every destroy the asset is LOOKED UP again through the Admin API. A
// 404 is the only answer that proves it is gone. Anything that comes back with
// a body means the file survived, and that is reported as a failure however
// cheerfully destroy() reported success.
//
// One deliberate exception: if the lookup itself cannot be performed — the
// Admin API is rate-limited (it is capped far lower than the upload API), the
// network blipped, the account is suspended — the destroy result stands and the
// outcome is marked UNVERIFIED rather than failed. Refusing to believe a
// successful deletion because the audit call was throttled would strand files
// in the database that are genuinely gone from the cloud, which is the opposite
// of what this is for.
// ---------------------------------------------------------------------------

/**
 * Look an asset up again and report whether the cloud still holds it.
 *
 * @returns {Promise<{verified: boolean, gone: boolean|null, error: string|null, blocked: boolean}>}
 */
async function confirmGone(publicId, resourceType, deliveryType = 'upload') {
  try {
    await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: deliveryType,
    });
    // It answered with an asset. The file is still there.
    return { verified: true, gone: false, error: null, blocked: false };
  } catch (error) {
    const code = Number(error?.http_code || error?.error?.http_code || error?.response?.status);
    if (code === 404) {
      // The one answer that proves the end state.
      return { verified: true, gone: true, error: null, blocked: false };
    }
    // Could not check. Not evidence either way — say so rather than guess.
    return {
      verified: false,
      gone: null,
      error: error?.message || error?.error?.message || String(error),
      blocked: isAccountBlocked(error),
    };
  }
}

/**
 * Destroy one asset, CONFIRM it is gone, and say honestly what happened.
 *
 * `verified` is true only when the Admin API was asked afterwards and answered
 * 404. `status: 'failed'` with `stillPresent` means the destroy claimed success
 * and the file is demonstrably still in the account — the exact silent failure
 * this whole path exists to surface.
 *
 * @returns {{url: string, ok: boolean, status: 'deleted'|'missing'|'unparseable'|'failed', publicId: string|null, error: string|null, verified: boolean, stillPresent?: boolean, blocked?: boolean}}
 */
async function destroyAsset(fileUrl) {
  const parsed = parseCloudinaryUrl(fileUrl);
  if (!parsed) {
    // Not a Cloudinary URL at all (a seeded placeholder, a local asset). There
    // is nothing in the cloud to remove, so the end state is already correct.
    // Nothing to verify either — there is no asset to look up.
    return { url: fileUrl, ok: true, status: 'unparseable', publicId: null, error: null, verified: true };
  }

  const { publicId, resourceType, deliveryType, extension } = parsed;

  // `invalidate` also purges the CDN copy. Without it the file is gone from
  // storage but edge caches keep serving it for hours, which does not look
  // "deleted" to anyone actually checking.
  const attempt = async (id) => cloudinary.uploader.destroy(id, {
    resource_type: resourceType,
    invalidate: true,
  });

  try {
    let effectiveId = publicId;
    let result = await attempt(effectiveId);

    // Raw assets (PDFs, Word documents) usually keep their extension IN the
    // public_id, unlike images and videos. If the bare id was not found, the
    // extension is the difference — try once more before believing it is gone.
    if (result?.result === 'not found' && resourceType === 'raw' && extension) {
      effectiveId = `${publicId}.${extension}`;
      result = await attempt(effectiveId);
    }

    if (result?.result !== 'ok' && result?.result !== 'not found') {
      return {
        url: fileUrl, ok: false, status: 'failed', publicId,
        error: result?.result || 'unexpected response from Cloudinary',
        verified: false,
        blocked: false,
      };
    }

    // Cloudinary says the end state is "not there". Check that it actually is.
    const check = await confirmGone(effectiveId, resourceType, deliveryType);

    if (check.verified && !check.gone) {
      // The destroy reported success and the file is still in the account. This
      // is the failure mode that used to be invisible, and it is now the loudest
      // one: the URL is kept so the record still points at a file that exists,
      // and the caller is told the deletion did not happen.
      return {
        url: fileUrl, ok: false, status: 'failed', publicId,
        error: `Cloudinary reported "${result.result}" but the file is still in the account`,
        verified: true,
        stillPresent: true,
        blocked: false,
      };
    }

    return {
      url: fileUrl,
      ok: true,
      status: result.result === 'ok' ? 'deleted' : 'missing',
      publicId,
      error: null,
      // false when the confirmation call could not be made at all. The deletion
      // still counts — see the note above confirmGone — but the report says it
      // was taken on trust rather than proven.
      verified: check.verified,
      verifyError: check.verified ? null : check.error,
    };
  } catch (error) {
    return {
      url: fileUrl, ok: false, status: 'failed', publicId,
      error: error?.message || String(error),
      verified: false,
      blocked: isAccountBlocked(error),
    };
  }
}

/**
 * Destroy many assets at once and report the outcome.
 *
 * @param {string[]} urls
 * @returns {Promise<{ok: boolean, requested: number, deleted: number, missing: number,
 *                    failed: number, gone: string[], failures: Array<{url: string, error: string}>}>}
 */
async function purgeAssets(urls = []) {
  const list = [...new Set((urls || []).filter(Boolean))];
  const results = await Promise.all(list.map(destroyAsset));

  const gone = results.filter((r) => r.ok).map((r) => r.url);
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({ url: r.url, error: r.error }));

  const blocked = results.find((r) => r.blocked);
  // Files the cloud confirmed gone when asked a second time, and files whose
  // confirmation call could not be made. The second number is the honest
  // caveat on "deleted" — it is what stops the log claiming proof it does not
  // have.
  const unverified = results.filter((r) => r.ok && r.verified === false);
  const stillPresent = results.filter((r) => r.stillPresent);
  const report = {
    ok: failures.length === 0,
    requested: list.length,
    deleted: results.filter((r) => r.status === 'deleted').length,
    missing: results.filter((r) => r.status === 'missing').length,
    failed: failures.length,
    verified: results.filter((r) => r.ok && r.verified !== false).length,
    unverified: unverified.length,
    // Destroy said success, the account still holds the file.
    stillPresent: stillPresent.length,
    gone,
    failures,
    // The whole account is refusing service, not just this file. Retrying is
    // pointless until it is restored, and the caller should say so.
    blocked: !!blocked,
    blockedReason: blocked ? blocked.error : null,
  };

  if (failures.length) {
    // Loud on purpose: a file we believe we deleted but did not is invisible
    // everywhere else, so the log is the only place it can surface.
    console.error(
      `Cloudinary purge incomplete — ${failures.length}/${list.length} still in the cloud:`,
      failures.map((f) => `${f.url} (${f.error})`).join('; ')
    );
  }
  if (stillPresent.length) {
    // Worth its own line. An ordinary failure is Cloudinary refusing the
    // request; THIS is Cloudinary accepting it and the file surviving anyway,
    // which points at the destroy arguments (resource type, delivery type, a
    // mis-parsed public_id) rather than at the network.
    console.error(
      `Cloudinary reported success for ${stillPresent.length} file(s) that are STILL in the account:`,
      stillPresent.map((r) => `${r.publicId}`).join('; ')
    );
  }
  if (unverified.length) {
    console.warn(
      `Cloudinary deletion could not be verified for ${unverified.length}/${list.length} file(s) `
      + '(the Admin API lookup failed — the destroy result was taken on trust):',
      unverified.map((r) => `${r.publicId} (${r.verifyError})`).join('; ')
    );
  }
  return report;
}

/**
 * A one-line summary for an API response or a log.
 *
 * Says "verified" only where the asset was looked up again and answered 404, so
 * a reader can tell proof from a report. `{ short: true }` drops the caveat for
 * places that only have room for the headline.
 */
function purgeSummary(report, { short = false } = {}) {
  if (!report || report.requested === 0) return 'Nothing to remove from the cloud.';
  const bits = [];
  if (report.deleted) bits.push(`${report.deleted} deleted`);
  if (report.missing) bits.push(`${report.missing} already gone`);
  if (report.failed) bits.push(`${report.failed} could not be removed`);
  let line = `Cloud storage: ${bits.join(', ')}.`;
  if (!short && report.unverified) {
    line += ` ${report.unverified} not verified (Cloudinary could not be re-checked).`;
  } else if (!short && report.verified && !report.failed) {
    line += ' Verified gone from the cloud.';
  }
  return line;
}

/**
 * Why a purge failed, in words the person reading them can act on.
 *
 * Returns null when nothing failed.
 */
function purgeProblem(report) {
  if (!report || report.ok) return null;
  if (report.blocked) {
    return 'The Cloudinary account is currently refusing all requests'
      + (report.blockedReason ? ` (${report.blockedReason})` : '')
      + '. This usually means the free plan has run out of credits or the account '
      + 'has been suspended — it is also why images and videos are not loading. '
      + 'Nothing can be deleted until the account is restored.';
  }
  if (report.stillPresent) {
    return `${report.stillPresent} file(s) are still in cloud storage even though Cloudinary `
      + 'accepted the deletion. They have been kept on the record so they can be removed later — '
      + 'please report this, it means the deletion is not doing what it says.';
  }
  return `${report.failed} file(s) could not be removed from cloud storage. Please try again.`;
}

/**
 * Back-compat single-URL helper. Returns true only when the cloud is genuinely
 * clear of the file.
 */
const deleteFromCloudinary = async (fileUrl) => {
  const result = await destroyAsset(fileUrl);
  return result.ok;
};

module.exports = {
  cloudinary,
  upload,
  deleteFromCloudinary,
  parseCloudinaryUrl,
  confirmGone,
  destroyAsset,
  purgeAssets,
  purgeSummary,
  purgeProblem,
  isAccountBlocked,
};
