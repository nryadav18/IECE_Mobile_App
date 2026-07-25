const mongoose = require('mongoose');

// A staff member's request to take leave for a date window. Raised by any field
// staff member (trainer / leader / head) FOR THEMSELVES, approved or rejected by
// the Admin only. CEO + the applicant's hierarchy are notified on approval.
//
// Lifecycle:
//   pending  -> submitted, waiting for the Admin
//   approved -> Admin approved; applicant + heads + CEO notified
//   rejected -> Admin declined and left a mandatory reason (shown to applicant)
//   cancelled-> withdrawn by the applicant before a decision
//
// Business rule (enforced in the controller): a leave cannot start today or
// tomorrow — the earliest allowed fromDate is the day after tomorrow.
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
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
