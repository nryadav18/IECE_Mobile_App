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
    enum: ['Present', 'Partially Present', 'Absent', 'Leave', 'On Substitution'],
    default: 'Partially Present'
  },
  // When this check-in was marked by a temporary substitute, the geofence is
  // skipped (they are deployed away from their registered school). These fields
  // record that for auditing / reporting.
  substitutionRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubstitutionRequest',
    default: null
  },
  geofenceBypassed: {
    type: Boolean,
    default: false
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
