const mongoose = require('mongoose');

// Persistent in-app notification. Push (FCM/APNs) is still fired on top for
// live delivery, but every notification is also stored here so a user can open
// their inbox and see history, unread counts, and act on items later (e.g. a
// CEO/Admin opening a substitution request days after it was raised).
const notificationSchema = new mongoose.Schema({
  // Who this notification belongs to (one document per recipient).
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Machine-readable category so the app can route the tap / render an icon.
  // Keep in sync with the frontend notification router.
  type: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  body: {
    type: String,
    default: ''
  },
  // Free-form payload the client uses to deep-link (e.g. { requestId }).
  // Kept as a Mixed map so each notification type can carry what it needs.
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Fast "my newest unread first" inbox queries.
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
