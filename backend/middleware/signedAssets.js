const { isPrivateRef, signPrivateRef } = require('../utils/storage');

/**
 * A facial registration video is the most sensitive thing this app stores.
 *
 * Until now it lived on a public Cloudinary URL: anyone holding the link could
 * watch a named member of staff's face, indefinitely, with no login. Nothing
 * about that was deliberate — it is simply what `secure_url` is.
 *
 * Under R2 the recording goes to a private bucket and the database stores a
 * REFERENCE (`r2:iece-faces/…`), never a URL. A signed URL expires; persisting
 * one would write a link into MongoDB that is dead by the time anybody opens
 * it. So the reference is turned into a working, time-limited URL here, on the
 * way out, per response.
 *
 * WHY THIS IS MIDDLEWARE AND NOT A CONTROLLER CHANGE
 *
 * The same reasoning as approverVisibility, which this file deliberately
 * mirrors: doing it per-endpoint means every endpoint added later leaks by
 * default. Here the stakes are inverted but identical in shape — an endpoint
 * that forgot to sign would return a raw `r2:` string, the video would silently
 * fail to load, and nobody would find out until an Admin could not review a
 * registration. Signing centrally means a route cannot get this wrong.
 *
 * WHY IT IS SAFE TO WRAP res.json
 *
 * The signature is computed synchronously (see utils/storage/presign.js), so
 * res.json keeps its exact current semantics — no promise, no change to when
 * headers are written, no new failure mode on the error path. That was the
 * whole reason for implementing SigV4 directly rather than using the AWS SDK's
 * async presigner.
 *
 * WHO GETS A URL
 *
 * The Admin alone (FACE_APPROVERS). For everyone else — including the CEO — the
 * field is emptied rather than signed: a trainer's own record has no use for
 * the video, since the app shows their registration STATUS and not the
 * recording, and handing out a playable link to a face capture, even a
 * short-lived one, is not something any screen needs.
 */

const { FACE_APPROVERS } = require('../utils/roles');

// The field names that can carry a private reference. Both are historic and
// misleadingly named: `registrationPhotoUrl` holds a VIDEO url, inherited from
// an earlier version of facial registration. See utils/faceVideo.js.
const PRIVATE_FIELDS = ['registrationPhotoUrl'];

// Matches approverVisibility's guard against a cycle in a populated graph.
const MAX_DEPTH = 14;

// FACE_APPROVERS, not ADMIN_ROLES. Facial registration is an identity decision
// that sits with the Admin alone — the CEO is a read-only viewer everywhere
// else in the app and is deliberately excluded here, and every route that
// touches a registration already authorizes on exactly this set
// (routes/approvalRoutes.js, routes/adminRoutes.js). Signing for a wider
// audience than those routes admit would hand out playable links to face
// captures that the endpoints themselves would refuse to show.
function canReviewFaces(user) {
  if (!user || !user.role) return false;
  return FACE_APPROVERS.includes(user.role);
}

/**
 * Walk a response body and replace every private reference.
 *
 * Mutates in place rather than rebuilding: a response can carry hundreds of
 * populated user documents, and cloning all of them to touch one string per
 * document would cost more than everything else the request did.
 */
function transform(node, allowed, depth) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return node;

  if (Array.isArray(node)) {
    for (const item of node) transform(item, allowed, depth + 1);
    return node;
  }

  for (const key of Object.keys(node)) {
    const value = node[key];

    if (PRIVATE_FIELDS.includes(key) && isPrivateRef(value)) {
      // A signing failure yields null, which renders as "no recording" rather
      // than as a broken player or a 500. The error is logged where it happens.
      node[key] = allowed ? signPrivateRef(value) : null;
      continue;
    }

    if (value && typeof value === 'object') transform(value, allowed, depth + 1);
  }

  return node;
}

function signedAssets(req, res, next) {
  const original = res.json.bind(res);
  res.json = (body) => original(transform(body, canReviewFaces(req.user), 0));
  next();
}

module.exports = { signedAssets, canReviewFaces };
