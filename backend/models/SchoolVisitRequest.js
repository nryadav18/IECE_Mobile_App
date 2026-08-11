const mongoose = require('mongoose');
const decisionSchema = require('./decisionSchema');

// A leader's / head's request to be out on a school visit (inspection) for a
// date window. Raised by team leaders, trainee team leaders and heads FOR
// THEMSELVES; approved or rejected by the Admin only. CEO + the applicant's
// hierarchy are notified on approval.
//
// Lifecycle:
//   pending  -> submitted, waiting for the Admin
//   approved -> Admin approved; applicant + leader + heads + CEO notified
//   rejected -> Admin declined and left a mandatory reason (shown to applicant)
//   cancelled-> withdrawn by the applicant before a decision
//
// Unlike a leave, an approved school visit is ON-DUTY time: the person is
// working, just off-site. Their check-in / check-out is paused for the window
// (they cannot be at their own school) and the days are painted teal
// "On School Visit" — counted as worked, NOT as an authorised absence.
//
// Business rule (enforced in the controller): a visit may start TODAY —
// inspections are short-notice, so there is no waiting period (this is
// deliberately different from LeaveRequest's day-after-tomorrow rule).
const schoolVisitRequestSchema = new mongoose.Schema({
  // Who is going on the visit (also the person who raised it — self-service).
  applicant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // The school being visited — mandatory, so the visit and the Visit Report
  // that follows it can be tied to one school.
  school: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  reason: {
    type: String,
    required: [true, 'A reason is required'],
    trim: true
  },
  // THE EFFECTIVE WINDOW. Everything downstream — the check-in pause, the
  // calendar marks, the reminder-cron exemption, the report prompt — reads
  // these two fields and nothing else, so an Admin edit takes effect
  // everywhere at once with no extra bookkeeping.
  //
  // The Admin may change them while the request is pending (adjust-then-
  // approve) AND after approval (see dateHistory below).
  fromDate: {
    type: Date,
    required: true
  },
  toDate: {
    type: Date,
    required: true
  },
  // What the applicant originally asked for. Snapshotted at creation and never
  // touched again, so "requested 10–12, granted 10–15" stays visible after any
  // number of Admin edits.
  requestedFromDate: {
    type: Date,
    required: true
  },
  requestedToDate: {
    type: Date,
    required: true
  },
  // Audit trail of every window change: who moved the dates, when, from what to
  // what, and whether it happened before or after approval.
  dateHistory: [{
    fromDate: { type: Date },
    toDate: { type: Date },
    previousFromDate: { type: Date },
    previousToDate: { type: Date },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    phase: { type: String, enum: ['pending', 'approved'] }
  }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
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
  // Mandatory when rejecting — surfaced to the applicant under "My Visits".
  decisionNote: {
    type: String,
    default: ''
  },
  // Set once the "file your Visit Report" reminder has gone out (the day after
  // the window ends), so the cron never nudges the same visit twice. Cleared
  // again whenever the Admin extends toDate — the visit is no longer over, so
  // the prompt has to wait for the NEW end date.
  reportPromptedAt: {
    type: Date,
    default: null
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

// Whole-day inclusive test — mirrors SubstitutionRequest.coversDate.
schoolVisitRequestSchema.methods.coversDate = function coversDate(date = new Date()) {
  if (this.status !== 'approved') return false;
  const start = new Date(this.fromDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(this.toDate);
  end.setHours(23, 59, 59, 999);
  return date >= start && date <= end;
};

module.exports = mongoose.model('SchoolVisitRequest', schoolVisitRequestSchema);
