const mongoose = require('mongoose');
const decisionSchema = require('./decisionSchema');

const activitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add an activity name']
  },
  description: {
    type: String,
    required: [true, 'Please add an activity description']
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  uploaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  organizers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  mediaUrls: [{
    type: String
  }],
  activityDate: {
    type: Date,
    required: [true, 'Please add an activity date']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionRemark: {
    type: String
  },
  // Snapshot of WHO decided this and what they did — the one field every screen
  // reads to render "Approved by". Shown to the Admin and CEO only.
  //
  // Activities are the flow where this matters most: they are decided by team
  // leaders, by heads, AND by either admin, so before this field the Admin had
  // no way at all to tell which of them let something through.
  decidedBy: {
    type: decisionSchema,
    default: null
  },
  // "Star Activity" — a head can highlight a standout activity. Once starred it
  // is flagged everywhere the activity is shown (team members, admin, CEO).
  isStarred: {
    type: Boolean,
    default: false
  },
  starredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  starredAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Activity', activitySchema);
