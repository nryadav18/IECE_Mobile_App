const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a school name']
  },
  chairmanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  associationYear: {
    type: String,
    required: [true, 'Please add association year (e.g., 2nd-year)']
  },
  classCoverage: {
    type: String,
    required: [true, 'Please add class coverage (e.g., 8th to 10th)']
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  state: {
    type: String,
    required: [true, 'Please add a state (e.g., Kerala, Tamil Nadu)']
  },
  mouPdfUrl: {
    type: String,
    default: null
  },
  // ---- Archive (soft delete) ----
  // Removing a school NEVER deletes the work done there: activities, visit
  // reports, attendance and holidays all keep pointing at this document, so
  // their school name still resolves. The school is instead flagged archived,
  // which hides it from every active list, dropdown and assignment picker.
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // The school login's details captured at archive time. The chairman User is
  // deleted along with the login, so chairmanId dangles — this keeps the
  // archived list readable.
  archivedChairman: {
    name: { type: String, default: null },
    email: { type: String, default: null }
  }
}, {
  timestamps: true
});

// Archived schools are excluded from nearly every query, so index the flag.
schoolSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('School', schoolSchema);
