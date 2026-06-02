const mongoose = require('mongoose');

const visitReportSchema = new mongoose.Schema({
  teamLeaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  trainerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
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
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('VisitReport', visitReportSchema);
