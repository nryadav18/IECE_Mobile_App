const mongoose = require('mongoose');
const decisionSchema = require('./decisionSchema');

const schoolHolidaySchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  // Stored as a calendar day string 'YYYY-MM-DD' (IST) so it matches the
  // attendance calendar exactly and is free of timezone drift.
  date: {
    type: String,
    required: true,
    match: /^\d{4}-\d{2}-\d{2}$/
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  reason: {
    type: String,
    default: ''
  },
  appliedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  rejectionRemark: {
    type: String,
    default: ''
  },
  // When the decision was taken. `reviewedBy` alone told us who but never when,
  // so a holiday approved months ago was indistinguishable from one approved
  // this morning.
  decisionAt: {
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

// One holiday record per school per day (prevents duplicate requests).
schoolHolidaySchema.index({ schoolId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('SchoolHoliday', schoolHolidaySchema);
