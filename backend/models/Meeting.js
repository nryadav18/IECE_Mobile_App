const mongoose = require('mongoose');

// A meeting link posted to the "Meeting Corner". Any leader / head / CEO / Admin
// can post a link (Google Meet, Zoom, Teams, Webex, or any other); the platform
// is auto-detected from the URL. The creator chooses who it is shared with; those
// recipients are notified. Admin + CEO always see every meeting in their corner
// (handled at query time) and are always notified.
const meetingSchema = new mongoose.Schema({
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  link: {
    type: String,
    required: [true, 'A meeting link is required'],
    trim: true
  },
  // Auto-detected from the link (see utils/meetingPlatform).
  platform: {
    type: String,
    enum: ['google_meet', 'zoom', 'teams', 'webex', 'other'],
    default: 'other'
  },
  agenda: {
    type: String,
    required: [true, 'A meeting agenda is required'],
    trim: true
  },
  // The people the creator explicitly chose to share with (drives the feed for
  // non-admins + who gets notified). Admin/CEO visibility is handled separately.
  recipients: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: [],
    index: true
  },
  // Who last edited this meeting. An admin may edit anyone's meeting, so the
  // detail view needs to show that it was changed and by whom — `updatedAt`
  // alone cannot say who. Null until the first edit.
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

// Fast "newest meetings shared with me" lookups.
meetingSchema.index({ recipients: 1, createdAt: -1 });

module.exports = mongoose.model('Meeting', meetingSchema);
