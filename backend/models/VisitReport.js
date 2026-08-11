const mongoose = require('mongoose');
const decisionSchema = require('./decisionSchema');

const visitReportSchema = new mongoose.Schema({
  // Author of the report (the inspecting EGM: team leader / trainee TL / head).
  // Named teamLeaderId for backward compatibility with existing queries.
  teamLeaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // The school the visit was conducted at.
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  // The person the report is about (the trainer / leader being visited).
  trainerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // ---- Legacy summary fields (kept populated for existing list/detail views) ----
  dateOfInspection: {
    type: Date,
    required: [true, 'Please specify the date of inspection']
  },
  personMet: {
    type: String,
    required: [true, 'Please specify the person met']
  },
  discussionContext: {
    type: String,
    required: [true, 'Please add discussion context']
  },

  // ---- Full IECE EGM Visit / Sparked Visit form (all fields from the PDF) ----
  // Stored as a structured object; the client drives labels/sections from a
  // shared field config (frontend/src/utils/visitReport.js).
  form: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionRemark: {
    type: String
  },
  // The reviewing school authority's mandatory feedback / comment on the report.
  chairmanFeedback: {
    type: String
  },
  // Snapshot of WHO decided this and what they did — the one field every screen
  // reads to render "Approved by". Shown to the Admin and CEO only.
  //
  // Reports were previously announced as "approved by the chairman" with no
  // record of WHICH chairman, which is unusable once a person runs more than one
  // school or a school changes hands.
  decidedBy: {
    type: decisionSchema,
    default: null
  },
  // When the decision was taken.
  decisionAt: {
    type: Date,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('VisitReport', visitReportSchema);
