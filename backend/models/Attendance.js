const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  trainerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['Present', 'Partially Present', 'Absent', 'Leave'],
    default: 'Partially Present'
  },
  checkInTime: {
    type: Date,
    default: Date.now
  },
  checkOutTime: {
    type: Date,
    default: null
  },
  checkInLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },
  checkOutLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },
  logoutReason: {
    type: String,
    default: null
  },
  totalTimeSpent: {
    type: Number, // in minutes
    default: 0
  },
  verifiedViaFace: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Attendance', attendanceSchema);
