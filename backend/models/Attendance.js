const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  trainerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // The school this person CHECKED IN at.
  //
  // NULL only for an anonymous-location head (see User.anonymousLocation), who
  // belongs to no school at all — their day is real work, it just happened
  // nowhere in particular. Every per-school query goes through
  // Attendance.schoolFilter(), which such a row simply never matches, so it is
  // counted in the person's own calendar and profile and in no school's totals.
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    default: null
  },
  // The school this person CHECKED OUT at. Staff assigned to several schools
  // routinely work one in the morning and another in the afternoon, so the day
  // can legitimately start at one school and finish at a different one.
  //
  // Set on every check-out (equal to schoolId for the ordinary same-school
  // case) and null until then. Older records predate the field and stay null —
  // use Attendance.schoolFilter() rather than testing it directly.
  checkOutSchoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    default: null
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
  // `accuracy` is the GPS uncertainty in metres reported by the device for
  // that fix — recorded for auditing when a geofence decision is questioned.
  checkInLocation: {
    lat: { type: Number },
    lng: { type: Number },
    accuracy: { type: Number, default: null }
  },
  checkOutLocation: {
    lat: { type: Number },
    lng: { type: Number },
    accuracy: { type: Number, default: null }
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

/**
 * Query filter for "attendance that belongs to this school".
 *
 * A day split across two schools counts for BOTH of them: the trainer really
 * did work at each. Because this matches a single document, a day where
 * check-in and check-out happened at the same school is still counted once.
 *
 * ALWAYS build per-school attendance queries through this instead of
 * `{ schoolId }`, or split days silently vanish from the afternoon school's
 * numbers.
 *
 *   Attendance.find({ ...Attendance.schoolFilter(id), date: {...} })
 *   Attendance.countDocuments(Attendance.schoolFilter(id))
 */
attendanceSchema.statics.schoolFilter = function (schoolId) {
  return { $or: [{ schoolId }, { checkOutSchoolId: schoolId }] };
};

module.exports = mongoose.model('Attendance', attendanceSchema);
