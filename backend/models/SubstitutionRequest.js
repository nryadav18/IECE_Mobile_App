const mongoose = require('mongoose');
const decisionSchema = require('./decisionSchema');

// A request to temporarily replace a staff member (the "subject") with a
// substitute for a date window. Raised by a leader/head (or CEO/Admin),
// approved by CEO/Admin who also pick the substitute and may edit the dates.
//
// Lifecycle:
//   pending  -> raised, waiting for CEO/Admin
//   approved -> a substitute was chosen; window is set (active while today is
//               inside the window, treated as completed once past toDate)
//   rejected -> declined by CEO/Admin
//   cancelled-> withdrawn by the raiser before approval
//
// `active` / `completed` are derived at read time from the approved window
// rather than stored, so a request never needs a cron to flip its status.
const substitutionRequestSchema = new mongoose.Schema({
  // The staff member being replaced.
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Snapshot of the subject's schools at raise time. Substitution covers ALL of
  // the subject's schools for the window; we snapshot so later reassignments of
  // the subject don't rewrite history.
  subjectSchoolsSnapshot: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'School',
    default: []
  },
  raisedBy: {
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
  // Dates requested by the raiser.
  fromDate: {
    type: Date,
    required: true
  },
  toDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  // ----- Filled in at approval time by CEO/Admin -----
  substitute: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // The approver may edit the window. These are the authoritative dates once
  // approved; fall back to the requested dates if never edited.
  approvedFromDate: {
    type: Date,
    default: null
  },
  approvedToDate: {
    type: Date,
    default: null
  },
  decisionAt: {
    type: Date,
    default: null
  },
  // Optional note the approver leaves when rejecting.
  decisionNote: {
    type: String,
    default: ''
  },
  // Snapshot of WHO decided this and what they did — the one field every screen
  // reads to render "Approved by". Shown to the Admin and CEO only. Note that
  // `approvedBy` above is set on a rejection too, so it cannot be trusted as the
  // verb; this carries the actual action.
  decidedBy: {
    type: decisionSchema,
    default: null
  }
}, {
  timestamps: true
});

// The window that actually governs attendance once approved.
substitutionRequestSchema.virtual('effectiveFromDate').get(function () {
  return this.approvedFromDate || this.fromDate;
});
substitutionRequestSchema.virtual('effectiveToDate').get(function () {
  return this.approvedToDate || this.toDate;
});

// Is `date` inside the approved window (inclusive, whole-day)? Used by the
// attendance layer to decide whether the geofence bypass / leave marker apply.
substitutionRequestSchema.methods.coversDate = function (date = new Date()) {
  if (this.status !== 'approved') return false;
  const from = this.approvedFromDate || this.fromDate;
  const to = this.approvedToDate || this.toDate;
  if (!from || !to) return false;
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const fromDay = new Date(from);
  fromDay.setHours(0, 0, 0, 0);
  const toDay = new Date(to);
  toDay.setHours(23, 59, 59, 999);
  return startOfDay >= fromDay && startOfDay <= toDay;
};

substitutionRequestSchema.set('toJSON', { virtuals: true });
substitutionRequestSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('SubstitutionRequest', substitutionRequestSchema);
