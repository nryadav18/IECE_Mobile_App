const mongoose = require('mongoose');

/**
 * "Who decided this, and when" — the single shape every approvable record in the
 * app carries, so the client has ONE field to read instead of nine different
 * ones (reviewedBy / approvedBy / raisedBy / chairmanFeedback-adjacent guesses).
 *
 * The approver's name and role are SNAPSHOT here rather than looked up through
 * the ref. An approval is a historical fact: it has to stay readable after the
 * approver is renamed, promoted, or removed from the organisation — and reading
 * it must not cost a populate on every list, every card, every report row. The
 * `userId` ref is kept alongside purely so the Approval Log can filter by person.
 *
 * Embedded on: LeaveRequest, SubstitutionRequest, SchoolVisitRequest,
 * User.faceRegistrations[], Activity, SchoolHoliday, VisitReport, Media.
 *
 * Records decided before this field existed simply have no snapshot; the client
 * shows "Not recorded" for those rather than pretending nobody approved them.
 */
const decisionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Snapshot of the approver at the moment of the decision.
    name: { type: String, default: null },
    role: { type: String, default: null },
    // What they actually did: approved | rejected | cancelled | granted |
    // withdrawn | revised | auto_approved. Drives the verb the client renders
    // ("Approved by" vs "Rejected by"), so it is stored rather than re-derived
    // from `status` — a record can be edited after the decision.
    action: { type: String, default: null },
    at: { type: Date, default: null },
  },
  { _id: false }
);

module.exports = decisionSchema;
