const mongoose = require('mongoose');

// The kinds of thing that can be decided in this app. Kept as a flat list (not
// a ref) because the log spans nine unrelated collections and a polymorphic ref
// would buy nothing — nothing here ever needs to populate the target document.
const APPROVAL_ENTITY_TYPES = [
  'leave',
  'substitution',
  'school_visit',
  'face_registration',
  'activity',
  'holiday',
  'visit_report',
  'media',
  'admin_account',
];

const APPROVAL_ACTIONS = [
  'approved',
  'rejected',
  'cancelled',
  'granted',
  'withdrawn',
  'revised',
  'auto_approved',
  'created',
  'deleted',
];

/**
 * One row per decision, written the moment the decision is taken.
 *
 * This exists because "who approved this?" was being answered by reading nine
 * different collections and hoping each one happened to store an approver. The
 * log answers it in one query, sorted by time, filterable by approver — which is
 * exactly the question the Admin and CEO were stuck on.
 *
 * Everything needed to render a row is DENORMALISED onto it (actor name/role,
 * subject name/role, school name, a human label for the item). A log row is an
 * immutable record of what was true at that instant, so it must not change when
 * the underlying documents do, and rendering a page of it must not fan out into
 * hundreds of populates.
 *
 * Visible to creator_admin and ceo only — see middleware/approverVisibility.js
 * and routes/approvalLogRoutes.js.
 */
const approvalLogSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: APPROVAL_ENTITY_TYPES,
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Human sentence identifying the item — "Casual leave · 12–14 Aug 2026",
    // "Sports Day at St. Mary's". Snapshot so a later edit (or deletion) of the
    // item does not rewrite history.
    entityLabel: { type: String, default: '' },

    // Who the decision was ABOUT (the applicant / uploader / registrant).
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    subjectName: { type: String, default: null },
    subjectRole: { type: String, default: null },

    action: {
      type: String,
      enum: APPROVAL_ACTIONS,
      required: true,
    },

    // Who TOOK the decision.
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'Unknown' },
    actorRole: { type: String, default: null },

    // Rejection reason / remark / feedback, whichever the flow collected.
    note: { type: String, default: '' },

    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    schoolName: { type: String, default: null },

    decidedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// The log is only ever read newest-first, optionally narrowed by approver, by
// kind, or by the person the decision was about. One index per access path.
approvalLogSchema.index({ decidedAt: -1 });
approvalLogSchema.index({ actorId: 1, decidedAt: -1 });
approvalLogSchema.index({ entityType: 1, decidedAt: -1 });
approvalLogSchema.index({ subjectId: 1, decidedAt: -1 });
// Lets a single item's decision history be pulled up from its detail screen.
approvalLogSchema.index({ entityType: 1, entityId: 1, decidedAt: -1 });

module.exports = mongoose.model('ApprovalLog', approvalLogSchema);
module.exports.APPROVAL_ENTITY_TYPES = APPROVAL_ENTITY_TYPES;
module.exports.APPROVAL_ACTIONS = APPROVAL_ACTIONS;
