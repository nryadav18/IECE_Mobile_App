const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// THE MIGRATION LEDGER.
//
// One document per FILE — not per reference — recording where it came from,
// where it went, and proof the two are the same bytes. Nothing else in the app
// reads this collection; it exists entirely so that the migration can be
// checked and, if it comes to it, undone.
//
// It lives in its own collection rather than as fields on Activity, Media,
// School, User and LeaveRequest because those five schemas have no business
// carrying migration bookkeeping. Adding a `legacyUrl` to each would mean five
// schema changes to make, and five to remove afterwards, on collections the
// live app writes to constantly.
//
// THE THREE JOBS THIS DOES
//
//   1. Makes the flip mechanical. Phase 5 does not pattern-match URLs or run a
//      regex over a collection; it reads exact `oldUrl -> newUrl` pairs from
//      here and writes precisely those. A rewrite that cannot be expressed as a
//      pair does not happen.
//
//   2. Makes the rollback mechanical. The same pairs, read backwards.
//
//   3. Makes the copy resumable. A run that dies at file 4,000 of 189 (or
//      4,000 of 40,000, later) is restarted by skipping everything already
//      marked verified. Ctrl+C is safe at any moment.
//
// `uses` is the list of database locations that point at this file — the same
// file can be referenced from several records (the Phase 0 audit found 54 such
// cases, mostly a face video recorded in both User.registrationPhotoUrl and the
// per-school entry). It is copied ONCE and every reference is repointed.
// ---------------------------------------------------------------------------

const useSchema = new mongoose.Schema({
  // "User.faceRegistrations[].registrationPhotoUrl" — human-readable, and the
  // key the flip script groups by.
  field: { type: String, required: true },
  collectionName: { type: String, required: true },
  recordId: { type: String, required: true },
  // Position within an array field (mediaUrls, proofs, faceRegistrations).
  // null for a scalar field. This is what lets the flip rewrite element 3 of
  // mediaUrls without disturbing the other four.
  index: { type: Number, default: null },
}, { _id: false });

const assetMigrationSchema = new mongoose.Schema({
  // The Cloudinary delivery URL exactly as it appears in the database today.
  // Unique because this collection is keyed by file, and because a second
  // document for the same URL would let the flip write two different answers.
  oldUrl: { type: String, required: true, unique: true, index: true },

  // The R2 value to write in its place: a public https URL, or an `r2:` private
  // reference for a face recording.
  newUrl: { type: String, default: null },

  bucket: { type: String, default: null },
  key: { type: String, default: null },

  // 'image' | 'video' | 'raw', from Cloudinary. Decides what derivatives are
  // required and therefore what Phase 4 checks for.
  resourceType: { type: String, default: null },

  bytes: { type: Number, default: 0 },

  // Computed while the bytes stream past on the way from Cloudinary to R2 — the
  // proof that what arrived is what left. Phase 4 re-downloads a sample and
  // compares against this.
  sha256: { type: String, default: null },

  // Keys written alongside the primary object: `_w480` / `_w1080` for images,
  // the `.jpg` poster for videos. Recorded so deletion and verification both
  // know what else belongs to this file.
  derivatives: { type: [String], default: [] },

  uses: { type: [useSchema], default: [] },

  // pending    nothing has happened yet
  // copied     bytes are in R2, not yet checked
  // verified   HEAD confirmed the object and its size — READY TO FLIP
  // flipped    the database now points at newUrl
  // dangling   the source is NOT in Cloudinary. Already broken before the
  //            migration started; nothing to copy and nothing to fix. Kept as a
  //            first-class outcome so it is never miscounted as a failure.
  // failed     something went wrong. Retryable.
  status: {
    type: String,
    enum: ['pending', 'copied', 'verified', 'flipped', 'dangling', 'failed'],
    default: 'pending',
    index: true,
  },

  attempts: { type: Number, default: 0 },
  error: { type: String, default: null },

  copiedAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  flippedAt: { type: Date, default: null },
}, { timestamps: true });

// The flip runs one collection at a time and asks for "everything verified that
// this model references", which is exactly this index.
assetMigrationSchema.index({ status: 1, 'uses.field': 1 });

module.exports = mongoose.model('AssetMigration', assetMigrationSchema);
