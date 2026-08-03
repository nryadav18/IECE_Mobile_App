const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// A person may work under multiple schools. Face registration is anchored
// per-school: each school the person is assigned to gets its own face
// embedding, geofence location and approval state. This lets a trainer /
// leader / head register their face separately at each school and check
// in / out at any of them independently.
const faceRegistrationSchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  // A rejection is KEPT rather than deleted, so the person can open the app and
  // read why they were turned down instead of relying on a push they may have
  // missed. Re-registering resets the entry to pending and clears these.
  rejectionReason: {
    type: String,
    default: null
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  faceEmbedding: {
    type: [Number],
    default: []
  },
  registrationLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },
  // Reported GPS uncertainty (metres) of the anchor fix above. Kept so a bad
  // registration can be spotted later instead of silently breaking check-ins.
  // null for registrations captured by app builds that predate this field.
  locationAccuracy: {
    type: Number,
    default: null
  },
  registrationPhotoUrl: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// One stint at one school. A person keeps every stint they have ever had, so a
// school detached by the admin (or archived along with its login) still shows
// up as part of where they have worked. An open entry (removedAt === null) is
// a school they are assigned to right now.
const schoolAssignmentSchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  // Snapshot of the school at assignment time. The School document is archived
  // rather than deleted, so this is only a fallback — but it keeps the history
  // readable even for schools hard-deleted before archiving existed.
  schoolName: { type: String, default: null },
  schoolState: { type: String, default: null },
  assignedAt: { type: Date, default: Date.now },
  // null while the person is still assigned to the school.
  removedAt: { type: Date, default: null },
  // Why the stint ended: 'unassigned' (admin detached them) or
  // 'school_deleted' (the school's login was removed).
  removedReason: { type: String, default: null }
}, { _id: true });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: [
      'creator_admin',
      'ceo',
      'trainer',
      'chairman',
      'team_leader',
      'trainee_team_leader',
      'zonal_head',
      'cluster_head',
      'regional_head'
    ],
    required: [true, 'Please assign a role']
  },
  teamLeaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Legacy single-school reference. Kept in sync with schoolIds[0] so existing
  // code (holiday checks, VisitReport, populate calls) keeps working.
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    default: null
  },
  // A person can be assigned to multiple schools. This is the authoritative
  // multi-school assignment for field staff (trainer / leaders / heads).
  schoolIds: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'School',
    default: []
  },
  // The team a member belongs to (team_leader / trainee_team_leader / trainer).
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null
  },
  // The teams a head oversees (zonal / cluster / regional head). A team can be
  // overseen by more than one head, so this is stored per-head as an array.
  teamIds: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Team',
    default: []
  },
  timetablePdfUrl: {
    type: String,
    default: null
  },
  classesHandled: {
    type: [String],
    default: []
  },
  facialRegistrationStatus: {
    type: String,
    enum: ['none', 'pending', 'approved'],
    default: 'none'
  },
  faceEmbedding: {
    type: [Number],
    default: []
  },
  facialRegistrationStatusV2: {
    type: String,
    enum: ['none', 'pending', 'approved'],
    default: 'none'
  },
  faceEmbeddingV2: {
    type: [Number],
    default: []
  },
  registrationLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },
  registrationPhotoUrl: {
    type: String,
    default: null
  },
  // Per-school face registrations — the authoritative store for multi-school
  // facial attendance. One entry per school the person has registered at.
  faceRegistrations: {
    type: [faceRegistrationSchema],
    default: []
  },
  // Every school this person has ever been assigned to, open stints first.
  // Maintained automatically by the pre-save hook below.
  schoolHistory: {
    type: [schoolAssignmentSchema],
    default: []
  },
  resetPasswordOtp: {
    type: String,
    select: false
  },
  resetPasswordExpire: {
    type: Date,
    select: false
  },
  tokenVersion: {
    type: Number,
    default: 0
  },
  expoPushToken: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Keep the legacy single-school field in sync with the multi-school list so
// that older code paths (holiday checks, populates, attendance fallbacks)
// always have a sensible primary school. schoolIds is the source of truth.
userSchema.pre('save', function() {
  // Only derive the primary from the multi-school list when it actually holds
  // schools, so a legacy schoolId-only create is never clobbered. Clearing the
  // list to empty is handled explicitly by the controller.
  if (this.isModified('schoolIds') && this.schoolIds && this.schoolIds.length > 0) {
    this.schoolId = this.schoolIds[0];
  }
});

// Keep schoolHistory in step with schoolIds. Doing this in the model rather
// than at each call site means EVERY path that changes a person's schools —
// creation, an admin edit, a school being archived — records the stint, and a
// detached school is never silently lost.
//
// Set `user.$locals.schoolRemovalReason` before saving to label why a stint
// ended ('school_deleted'); it defaults to 'unassigned'.
userSchema.pre('save', async function() {
  if (!this.isModified('schoolIds')) {
    return;
  }

  const now = new Date();
  const reason = this.$locals.schoolRemovalReason || 'unassigned';
  const current = (this.schoolIds || []).map(String);

  // Close the stints for schools the person no longer holds.
  (this.schoolHistory || []).forEach((entry) => {
    if (!entry.removedAt && !current.includes(String(entry.schoolId))) {
      entry.removedAt = now;
      entry.removedReason = reason;
    }
  });

  // Open a stint for every newly assigned school. Re-assigning a school the
  // person previously left starts a NEW stint rather than reopening the old
  // one, so the gap stays visible in their history.
  const openIds = new Set(
    (this.schoolHistory || []).filter(e => !e.removedAt).map(e => String(e.schoolId))
  );
  const added = current.filter(id => !openIds.has(id));
  if (added.length) {
    // Required lazily so the two models can be loaded in either order.
    const School = require('./School');
    const docs = await School.find({ _id: { $in: added } }).select('name state');
    const byId = new Map(docs.map(d => [String(d._id), d]));
    added.forEach((id) => {
      const school = byId.get(id);
      this.schoolHistory.push({
        schoolId: id,
        schoolName: school?.name || null,
        schoolState: school?.state || null,
        assignedAt: now
      });
    });
  }
});

// Encrypt password using bcrypt
userSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
