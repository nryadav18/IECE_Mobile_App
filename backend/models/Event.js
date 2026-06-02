const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add an event name']
  },
  description: {
    type: String,
    required: [true, 'Please add an event description']
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
  eventDate: {
    type: Date,
    required: [true, 'Please add an event date']
  },
  status: {
    type: String,
    enum: ['approved'],
    default: 'approved'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Event', eventSchema);
