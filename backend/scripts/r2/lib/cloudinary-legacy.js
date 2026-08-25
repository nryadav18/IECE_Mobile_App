// ---------------------------------------------------------------------------
// THE LAST CLOUDINARY CODE IN THE PROJECT.
//
// It lives here, under scripts/, rather than under utils/, because that is the
// honest description of what it now is: a migration artefact. The running
// application does not import it and no request path reaches it. Only the
// scripts in this folder do — the audit, the copy job, and the purge — and once
// the Cloudinary account is closed, this file and its dependency can go with it.
//
// What survives from the original utils/cloudinary.js is the part that turned
// out to be genuinely hard: reading a public_id back out of a delivery URL. The
// upload, delete and verify machinery is gone, because the application no longer
// writes to or deletes from Cloudinary, and the purge script removes whole
// folders by prefix rather than one asset at a time.
// ---------------------------------------------------------------------------

/**
 * Is one URL path segment a Cloudinary transformation rather than part of the
 * public_id?
 *
 * Transformations are comma-separated `key_value` pairs whose key is a short
 * (1-3 character) parameter name: `w_800`, `c_fill,g_face`, `f_auto,q_auto`.
 *
 * The length limit is not cosmetic — it is what stops a real folder from being
 * mistaken for a transformation and silently chopped off the public_id. This
 * app uploaded into `iece_images`, `iece_mous`, `iece_uploads` and
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
 * This parse was the whole ball game for the migration: get it wrong and a file
 * is looked up under the wrong name, reported missing, and quietly dropped from
 * the scope. It handles the shapes this app actually produced and the ones a
 * CDN or an on-the-fly resize can introduce:
 *
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

  // Split on the delivery type. `upload` is all this app produced, but a signed
  // or private asset would name its own and must not be mis-parsed as a folder.
  const marker = ['/upload/', '/private/', '/authenticated/'].find((m) => pathname.includes(m));
  if (!marker) return null;

  const [before, after] = pathname.split(marker);
  if (!after) return null;

  // .../<cloud_name>/<resource_type>/upload/... — the segment right before the
  // delivery type is the resource type, and it matters: images, videos and raw
  // files live in separate namespaces where the same public_id can exist in all
  // three.
  const resourceType = before.split('/').filter(Boolean).pop() || 'image';
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
// work. Getting this wrong sends someone hunting for a bug in their own code
// while their files are simply switched off.
const ACCOUNT_BLOCKED = /disabled customer|account (is )?(disabled|suspended|blocked)|quota|rate limit|over.?limit/i;

function isAccountBlocked(error) {
  const code = error?.http_code || error?.error?.http_code || error?.response?.status;
  const message = error?.message || error?.error?.message || '';
  // 401/403 from a request signed with credentials that worked yesterday is not
  // "these credentials are wrong" — it is the account refusing service.
  if ([401, 403, 420, 429].includes(Number(code))) return true;
  return ACCOUNT_BLOCKED.test(message);
}

module.exports = { parseCloudinaryUrl, isTransformSegment, isAccountBlocked };
