const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add an activity name']
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
  proofPhotoUrl: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['Pending', 'Submitted', 'Approved by School', 'Completed Successfully', 'Sent Back'],
    default: 'Pending'
  },
  approvalHistory: [
    {
      action: String,
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      timestamp: {
        type: Date,
        default: Date.now
      }
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('Activity', activitySchema);
