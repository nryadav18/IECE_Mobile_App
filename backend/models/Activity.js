const mongoose = require('mongoose');

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
