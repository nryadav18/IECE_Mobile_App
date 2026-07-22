const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    default: null
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
