const { purgeAssets } = require('./storage');

// ---------------------------------------------------------------------------
// THE FACIAL REGISTRATION VIDEO IS A TEMPORARY ARTEFACT.
//
// Registering a face uploads a short video. The ML service turns it into an
// embedding, the Admin watches it once to decide, and after that the video has
// no job left — every check-in is matched against the stored embedding, never
// against the recording.
//
// So it is deleted at the first moment it stops being needed, and this module
// is the single place that knows how:
//
//   approved            the embedding is saved and is what the app actually
//                       uses; the video is never read again
//   rejected            there is nothing worth keeping; re-registering captures
//                       a fresh video anyway
//   re-registered       the previous attempt's video is superseded
//   reset by the Admin  the registration itself is being thrown away
//   account deleted     the person is gone
//
// Keeping it would mean an accumulating pile of face recordings of real staff
// in a third-party account, paid for by the storage tier, serving nothing. The
// embedding is a set of numbers; the video is a person's face.
//
// `registrationPhotoUrl` is a misleading field name inherited from an earlier
// version — it holds a VIDEO url (resource_type 'video'), which is why deletion
// has to go through the resource-type-aware purge rather than a plain image
// destroy. An image destroy against a video is a no-op that reports success.
// ---------------------------------------------------------------------------

/** The shape every function here returns. */
const NOTHING_TO_DO = {
  requested: 0, deleted: 0, missing: 0, failed: 0,
  verified: 0, unverified: 0, stillPresent: 0, ok: true,
};

/**
 * Narrow a full purge report to what the face flows care about.
 *
 * `verified` / `unverified` are carried through deliberately: a face recording
 * is the most sensitive thing this app puts in the cloud, so "we asked
 * Cloudinary again and it is really gone" is worth telling apart from
 * "Cloudinary said ok and we could not check".
 */
const summarize = (purge) => ({
  requested: purge.requested,
  deleted: purge.deleted,
  missing: purge.missing,
  failed: purge.failed,
  verified: purge.verified || 0,
  unverified: purge.unverified || 0,
  stillPresent: purge.stillPresent || 0,
  ok: purge.ok,
});

/**
 * One sentence about what became of a registration video, for the Approval Log.
 *
 * Lives here rather than in a controller because THREE different routes decide
 * a registration (the approvals hub, the legacy admin screen, the admin reset)
 * and one decision must not read three different ways in the log.
 *
 * A deletion that quietly failed is the outcome worth spelling out: it means a
 * recording of somebody's face is still sitting in cloud storage, and the log is
 * where that has to be visible.
 */
function faceVideoNote(cloud) {
  if (!cloud || cloud.requested === 0) return '';
  if (cloud.stillPresent) {
    return 'Registration video is STILL in cloud storage — Cloudinary accepted the deletion but the file survived';
  }
  if (!cloud.ok) return 'Registration video could NOT be deleted from cloud storage';
  if (cloud.unverified) {
    return 'Registration video deleted from cloud storage (deletion could not be re-verified)';
  }
  return cloud.missing && !cloud.deleted
    ? 'Registration video was already gone from cloud storage'
    : 'Registration video deleted from cloud storage (verified gone)';
}

/**
 * Drop a URL from the legacy top-level pointer if that is what it was aiming at.
 *
 * `user.registrationPhotoUrl` mirrors "the most recent registration", so it can
 * be a second reference to the very file just deleted. Leaving it behind would
 * point the app at a URL that 404s.
 */
function clearLegacyPointer(user, url) {
  if (url && user.registrationPhotoUrl === url) {
    user.registrationPhotoUrl = null;
  }
}

/**
 * Delete the video behind ONE registration.
 *
 * Clears the stored URL only for a file the cloud confirms is gone: a URL whose
 * asset could not be destroyed is the last handle anyone has on that file, so
 * it is kept deliberately and can be retried.
 *
 * Does NOT save the document — the caller is mid-transaction and owns the save.
 *
 * @param {object} user Mongoose user doc
 * @param {object} reg  one entry of user.faceRegistrations
 * @returns {Promise<{requested:number, deleted:number, missing:number, failed:number, ok:boolean}>}
 */
async function purgeFaceVideo(user, reg) {
  const url = reg?.registrationPhotoUrl;
  if (!url) return { ...NOTHING_TO_DO };

  const purge = await purgeAssets([url]);

  if (purge.gone.includes(url)) {
    reg.registrationPhotoUrl = null;
    clearLegacyPointer(user, url);
  }

  return summarize(purge);
}

/**
 * Delete the videos behind SEVERAL registrations — an Admin reset, or an
 * account being removed. `regs` defaults to every registration the user has.
 *
 * Does NOT save the document.
 */
async function purgeFaceVideos(user, regs = null) {
  const list = regs || user?.faceRegistrations || [];
  const urls = list.map((r) => r?.registrationPhotoUrl).filter(Boolean);

  // The legacy pointer can hold a URL that no SURVIVING registration references
  // — an older single-registration capture. That is a stray video and goes in
  // the same sweep.
  //
  // But it must be checked against the survivors first, and this is not
  // paranoia: `registrationPhotoUrl` tracks "the most recent registration", so
  // for somebody registered at two schools it points at whichever they captured
  // last. Sweeping it blindly while resetting the OTHER school would delete a
  // video that is still waiting for the Admin to watch it — destroying a pending
  // registration as a side effect of tidying up an unrelated one.
  const legacy = user?.registrationPhotoUrl;
  if (legacy) {
    const doomed = new Set(list);
    const stillReferenced = (user.faceRegistrations || [])
      .filter((r) => !doomed.has(r))
      .some((r) => r?.registrationPhotoUrl === legacy);
    if (!stillReferenced) urls.push(legacy);
  }

  if (urls.length === 0) return { ...NOTHING_TO_DO };

  const purge = await purgeAssets(urls);
  const gone = new Set(purge.gone);

  list.forEach((r) => {
    if (r?.registrationPhotoUrl && gone.has(r.registrationPhotoUrl)) {
      r.registrationPhotoUrl = null;
    }
  });
  if (user?.registrationPhotoUrl && gone.has(user.registrationPhotoUrl)) {
    user.registrationPhotoUrl = null;
  }

  return summarize(purge);
}

/**
 * Delete the video the LEGACY top-level pointer names, because it is about to
 * be overwritten by a fresh capture.
 *
 * The v1 registration flow keeps no per-school entry — it writes straight to
 * `user.registrationPhotoUrl` — so the previous video's only reference vanishes
 * the instant that field is reassigned. This is the one moment it can still be
 * found.
 *
 * Skipped when a per-school registration points at the same file: that one
 * belongs to a real registration and may still be waiting for the Admin to
 * watch it.
 *
 * Does NOT save the document.
 */
async function purgeLegacyFaceVideo(user, replacementUrl = null) {
  const url = user?.registrationPhotoUrl;
  const nothingToDo = { ...NOTHING_TO_DO };
  if (!url || url === replacementUrl) return nothingToDo;
  if ((user.faceRegistrations || []).some((r) => r?.registrationPhotoUrl === url)) return nothingToDo;

  const purge = await purgeAssets([url]);
  if (purge.gone.includes(url)) user.registrationPhotoUrl = null;
  return summarize(purge);
}

module.exports = { purgeFaceVideo, purgeFaceVideos, purgeLegacyFaceVideo, faceVideoNote };
