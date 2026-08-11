const mongoose = require('mongoose');
const decisionSchema = require('./decisionSchema');

// A staff member's request to take leave for a date window. Normally raised by
// a field staff member (trainer / leader / head) FOR THEMSELVES, approved or
// rejected by the Admin only. CEO + the applicant's hierarchy are notified on
// approval.
//
// Lifecycle:
//   pending  -> submitted, waiting for the Admin
//   approved -> Admin approved; applicant + heads + CEO notified
//   rejected -> Admin declined and left a mandatory reason (shown to applicant)
//   cancelled-> withdrawn by the applicant before a decision
//
// Business rule (enforced in the controller): a self-applied leave cannot start
// today or tomorrow — the earliest allowed fromDate is the day after tomorrow.
//
// EMERGENCY LEAVE is the one exception to all of the above. The Admin grants it
// ON BEHALF OF a staff member (`isEmergency: true`, `raisedBy` = the Admin), it
// is born APPROVED — there is nobody left to approve it — and it may be dated
// freely, including today and days that have already passed, so an absence can
// be regularised after the fact. It is otherwise an ordinary approved leave:
// the same calendar colour, the same "excused" treatment by the reminder cron.
const leaveRequestSchema = new mongoose.Schema({
  // Who is taking the leave (also the person who raised it — self-service).
  applicant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  reason: {
    type: String,
    required: [true, 'A reason is required'],
    trim: true
  },
  fromDate: {
    type: Date,
    required: true
  },
  toDate: {
    type: Date,
    required: true
  },
  // Optional supporting documents (Cloudinary URLs — photos and/or PDFs).
  proofs: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  // ----- Emergency leave (granted BY the Admin, FOR someone else) -----
  // Indexed because the Admin's "Emergency" tab queries on it directly.
  isEmergency: {
    type: Boolean,
    default: false,
    index: true
  },
  // The Admin who granted an emergency leave. null for a self-applied request,
  // which keeps "who raised this" unambiguous: applicant, unless raisedBy is set.
  raisedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Audit trail of every window change the Admin has made: who moved the dates,
  // when, from what to what, and whether it happened before or after approval.
  // Kept as history rather than overwritten, so an extended or corrected leave
  // can always be traced back to what it originally said. Deliberately the same
  // shape as SchoolVisitRequest.dateHistory — the two features are edited by the
  // same person, from the same kind of screen, for the same reasons.
  dateHistory: [{
    fromDate: { type: Date },
    toDate: { type: Date },
    previousFromDate: { type: Date },
    previousToDate: { type: Date },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    phase: { type: String, enum: ['pending', 'approved'] }
  }],
  // ----- Filled in at decision time by the Admin -----
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  decisionAt: {
    type: Date,
    default: null
  },
  // Mandatory when rejecting — surfaced to the applicant under "My Leave Requests".
  decisionNote: {
    type: String,
    default: ''
  },
  // Snapshot of WHO decided this and what they did — the one field every screen
  // reads to render "Approved by". Shown to the Admin and CEO only.
  decidedBy: {
    type: decisionSchema,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
