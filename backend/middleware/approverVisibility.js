const mongoose = require('mongoose');
const { ADMIN_ROLES } = require('../utils/roles');

/**
 * "Approved by <name>" is for the Admin and the CEO — nobody else.
 *
 * There are several admins and one CEO, and when an approval turns out to be
 * wrong they need to know which of them made it. Everyone else does not: a
 * trainer seeing which particular admin rejected their leave turns an
 * organisational decision into a personal one.
 *
 * That rule is enforced HERE, once, on the way out — not screen by screen. A
 * client-side `isAdmin &&` guard hides the text but still ships the name in the
 * JSON, and any endpoint added later would leak it again by default. This
 * wrapper sits over res.json for every route in the app, so the identity of an
 * approver physically does not leave the server for a non-admin caller.
 *
 * For Admin/CEO it does the opposite job: it fills in `decidedBy` for records
 * decided BEFORE the snapshot field existed, by reading the populated legacy
 * `reviewedBy` / `approvedBy` refs. That is what makes the existing history of
 * leave, substitution, school-visit and holiday decisions show a real name
 * instead of "Not recorded".
 */

// The fields that can carry an approver's identity. `raisedBy` is deliberately
// NOT here: on a substitution it is the requester (not an approver), and on an
// emergency leave the applicant is already told who granted it, by email and in
// the app, as part of that feature. Neither is Meeting.createdBy, which is a
// public "posted by" — that is why User's equivalent is called createdByAdmin.
const APPROVER_FIELDS = ['decidedBy', 'reviewedBy', 'approvedBy', 'createdByAdmin'];

// Guards against a cycle in a populated graph. Nothing this app returns is
// anywhere near this deep.
const MAX_DEPTH = 14;

const ACTION_BY_STATUS = {
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
};

const canSeeApprover = (user) => ADMIN_ROLES.includes(user?.role);

// Values that are objects but hold no nested fields worth walking into.
const isLeafObject = (v) =>
  v instanceof Date ||
  v instanceof mongoose.Types.ObjectId ||
  Buffer.isBuffer(v) ||
  v instanceof RegExp;

/**
 * Rebuild `decidedBy` for a record saved before the snapshot existed.
 * Returns null when there is nothing to go on, which the client renders as
 * "Not recorded" — an honest answer, and a visibly different one from "pending".
 */
const legacyDecision = (o) => {
  const src =
    o.reviewedBy && typeof o.reviewedBy === 'object' && o.reviewedBy.name
      ? o.reviewedBy
      : o.approvedBy && typeof o.approvedBy === 'object' && o.approvedBy.name
      ? o.approvedBy
      : null;
  if (!src) return null;

  // An emergency leave was never "approved" — it was granted outright by the
  // Admin who raised it, and saying "Approved by" would misdescribe that.
  const raiser = o.raisedBy && typeof o.raisedBy === 'object' ? o.raisedBy._id : o.raisedBy;
  const granted = o.isEmergency && raiser && String(raiser) === String(src._id);

  return {
    userId: src._id || null,
    name: src.name,
    role: src.role || null,
    action: granted ? 'granted' : ACTION_BY_STATUS[o.status] || null,
    at: o.decisionAt || o.reviewedAt || o.updatedAt || null,
  };
};

/**
 * Walk the payload and return the value to serialise.
 *
 * Copy-on-write: a branch that needs no change is returned as-is, so a response
 * with no approver data anywhere costs one traversal and zero allocations. The
 * caller's documents are never mutated — they may be cached or reused — but a
 * plain object produced HERE by toJSON is ours, and is edited in place rather
 * than copied a second time.
 */
const transform = (value, allowed, depth) => {
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (isLeafObject(value)) return value;

  if (Array.isArray(value)) {
    let out = value;
    for (let i = 0; i < value.length; i += 1) {
      const next = transform(value[i], allowed, depth + 1);
      if (next !== value[i]) {
        if (out === value) out = value.slice();
        out[i] = next;
      }
    }
    return out;
  }

  // A Mongoose document serialises through toJSON on the way to the wire
  // anyway, so doing it here costs nothing extra — and hands us a plain object
  // we own, without touching the document itself.
  const isDoc = value instanceof mongoose.Document;
  let out = isDoc ? value.toJSON() : value;
  let owned = isDoc;

  // Take a private copy the first time something actually has to change.
  const own = () => {
    if (!owned) {
      out = { ...out };
      owned = true;
    }
    return out;
  };

  if (!allowed) {
    for (const field of APPROVER_FIELDS) {
      if (out[field] !== undefined) delete own()[field];
    }
  }

  for (const key of Object.keys(out)) {
    const next = transform(out[key], allowed, depth + 1);
    if (next !== out[key]) own()[key] = next;
  }

  // Admin / CEO: backfill the snapshot where it is absent.
  if (allowed) {
    const hasSnapshot = out.decidedBy && typeof out.decidedBy === 'object' && out.decidedBy.name;
    if (!hasSnapshot && out.status && ACTION_BY_STATUS[out.status]) {
      const derived = legacyDecision(out);
      if (derived) own().decidedBy = derived;
    }
  }

  return owned ? out : value;
};

/**
 * Express middleware. Mount once, before the routers.
 *
 * Guards the field in both directions. Outbound: hide the approver from anyone
 * who is not Admin/CEO. Inbound: an approver snapshot is something the SERVER
 * stamps, never something a client sends — several controllers build documents
 * straight from req.body, so without this a trainer could post their own
 * "Approved by" onto their own activity.
 */
const approverVisibility = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const field of APPROVER_FIELDS) delete req.body[field];
  }

  const original = res.json.bind(res);
  res.json = (body) => original(transform(body, canSeeApprover(req.user), 0));
  next();
};

module.exports = { approverVisibility, canSeeApprover };
