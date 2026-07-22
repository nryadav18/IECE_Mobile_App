const mongoose = require('mongoose');

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
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('VisitReport', visitReportSchema);
