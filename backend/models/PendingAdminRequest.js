const mongoose = require('mongoose');

// A short-lived record holding a not-yet-created admin account while the two
// OTPs (the requesting admin's + the new admin's) are being verified. It is
// auto-removed by a TTL index once `expiresAt` passes, so abandoned requests
// never linger. The password is stored transiently here and hashed by the User
// model's pre-save hook when the account is finally created.
const pendingAdminRequestSchema = new mongoose.Schema({
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  requesterEmail: { type: String, required: true }, // current admin (receives OTP #1)
  name: { type: String, required: true },
  email: { type: String, required: true },          // new admin (receives OTP #2)
  password: { type: String, required: true },        // transient; hashed on User create
  requesterOtp: { type: String, required: true },
  newAdminOtp: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true }
}, {
  timestamps: true
});

// TTL: MongoDB removes the document as soon as `expiresAt` is reached.
pendingAdminRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PendingAdminRequest', pendingAdminRequestSchema);
